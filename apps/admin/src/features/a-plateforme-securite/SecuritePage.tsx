// Sécurité et journal d'audit (cahier §27) : double authentification TOTP (QR code
// d'enrôlement, vérification, codes de secours), sessions et appareils avec
// déconnexion à distance, alertes de sécurité, export du journal d'audit.
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { Link } from 'react-router';
import QRCode from 'qrcode';
import { AlertTriangle, Bell, Download, KeyRound, LogOut, Monitor, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  Select,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateTime,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, SECURITY_ALERT_TYPE_LABELS, type AdminSessionRecord, type SecurityAlert } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess, useCan } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { askReason } from '@/lib/reason';
import { enrollTotp, getMfaStatus, handleSecurityAlert, regenerateRecoveryCodes, revokeSessions } from './api';
import { ActionDialog, Callout, ErrorPanel, RequirePermission } from './components';
import { useAdmins, useAdminSessions, useSecurityAlerts } from './hooks';
import { PlateformeNav } from './nav';

const SEVERITY_TONE: Record<string, 'info' | 'amber' | 'danger'> = { info: 'info', warning: 'amber', critical: 'danger' };

/** Nombre d'alertes de sécurité ouvertes : pastille de la sous-navigation et du menu. */
export function useOpenSecurityAlertsCount(): number | null {
  const can = useCan();
  const q = useMemo(() => (can('security.manage') ? query(collection(db, COLLECTIONS.securityAlerts), where('status', '==', 'open')) : null), [can]);
  const { data } = useCollection<SecurityAlert>(q);
  return data.length || null;
}

function MfaCard() {
  const { admin } = useAdminAccess();
  const [statusData, setStatusData] = useState<{ recoveryCodesLeft: number } | null>(null);
  const status = useMutation(() => getMfaStatus(), { errorToast: false });
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [secretUri, setSecretUri] = useState<{ uri: string; account: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const start = useMutation(() => enrollTotp({ action: 'start' }), { errorToast: true });
  const confirm = useMutation((c: string) => enrollTotp({ action: 'confirm', code: c }), { errorToast: true });
  const regenerate = useMutation((c: string) => regenerateRecoveryCodes({ code: c }), { success: 'Nouveaux codes générés.' });
  const [regenCode, setRegenCode] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);

  useEffect(() => {
    void status.mutate().then((res) => res && setStatusData(res));
    // Une seule fois à l'ouverture de la page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openEnroll() {
    const res = await start.mutate();
    if (!res?.secret || !res.uri) return;
    setSecretUri({ uri: res.uri, account: res.account ?? admin.email });
    setQr(await QRCode.toDataURL(res.uri, { margin: 1, width: 220 }));
    setEnrollOpen(true);
  }

  async function submitCode() {
    const res = await confirm.mutate(code.trim());
    if (res?.recoveryCodes) {
      setRecoveryCodes(res.recoveryCodes);
      setCode('');
      void status.mutate();
    }
  }

  return (
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Double authentification" description="Obligatoire pour tous les administrateurs (application TOTP : Google Authenticator, 1Password…)." />
      <CardContent className="space-y-4">
        {status.loading && !status.error ? (
          <Skeleton className="h-24" />
        ) : recoveryCodes ? (
          <Callout tone="success" title="Double authentification activée">
            <p className="mb-2">Notez ces codes de secours : chacun ne fonctionne qu'une fois, en cas de perte de votre téléphone.</p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm">
              {recoveryCodes.map((c) => <span key={c} className="rounded bg-surface-2 px-2 py-1">{c}</span>)}
            </div>
          </Callout>
        ) : (
          <>
            <Callout tone={admin.mfaEnrolled ? 'success' : 'amber'} title={admin.mfaEnrolled ? 'Activée sur ce compte' : 'Non activée'}>
              {admin.mfaEnrolled
                ? 'Un code est demandé à chaque connexion.'
                : 'Activez-la maintenant : elle sera bientôt obligatoire pour accéder au super admin.'}
            </Callout>
            <div className="flex flex-wrap gap-2">
              {!admin.mfaEnrolled && <Button leftIcon={<KeyRound />} loading={start.loading} onClick={() => void openEnroll()}>Activer</Button>}
              {admin.mfaEnrolled && <Button variant="secondary" onClick={() => setRegenOpen(true)}>Régénérer les codes de secours</Button>}
            </div>
            {admin.mfaEnrolled && statusData && <p className="text-xs text-fg-subtle">{statusData.recoveryCodesLeft} code(s) de secours restant(s).</p>}
          </>
        )}
      </CardContent>

      <Dialog open={enrollOpen} onOpenChange={(v) => { setEnrollOpen(v); if (!v) { setQr(null); setCode(''); } }}>
        <DialogContent size="sm">
          <DialogHeader title="Scannez ce QR code" description="Avec votre application d'authentification, puis saisissez le code à 6 chiffres affiché." />
          <DialogBody className="space-y-4 pt-2">
            {qr && <img src={qr} alt="QR code d'enrôlement" className="mx-auto rounded-lg border border-border" />}
            {secretUri && <p className="break-all text-center font-mono text-2xs text-fg-subtle">{secretUri.account}</p>}
            <FormField label="Code à 6 chiffres" required><Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} inputMode="numeric" autoFocus /></FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnrollOpen(false)}>Annuler</Button>
            <Button loading={confirm.loading} disabled={code.trim().length < 6} onClick={() => void submitCode().then(() => setEnrollOpen(false))}>Valider</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActionDialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="Régénérer les codes de secours"
        description="Les anciens codes deviennent invalides."
        requireReason={false}
        onSubmit={async () => {
          const res = await regenerate.mutate(regenCode.trim());
          if (res) setRecoveryCodes(res.recoveryCodes);
          return Boolean(res);
        }}
      >
        <FormField label="Code de votre application" required><Input value={regenCode} onChange={(e) => setRegenCode(e.target.value)} maxLength={8} /></FormField>
      </ActionDialog>
    </Card>
  );
}

