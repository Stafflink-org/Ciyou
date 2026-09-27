import { useEffect, useState } from 'react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { Mail, MessageSquareText, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { Card, CardHeader, ProgressBar, Skeleton, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, formatNumber } from '@golink/ui';
import { COLLECTIONS } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { LoadError, RestrictedCard } from '../_croissance/ui';
import { CommunicationLayout } from './layout';

const KEYS = [
  { key: 'marketing_email', label: 'E-mail', icon: <Mail /> },
  { key: 'marketing_push', label: 'Notifications push', icon: <Smartphone /> },
  { key: 'marketing_sms', label: 'SMS', icon: <MessageSquareText /> },
] as const;

type Counts = { total: number } & Record<(typeof KEYS)[number]['key'], number>;

async function countClients(countryId: string | null): Promise<Counts> {
  const base = collection(db, COLLECTIONS.users);
  const scope = countryId ? [where('role', '==', 'client'), where('countryId', '==', countryId)] : [where('role', '==', 'client')];
  const [total, ...rest] = await Promise.all([
    getCountFromServer(query(base, ...scope)),
    ...KEYS.map((k) => getCountFromServer(query(base, ...scope, where(`consents.${k.key}`, '==', true)))),
  ]);
  return {
    total: total.data().count,
    marketing_email: rest[0]?.data().count ?? 0,
    marketing_push: rest[1]?.data().count ?? 0,
    marketing_sms: rest[2]?.data().count ?? 0,
  };
}

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 1000) / 10 : 0;
}

/** Consentement marketing des clients : seuls ceux qui ont accepté reçoivent les offres. */
export function ConsentsPage() {
  useDocumentTitle('Consentement marketing · GoLink Admin');
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const allowed = can('customers.view');
  const [global, setGlobal] = useState<Counts | null>(null);
  const [byCountry, setByCountry] = useState<Array<{ id: string; name: string; counts: Counts }> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const countryKey = geo.countries.map((c) => c.id).join(',');

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    countClients(null)
      .then((c) => alive && setGlobal(c))
      .catch((e: unknown) => alive && setError(e));
    Promise.all(geo.countries.map(async (c) => ({ id: c.id, name: c.name, counts: await countClients(c.id) })))
      .then((rows) => alive && setByCountry(rows.filter((r) => r.counts.total > 0)))
      .catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, countryKey]);

  if (!allowed) {
    return (
      <CommunicationLayout>
        <RestrictedCard title="Accès réservé" description="Les statistiques de consentement nécessitent l’accès aux fiches clients." />
      </CommunicationLayout>
    );
  }

  return (
    <CommunicationLayout>
      {error ? (
        <Card>
          <LoadError error={error} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Clients inscrits" value={global ? formatNumber(global.total) : '—'} loading={!global} icon={<Users />} tone="brand" />
            {KEYS.map((k) => (
              <StatCard
                key={k.key}
                label={`Offres par ${k.label.toLowerCase()}`}
                value={global ? `${pct(global[k.key], global.total).toLocaleString('fr-FR')} %` : '—'}
                loading={!global}
                icon={k.icon}
                tone={k.key === 'marketing_email' ? 'info' : k.key === 'marketing_push' ? 'plum' : 'teal'}
                footer={global ? `${formatNumber(global[k.key])} clients ont accepté` : undefined}
              />
            ))}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="min-w-0">
              <CardHeader title="Par pays" description="Part des clients ayant accepté de recevoir les offres, par canal." divided />
              {!byCountry ? (
                <div className="space-y-3 p-5">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pays</TableHead>
                        <TableHead className="text-right">Clients</TableHead>
                        {KEYS.map((k) => (
                          <TableHead key={k.key} className="min-w-[9rem]">
                            {k.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byCountry.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="num text-right font-mono">{formatNumber(r.counts.total)}</TableCell>
                          {KEYS.map((k) => (
                            <TableCell key={k.key}>
                              <ProgressBar size="sm" value={pct(r.counts[k.key], r.counts.total)} valueLabel={`${pct(r.counts[k.key], r.counts.total).toLocaleString('fr-FR')} %`} tone="brand" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 font-medium text-fg">
                <ShieldCheck className="size-4 text-fg-muted" /> Règles appliquées
              </div>
              <ul className="space-y-2.5 text-sm text-fg-muted">
                <li>Les envois promotionnels ne partent qu’aux clients ayant accepté le canal concerné ; le contrôle est fait au moment de l’envoi.</li>
                <li>Les informations de service (incident, changement de conditions) ne nécessitent pas de consentement.</li>
                <li>Chaque e-mail promotionnel rappelle comment retirer son consentement ; chaque SMS inclut le « STOP ».</li>
                <li>Le client modifie ses choix à tout moment dans les réglages de son compte ; l’historique est conservé.</li>
                <li>Push et SMS promotionnels : entre 9 h et 21 h uniquement.</li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </CommunicationLayout>
  );
}
