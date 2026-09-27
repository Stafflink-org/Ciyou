import { useEffect, useState } from 'react';
import type { FirestoreError } from 'firebase/firestore';
import { ChevronDown, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  IconButton,
  Input,
  Skeleton,
  Textarea,
  cn,
  toast,
} from '@golink/ui';
import {
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  RESTAURANT_PERMISSIONS,
  STAFF_ROLE_LABELS,
  memberHasPermission,
  type RestaurantMember,
  type RestaurantPermission,
  type StaffRole,
  type StaffRoleDefinition,
  type WithId,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, useMutation } from '@/lib/firestore';
import { deleteStaffRole, saveStaffRole } from '../parametres/kit/api';
import { LoadError } from '../parametres/kit/ui';
import { PermissionMatrix } from './PermissionMatrix';
import { ROLE_DESCRIPTIONS } from './permissions-catalog';

const PRESETS: Array<Exclude<StaffRole, 'custom'>> = ['owner', 'manager', 'kitchen', 'service', 'accountant', 'employee'];

/** Rôles fournis par GoLink (lecture) et rôles sur mesure de l'établissement. */
export function RolesTab({
  roles,
  loading,
  error,
  members,
}: {
  roles: Array<WithId<StaffRoleDefinition>>;
  loading: boolean;
  error: FirestoreError | null;
  members: Array<WithId<RestaurantMember>>;
}) {
  const can = useCan();
  const manage = can('team.manage');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<WithId<StaffRoleDefinition> | 'new' | null>(null);
  const [removing, setRemoving] = useState<WithId<StaffRoleDefinition> | null>(null);
  const { restaurantId } = useRestaurantAccess();

  const holders = (predicate: (m: RestaurantMember) => boolean) => members.filter((m) => m.active && predicate(m)).length;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-fg">Rôles sur mesure</h2>
            <p className="text-sm text-fg-muted">Composez des jeux de droits adaptés à votre organisation (chef de rang, plongeur, responsable de salle…).</p>
          </div>
          {manage && (
            <Button variant="secondary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
              Créer un rôle
            </Button>
          )}
        </div>
        {error ? (
          <LoadError message={errorMessage(error)} />
        ) : loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : roles.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon={<KeyRound />}
              title="Aucun rôle sur mesure"
              description="Les rôles standards couvrent la plupart des besoins. Créez-en un pour un poste particulier."
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {roles.map((role) => (
              <Card key={role.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-fg">
                      <KeyRound className="size-4 text-fg-subtle" />
                      <span className="truncate">{role.name}</span>
                    </p>
                    {role.description && <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{role.description}</p>}
                  </div>
                  {manage && !role.system && (
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton label={`Modifier ${role.name}`} size="sm" onClick={() => setEditing(role)}>
                        <Pencil />
                      </IconButton>
                      <IconButton label={`Supprimer ${role.name}`} size="sm" variant="danger" onClick={() => setRemoving(role)}>
                        <Trash2 />
                      </IconButton>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                  <Badge size="sm">{role.permissions.length} droits</Badge>
                  <Badge size="sm" tone="info">
                    {holders((m) => m.customRoleId === role.id)} membre{holders((m) => m.customRoleId === role.id) > 1 ? 's' : ''}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">Rôles standards</h2>
          <p className="text-sm text-fg-muted">Définis par GoLink, mis à jour automatiquement quand de nouvelles fonctions arrivent.</p>
        </div>
        <div className="space-y-2">
          {PRESETS.map((preset) => {
            const permissions = [...DEFAULT_STAFF_ROLE_PERMISSIONS[preset]];
            const expanded = open === preset;
            return (
              <Card key={preset} className="overflow-hidden">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : preset)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg-muted">
                    <ShieldCheck className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-fg">{STAFF_ROLE_LABELS[preset]}</span>
                    <span className="block truncate text-xs text-fg-subtle">{ROLE_DESCRIPTIONS[preset]}</span>
                  </span>
                  <span className="hidden text-xs text-fg-subtle sm:inline">
                    {preset === 'owner' ? 'Tous les droits' : `${permissions.length} droits`} · {holders((m) => m.role === preset)} membre
                    {holders((m) => m.role === preset) > 1 ? 's' : ''}
                  </span>
                  <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && (
                  <div className="border-t border-border bg-surface-2/50 p-4">
                    <PermissionMatrix value={preset === 'owner' ? [...RESTAURANT_PERMISSIONS] : permissions} readOnly />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <RoleDialog restaurantId={restaurantId} role={editing} onClose={() => setEditing(null)} existingNames={roles.map((r) => r.name)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Supprimer le rôle « ${removing?.name ?? ''} » ?`}
        description="Impossible tant qu’un membre actif l’utilise : changez d’abord son rôle."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteStaffRole({ restaurantId, roleId: removing.id });
            toast.success('Rôle supprimé.');
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}

function RoleDialog({
  restaurantId,
  role,
  onClose,
  existingNames,
}: {
  restaurantId: string;
  role: WithId<StaffRoleDefinition> | 'new' | null;
  onClose: () => void;
  existingNames: string[];
}) {
  const { member } = useRestaurantAccess();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<RestaurantPermission[]>([]);
  const save = useMutation(saveStaffRole, {
    success: (r) => (r.membersUpdated > 0 ? `Rôle enregistré, droits mis à jour pour ${r.membersUpdated} membre${r.membersUpdated > 1 ? 's' : ''}.` : 'Rôle enregistré.'),
  });

  useEffect(() => {
    if (role === 'new') {
      setName('');
      setDescription('');
      setPermissions(['dashboard.view', 'orders.view', 'planning.view', 'timeclock.self', 'absences.self', 'tasks.view']);
    } else if (role) {
      setName(role.name);
      setDescription(role.description ?? '');
      setPermissions(role.permissions);
    }
  }, [role]);

  const grantable = (p: RestaurantPermission) => member.role === 'owner' || memberHasPermission(member, p);
  const duplicate = existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase() && (role === 'new' || n !== role?.name));
  const invalid = name.trim().length < 2 || duplicate || permissions.length === 0;

  const submit = async () => {
    const result = await save.mutate({
      restaurantId,
      ...(role && role !== 'new' ? { roleId: role.id } : {}),
      name: name.trim(),
      description: description.trim() || null,
      permissions,
    });
    if (result) onClose();
  };

  return (
    <Dialog open={role !== null} onOpenChange={(v) => !v && !save.loading && onClose()}>
      <DialogContent size="xl">
        <DialogHeader icon={<KeyRound />} title={role === 'new' ? 'Créer un rôle sur mesure' : 'Modifier le rôle'} description="Les membres qui ont ce rôle reçoivent immédiatement les nouveaux droits." />
        <DialogBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <FormField label="Nom du rôle" required error={duplicate ? 'Un rôle porte déjà ce nom.' : undefined}>
              <Input value={name} maxLength={40} placeholder="Ex. Chef de rang" onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Description">
              <Textarea rows={1} className="min-h-9" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
          </div>
          <PermissionMatrix value={permissions} onChange={setPermissions} grantable={grantable} />
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto hidden font-mono text-xs text-fg-subtle num sm:inline">{permissions.length} droits sélectionnés</span>
          <Button variant="ghost" onClick={onClose} disabled={save.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={invalid} onClick={() => void submit()}>
            Enregistrer le rôle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