function SessionsCard() {
  const { admin } = useAdminAccess();
  const can = useCan();
  const admins = useAdmins();
  const [adminId, setAdminId] = useState(admin.id);
  const sessions = useAdminSessions(adminId);
  const isSelf = adminId === admin.id;
  const target = admins.data.find((a) => a.id === adminId);
  const revoke = useMutation(
    async (sessionId: string | null) => {
      const reason = isSelf ? 'Déconnexion demandée par l’utilisateur' : await askReason({ title: sessionId ? 'Fermer cette session' : `Déconnecter ${target?.displayName ?? 'cet administrateur'} partout`, description: 'Le motif est conservé dans le journal d’audit.', confirmLabel: 'Déconnecter' });
      return revokeSessions({ adminId, sessionId, reason });
    },
    { success: (r) => (r.revoked > 1 ? `${r.revoked} sessions fermées.` : 'Session fermée.') },
  );
  const now = Date.now();
  const rows = [...sessions.data].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  const stateOf = (s: AdminSessionRecord) => (s.revokedAt ? 'Fermée' : s.expiresAt && s.expiresAt.toMillis() < now ? 'Expirée' : 'Ouverte');
  const openCount = rows.filter((s) => stateOf(s) === 'Ouverte').length;
  return (
    <Card>
      <CardHeader
        icon={<Monitor />}
        title="Sessions et appareils"
        description={isSelf ? 'Vos connexions ; fermez celles que vous ne reconnaissez pas.' : `Connexions de ${target?.displayName ?? 'cet administrateur'} : appareils, historique et déconnexion à distance.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can('security.manage') && (
              <Select value={adminId} onValueChange={setAdminId} options={admins.data.map((a) => ({ value: a.id, label: a.id === admin.id ? `${a.displayName} (moi)` : a.displayName }))} />
            )}
            <Button size="sm" variant="secondary" leftIcon={<LogOut />} loading={revoke.loading} disabled={openCount === 0} onClick={() => void revoke.mutate(null)}>Déconnecter partout</Button>
          </div>
        }
      />
      <CardContent>
        {sessions.loading ? (
          <Skeleton className="h-32" />
        ) : rows.length === 0 ? (
          <EmptyState compact title="Aucune session" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.slice(0, 40).map((s) => {
              const state = stateOf(s);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                      {s.device}
                      <Badge size="sm" tone={state === 'Ouverte' ? 'success' : 'neutral'}>{state}</Badge>
                    </p>
                    <p className="text-xs text-fg-subtle">
                      Ouverte le {formatDateTime(toDate(s.createdAt) ?? new Date())}
                      {state === 'Ouverte' ? ` · active ${formatRelative(toDate(s.lastSeenAt) ?? new Date())}` : ''}
                      {s.mfaVerifiedAt ? ' · double authentification vérifiée' : ''}
                      {s.revokedAt && s.revokeReason ? ` · ${s.revokeReason}` : ''}
                    </p>
                  </div>
                  {state === 'Ouverte' && <Button size="sm" variant="ghost" leftIcon={<LogOut />} loading={revoke.loading} onClick={() => void revoke.mutate(s.id)}>Fermer</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AlertsCard() {
  const can = useCan();
  const [showAll, setShowAll] = useState(false);
  const alerts = useSecurityAlerts(showAll ? 'all' : 'open');
  const handle = useMutation((id: string, status: 'acknowledged' | 'resolved' | 'dismissed') => handleSecurityAlert({ alertId: id, status }), { success: 'Alerte traitée.' });
  return (
    <Card>
      <CardHeader
        icon={<Bell />}
        title="Alertes de sécurité"
        description="Connexions inhabituelles, exports massifs, remboursements en série, échecs de connexion répétés…"
        actions={<Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Ouvertes seulement' : 'Voir tout'}</Button>}
      />
      <CardContent>
        {alerts.error ? (
          <ErrorPanel error={alerts.error} compact />
        ) : alerts.loading ? (
          <Skeleton className="h-32" />
        ) : alerts.data.length === 0 ? (
          <EmptyState compact icon={<ShieldCheck />} title="Aucune alerte ouverte" />
        ) : (
          <ul className="divide-y divide-border">
            {alerts.data.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{SECURITY_ALERT_TYPE_LABELS[a.type] ?? a.type}</Badge>
                    <span className="text-xs text-fg-subtle">{formatDateTime(toDate(a.detectedAt) ?? new Date())}</span>
                  </div>
                  <p className="mt-1 text-sm text-fg">{a.details}</p>
                </div>
                {a.status === 'open' && can('security.manage') && (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => void handle.mutate(a.id, 'resolved')}>Résolue</Button>
                    <Button size="sm" variant="ghost" onClick={() => void handle.mutate(a.id, 'dismissed')}>Ignorer</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AuditExportCard() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const exportLogs = useMutation(async () => {
    const { exportAuditLogs } = await import('./api');
    return exportAuditLogs({ from: new Date(from).getTime(), to: new Date(to).getTime() + 86_400_000 - 1 });
  }, {});
  return (
    <Card>
      <CardHeader icon={<Download />} title="Export du journal d'audit" description="CSV filtré par période, lui-même journalisé." />
      <CardContent className="flex flex-wrap items-end gap-3">
        <FormField label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
        <FormField label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
        <Button
          leftIcon={<Download />}
          loading={exportLogs.loading}
          onClick={async () => {
            const res = await exportLogs.mutate();
            if (!res) return;
            const link = document.createElement('a');
            link.href = `data:${res.mimeType};base64,${res.contentBase64}`;
            link.download = res.fileName;
            link.click();
            toast.success(`${res.rowCount} ligne(s) exportée(s).`);
          }}
        >
          Exporter
        </Button>
      </CardContent>
    </Card>
  );
}

export function SecuritePage() {
  useDocumentTitle('Sécurité · GoLink Admin');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Sécurité et journal d'audit" description="Double authentification obligatoire, sessions et appareils, alertes de sécurité et journal d'audit non modifiable.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="security.manage" title="Sécurité et journal d'audit">
        <Tabs defaultValue="mfa">
          <TabsList>
            <TabsTrigger value="mfa">Double authentification</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="alerts">Alertes</TabsTrigger>
            <TabsTrigger value="audit">Journal d'audit</TabsTrigger>
          </TabsList>
          <TabsContent value="mfa" className="pt-4"><MfaCard /></TabsContent>
          <TabsContent value="sessions" className="pt-4"><SessionsCard /></TabsContent>
          <TabsContent value="alerts" className="pt-4"><AlertsCard /></TabsContent>
          <TabsContent value="audit" className="space-y-4 pt-4">
            <AuditExportCard />
            <Callout tone="info" icon={<AlertTriangle />} title="Consultation détaillée">
              Le journal d'audit complet, non modifiable, se consulte dans la page <Link className="underline" to="/plateforme/journal">Journal d’audit</Link> (filtres par période, auteur, cible, action, motif) ; chaque fiche affiche aussi son propre historique.
            </Callout>
          </TabsContent>
        </Tabs>
      </RequirePermission>
    </PageContainer>
  );
}
