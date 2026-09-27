import { useEffect, useMemo, useState } from 'react';
import { limit, query, where } from 'firebase/firestore';
import { Check, Copy, Gift, Handshake, Link2, Megaphone, UserPlus } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, EmptyState, FormField, Input, PageContainer, PageHeader, Skeleton, StatCard, formatDate, toast } from '@golink/ui';
import { COLLECTIONS, formatPrice, type Referral, type ReferralStatus } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';

interface LinkInfo {
  code: string;
  url: string;
  enabled: boolean;
  rewardCents: number;
  rewardLabel: string;
  rewardType: 'ad_credit' | 'cash';
  qualifyingOrders: number;
  adCreditCents: number;
}

const getLink = callFunction<{ restaurantId: string }, LinkInfo>('getRestaurantReferralLink');
const applyCode = callFunction<{ restaurantId: string; code: string }, { referralId: string; accepted: boolean }>('applyRestaurantReferralCode');

const STATUS: Record<ReferralStatus, { label: string; tone: 'success' | 'amber' | 'danger' | 'neutral' }> = {
  pending: { label: 'En attente de mise en ligne', tone: 'amber' },
  qualified: { label: 'Prime validée', tone: 'success' },
  rewarded: { label: 'Récompensé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
  expired: { label: 'Expiré', tone: 'neutral' },
};

/** Parrainage entre commerces : lien à partager, suivi des commerces inscrits, budget publicitaire gagné. */
export function ReferralPage() {
  useDocumentTitle('Parrainage · GoLink Restaurant');
  const { restaurantId } = useRestaurantAccess();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const apply = useMutation(applyCode, { success: 'Code de parrainage enregistré' });

  useEffect(() => {
    let active = true;
    setInfo(null);
    setError(null);
    getLink({ restaurantId })
      .then((r) => active && setInfo(r))
      .catch((e) => active && setError(errorMessage(e, 'Le lien de parrainage est indisponible.')));
    return () => {
      active = false;
    };
  }, [restaurantId]);

  const referralsQuery = useMemo(
    () => query(collectionAt(COLLECTIONS.referrals), where('referrerId', '==', restaurantId), where('program', '==', 'restaurant'), where('referrerType', '==', 'restaurant'), limit(100)),
    [restaurantId],
  );
  const referrals = useCollection<Referral>(referralsQuery);
  const rows = [...referrals.data].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  const rewarded = rows.filter((r) => r.status === 'rewarded');
  const earned = rewarded.reduce((s, r) => s + (r.referrerRewardCents ?? 0), 0);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible : sélectionnez le lien et copiez-le à la main.');
    }
  }

  return (
    <PageContainer>
      <PageHeader eyebrow="Marketing" title="Parrainage" description="Faites inscrire un autre commerce sur GoLink : vous gagnez du budget publicitaire dès qu’il est en ligne." />
      <div className="space-y-6">
        {error ? (
          <Card>
            <CardContent className="p-5 text-sm text-danger">{error}</CardContent>
          </Card>
        ) : !info ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Commerces parrainés" icon={<UserPlus />} tone="brand" value={String(rows.length)} footer={`${rows.filter((r) => r.status === 'pending').length} en attente`} />
              <StatCard label="Récompenses reçues" icon={<Gift />} tone="success" value={formatPrice(earned)} footer={`${rewarded.length} parrainage${rewarded.length > 1 ? 's' : ''}`} />
              <StatCard label="Budget publicitaire disponible" icon={<Megaphone />} tone="neutral" value={formatPrice(info.adCreditCents)} footer="Utilisable pour les mises en avant payantes" />
            </div>
            <Card>
              <CardHeader
                title="Votre lien de parrainage"
                description={info.enabled ? `${info.rewardLabel} ${info.rewardType === 'ad_credit' ? 'de budget publicitaire' : 'versés'} pour chaque commerce parrainé, dès qu’il est validé${info.qualifyingOrders > 0 ? ` et a livré ${info.qualifyingOrders} commande${info.qualifyingOrders > 1 ? 's' : ''}` : ''}.` : 'Le parrainage entre commerces est fermé pour le moment.'}
                icon={<Link2 />}
                divided
              />
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Input readOnly value={info.url} className="min-w-0 flex-1" aria-label="Lien de parrainage" onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="secondary" leftIcon={copied ? <Check /> : <Copy />} onClick={() => void copy(info.url)}>{copied ? 'Copié' : 'Copier le lien'}</Button>
                </div>
                <p className="text-sm text-fg-muted">
                  Votre code : <span className="font-mono font-semibold text-fg">{info.code}</span> — le commerce le saisit à l’inscription, ou arrive avec votre lien.
                </p>
              </CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader title="Commerces parrainés" description="Suivi de chaque inscription" icon={<Handshake />} divided />
          <CardContent className="p-0">
            {referrals.loading ? (
              <div className="space-y-2 p-5">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : rows.length === 0 ? (
              <EmptyState compact icon={<UserPlus />} title="Aucun commerce parrainé" description="Partagez votre lien : chaque inscription apparaît ici." />
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.refereeId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{r.refereeName ?? 'Nouveau commerce'}</p>
                      <p className="text-xs text-fg-subtle">Inscrit le {toDate(r.createdAt) ? formatDate(toDate(r.createdAt) as Date) : '—'}{r.status === 'rejected' && r.rejectedReason ? ` · ${r.rejectedReason}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {r.status === 'rewarded' && <span className="text-sm font-medium text-fg">{formatPrice(r.referrerRewardCents ?? 0)}</span>}
                      <Badge tone={STATUS[r.status].tone} size="sm">{STATUS[r.status].label}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="J’ai été parrainé" description="Vous avez un code d’un autre commerce GoLink ? Enregistrez-le (une seule fois)." divided />
          <CardContent className="space-y-3">
            <FormField label="Code de parrainage">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={code} maxLength={20} className="min-w-0 flex-1" onChange={(e) => setCode(e.target.value.toUpperCase())} />
                <Button variant="primary" loading={apply.loading} disabled={code.trim().length < 4} onClick={() => void apply.mutate({ restaurantId, code: code.trim() })}>Enregistrer</Button>
              </div>
            </FormField>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
