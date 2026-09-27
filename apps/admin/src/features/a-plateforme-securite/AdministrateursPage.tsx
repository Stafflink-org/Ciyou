// Administrateurs internes (cahier §26) : liste, rôle et périmètre géographique,
// plafond de remboursement, activation, invitation et matrice des permissions par
// rôle. Chaque changement de droits est audité et signalé.
import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, KeyRound, Plus, Save, ShieldQuestion, UserPlus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  createColumnHelper,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@golink/ui';
import {
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSION_LABELS,
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  CITY_SCOPED_ROLES,
  type AdminPermission,
  type AdminRole,
  type AdminUser,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useMutation } from '@/lib/firestore';
import { inviteAdmin, resetAdminMfa, updateAdminRole, updateAdminRoleDefinition } from './api';
import { Callout, ErrorPanel, RequirePermission } from './components';
import { useAdminRoleDefinitions, useAdmins } from './hooks';
import { PlateformeNav } from './nav';

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<AdminRole>('support');
  const [cityIds, setCityIds] = useState('');
  const [reason, setReason] = useState('');
  const cityList = cityIds.split(',').map((s) => s.trim()).filter(Boolean);
  const cityScoped = (CITY_SCOPED_ROLES as readonly string[]).includes(role);
  const invite = useMutation(() => inviteAdmin({ email, firstName, lastName, adminRole: role, cityIds: cityList, countryIds: [], reason }), { success: 'Invitation envoyée.' });
  const blocked = !email.includes('@') || firstName.trim().length < 1 || lastName.trim().length < 1 || reason.trim().length < 3 || (cityScoped && cityList.length === 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader icon={<UserPlus />} title="Inviter un administrateur" description="Un e-mail d'invitation est envoyé pour définir le mot de passe." />
        <DialogBody className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prénom" required><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></FormField>
            <FormField label="Nom" required><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></FormField>
          </div>
          <FormField label="E-mail" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
          <FormField label="Rôle" required><Select value={role} onValueChange={(v) => setRole(v as AdminRole)} options={ADMIN_ROLES.map((r) => ({ value: r, label: ADMIN_ROLE_LABELS[r] }))} /></FormField>
          {cityScoped && (
            <FormField label="Villes du périmètre (identifiants séparés par des virgules)" required hint="Un responsable de ville doit avoir au moins une ville : sans ville, il verrait tout.">
              <Input value={cityIds} onChange={(e) => setCityIds(e.target.value)} placeholder="ex. metz" />
            </FormField>
          )}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            leftIcon={<Plus />}
            loading={invite.loading}
            disabled={blocked}
            onClick={async () => {
              const res = await invite.mutate();
              if (res) onOpenChange(false);
            }}
          >
            Inviter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAdminDialog({ admin, onOpenChange }: { admin: (AdminUser & { id: string }) | null; onOpenChange: (v: boolean) => void }) {
  const [role, setRole] = useState<AdminRole>(admin?.role ?? 'support');
  const [cityIds, setCityIds] = useState('');
  const [countryIds, setCountryIds] = useState('');
  const [refundLimit, setRefundLimit] = useState('');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  useMemo(() => {
    if (admin) {
      setRole(admin.role);
      setCityIds(admin.cityIds.join(', '));
      setCountryIds(admin.countryIds.join(', '));
      setRefundLimit(admin.refundLimitCents != null ? String(admin.refundLimitCents / 100) : '');
      setActive(admin.active);
      setReason('');
    }
  }, [admin?.id]);
  const save = useMutation(
    () =>
      updateAdminRole({
        adminId: admin!.id,
        role,
        cityIds: cityIds.split(',').map((s) => s.trim()).filter(Boolean),
        countryIds: countryIds.split(',').map((s) => s.trim()).filter(Boolean),
        refundLimitCents: refundLimit.trim() === '' ? null : Math.round(Number(refundLimit) * 100),
        active,
        reason,
      }),
    { success: 'Administrateur mis à jour.' },
  );
  const resetMfa = useMutation(() => resetAdminMfa({ adminId: admin!.id }), { success: (o) => `Double authentification réinitialisée (${o.sessionsRevoked} session(s) fermée(s)).` });

  if (!admin) return null;
  return (
    <Dialog open={Boolean(admin)} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={admin.displayName} description={admin.email} />
        <DialogBody className="space-y-4 pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Rôle" required><Select value={role} onValueChange={(v) => setRole(v as AdminRole)} options={ADMIN_ROLES.map((r) => ({ value: r, label: ADMIN_ROLE_LABELS[r] }))} /></FormField>
            <FormField label="Compte actif"><div className="flex h-10 items-center"><Switch checked={active} onCheckedChange={setActive} /></div></FormField>
            {(CITY_SCOPED_ROLES as readonly string[]).includes(role) && (
              <FormField label="Villes (identifiants séparés par des virgules)" required className="sm:col-span-2"><Input value={cityIds} onChange={(e) => setCityIds(e.target.value)} /></FormField>
            )}
            <FormField label="Pays (identifiants séparés par des virgules)" className="sm:col-span-2"><Input value={countryIds} onChange={(e) => setCountryIds(e.target.value)} /></FormField>
            <FormField label="Plafond de remboursement (€, vide = plafond du rôle)"><Input type="number" value={refundLimit} onChange={(e) => setRefundLimit(e.target.value)} /></FormField>
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
          {admin.mfaEnrolled && (
            <Callout tone="amber" title="Double authentification perdue ?" action={<Button size="sm" variant="secondary" leftIcon={<KeyRound />} loading={resetMfa.loading} onClick={() => void resetMfa.mutate()}>Réinitialiser</Button>}>
              Force un nouvel enrôlement et ferme les sessions ouvertes.
            </Callout>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            leftIcon={<Save />}
            loading={save.loading}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const res = await save.mutate();
              if (res) onOpenChange(false);
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleMatrix() {
  const can = useCan();
  const defs = useAdminRoleDefinitions();
  const [role, setRole] = useState<Exclude<AdminRole, 'super_admin'>>('support');
  const def = defs.data.find((d) => d.id === role);
  const [permissions, setPermissions] = useState<AdminPermission[]>(def?.permissions ?? []);
  const [reason, setReason] = useState('');
  useMemo(() => setPermissions(def?.permissions ?? []), [role, defs.data.length]);
  const save = useMutation(
    () =>
      updateAdminRoleDefinition({
        role,
        label: ADMIN_ROLE_LABELS[role],
        description: def?.description ?? '',
        permissions,
        defaultRefundLimitCents: def?.defaultRefundLimitCents ?? 0,
        reason,
      }),
    { success: (o) => `Rôle mis à jour (${o.affectedAdmins} compte(s) concerné(s)).` },
  );
  const toggle = (p: AdminPermission) => setPermissions((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));

  return (
    <Card>
      <CardHeader
        icon={<ShieldQuestion />}
        title="Matrice des permissions"
        description="Le super administrateur a toujours tous les droits. Sans « Données personnelles non masquées », le rôle voit les coordonnées et données bancaires masquées (appliqué par le serveur)."
        actions={<Select value={role} onValueChange={(v) => setRole(v as any)} options={ADMIN_ROLES.filter((r) => r !== 'super_admin').map((r) => ({ value: r, label: ADMIN_ROLE_LABELS[r] }))} />}
      />
      <CardContent className="space-y-4">
        {defs.loading ? (
          <Skeleton className="h-72" />
        ) : (
          <>
            {ADMIN_PERMISSION_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{group.label}</p>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {ADMIN_PERMISSIONS.filter((p) => group.prefixes.some((pre) => p.startsWith(pre))).map((p) => (
                    <label key={p} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                      <Switch checked={permissions.includes(p)} onCheckedChange={() => toggle(p)} disabled={!can('admins.manage')} />
                      {ADMIN_PERMISSION_LABELS[p]}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {can('admins.manage') && (
              <div className="space-y-2 border-t border-border pt-3">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
                <div className="flex justify-end">
                  <Button size="sm" leftIcon={<Save />} loading={save.loading} disabled={reason.trim().length < 3} onClick={() => void save.mutate()}>Enregistrer le rôle</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AdministrateursPage() {
  useDocumentTitle('Administrateurs · Ciyou Eats Admin');
  const can = useCan();
  const admins = useAdmins();
  const [editing, setEditing] = useState<(AdminUser & { id: string }) | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const columns = useMemo(() => {
    const helper = createColumnHelper<AdminUser & { id: string }>();
    return [
      helper.accessor('displayName', { header: 'Nom', cell: (c) => (
        <div>
          <p className="font-medium text-fg">{c.getValue()}</p>
          <p className="text-xs text-fg-subtle">{c.row.original.email}</p>
        </div>
      ) }),
      helper.accessor('role', { header: 'Rôle', cell: (c) => <Badge tone="brand">{ADMIN_ROLE_LABELS[c.getValue()]}</Badge> }),
      helper.accessor((r) => (r.cityIds.length ? r.cityIds.join(', ') : r.countryIds.length ? r.countryIds.join(', ') : 'Toute la plateforme'), { header: 'Périmètre', id: 'scope' }),
      helper.accessor('mfaEnrolled', { header: 'Double auth.', cell: (c) => (c.getValue() ? <Badge tone="success">Activée</Badge> : <Badge tone="amber">Non activée</Badge>) }),
      helper.accessor('active', { header: 'Statut', cell: (c) => (c.getValue() ? <Badge tone="success" icon={<CheckCircle2 />}>Actif</Badge> : <Badge tone="neutral" icon={<Ban />}>Désactivé</Badge>) }),
    ];
  }, []);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Plateforme & sécurité"
        title="Administrateurs internes"
        description="Rôles, périmètre géographique, plafond de remboursement et activation de l'équipe interne."
        actions={can('admins.manage') && <Button leftIcon={<UserPlus />} onClick={() => setInviteOpen(true)}>Inviter</Button>}
      >
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="admins.view" title="Administrateurs internes">
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">Équipe</TabsTrigger>
            <TabsTrigger value="roles">Rôles et permissions</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="pt-4">
            {admins.error ? (
              <ErrorPanel error={admins.error} />
            ) : (
              <DataTable
                data={admins.data}
                columns={columns}
                loading={admins.loading}
                searchable
                searchPlaceholder="Rechercher un administrateur…"
                onRowClick={can('admins.manage') ? (row) => setEditing(row) : undefined}
                itemLabel="administrateurs"
              />
            )}
          </TabsContent>
          <TabsContent value="roles" className="pt-4"><RoleMatrix /></TabsContent>
        </Tabs>
        <EditAdminDialog admin={editing} onOpenChange={(v) => !v && setEditing(null)} />
        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      </RequirePermission>
    </PageContainer>
  );
}
