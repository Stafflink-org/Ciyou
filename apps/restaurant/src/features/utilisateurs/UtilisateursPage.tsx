import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { collection, query } from 'firebase/firestore';
import { KeyRound, MailPlus, MoreHorizontal, RotateCcw, ShieldCheck, UserCog, UserMinus, Users } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  StatCard,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  createColumnHelper,
  formatRelative,
  toast,
} from '@golink/ui';
import { STAFF_ROLE_LABELS, paths, type RestaurantMember, type StaffRoleDefinition, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { errorMessage, toDate, useCollection } from '@/lib/firestore';
import { revokeMember } from '../parametres/kit/api';
import { LoadError } from '../parametres/kit/ui';
import { InviteDialog } from './InviteDialog';
import { MemberSheet } from './MemberSheet';
import { RolesTab } from './RolesTab';

type Member = WithId<RestaurantMember>;
type MemberStatus = 'active' | 'invited' | 'revoked';

function statusOf(member: RestaurantMember): MemberStatus {
  if (!member.active) return 'revoked';
  return member.joinedAt ? 'active' : 'invited';
}

const STATUS_META: Record<MemberStatus, { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  active: { label: 'Actif', tone: 'success' },
  invited: { label: 'Invitation envoyée', tone: 'info' },
  revoked: { label: 'Accès retiré', tone: 'neutral' },
};

const column = createColumnHelper<Member>();

/** Membres ayant accès au back-office, rôles et permissions de l'établissement. */
export function UtilisateursPage() {
  const { user } = useAuth();
  const { restaurant, restaurantId, member: me } = useRestaurantAccess();
  const can = useCan();
  const manage = can('team.manage');
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') === 'roles' ? 'roles' : 'membres';

  const members = useCollection<RestaurantMember>(query(collection(db, `${paths.restaurant(restaurantId)}/members`)));
  const roles = useCollection<StaffRoleDefinition>(query(collection(db, `${paths.restaurant(restaurantId)}/staffRoles`)));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [revoking, setRevoking] = useState<Member[] | null>(null);

  const list = useMemo(
    () =>
      [...members.data].sort((a, b) => {
        const order = { owner: 0, manager: 1 } as Record<string, number>;
        return (order[a.role] ?? 2) - (order[b.role] ?? 2) || Number(!a.active) - Number(!b.active) || a.displayName.localeCompare(b.displayName, 'fr');
      }),
    [members.data],
  );
  const counts = {
    active: list.filter((m) => statusOf(m) === 'active').length,
    invited: list.filter((m) => statusOf(m) === 'invited').length,
    revoked: list.filter((m) => statusOf(m) === 'revoked').length,
  };
  const roleName = (m: RestaurantMember) =>
    m.role === 'custom' ? (roles.data.find((r) => r.id === m.customRoleId)?.name ?? 'Sur mesure') : STAFF_ROLE_LABELS[m.role];

  const editable = (m: RestaurantMember) =>
    manage && m.role !== 'owner' && m.uid !== user?.uid && (m.role !== 'manager' || me.role === 'owner');

  const columns = useMemo(
    () => [
      column.accessor('displayName', {
        header: 'Membre',
        cell: ({ row }) => {
          const m = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={m.displayName} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">
                  {m.displayName}
                  {m.uid === user?.uid && <span className="ml-1.5 text-xs font-normal text-fg-subtle">(vous)</span>}
                </p>
                <p className="truncate text-xs text-fg-subtle">{m.email}</p>
              </div>
            </div>
          );
        },
      }),
      column.accessor((m) => roleName(m), {
        id: 'role',
        header: 'Rôle',
        cell: ({ row, getValue }) => (
          <Badge tone={row.original.role === 'owner' ? 'brand' : row.original.role === 'manager' ? 'info' : 'neutral'}>{getValue()}</Badge>
        ),
      }),
      column.accessor((m) => STATUS_META[statusOf(m)].label, {
        id: 'status',
        header: 'Statut',
        cell: ({ row }) => {
          const meta = STATUS_META[statusOf(row.original)];
          return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
        },
      }),
      column.accessor((m) => toDate(m.lastAccessAt)?.getTime() ?? 0, {
        id: 'lastAccess',
        header: 'Dernier accès',
        cell: ({ row }) => {
          const date = toDate(row.original.lastAccessAt);
          return <span className="text-sm text-fg-muted">{date ? formatRelative(date) : 'Jamais connecté'}</span>;
        },
      }),
      column.accessor((m) => m.permissions.length, {
        id: 'permissions',
        header: 'Droits',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-fg-muted num">{row.original.role === 'owner' ? 'Tous' : row.original.permissions.length}</span>
        ),
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', className: 'w-12' },
        cell: ({ row }) => {
          const m = row.original;
          if (!editable(m)) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions pour ${m.displayName}`} size="sm" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem icon={<UserCog />} onSelect={() => setSelected(m)}>
                  {m.active ? 'Modifier le rôle et les droits' : 'Rétablir l’accès'}
                </DropdownMenuItem>
                {m.active && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<UserMinus />} destructive onSelect={() => setRevoking([m])}>
                      Retirer l’accès
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles.data, user?.uid, manage, me.role],
  );

  const confirmRevoke = async (reason?: string) => {
    if (!revoking || !reason) return;
    let done = 0;
    for (const m of revoking) {
      try {
        await revokeMember({ restaurantId, uid: m.uid, reason });
        done += 1;
      } catch (error) {
        toast.error(`${m.displayName} : ${errorMessage(error)}`);
      }
    }
    if (done > 0) toast.success(done > 1 ? `${done} accès retirés.` : 'Accès retiré. La personne est déconnectée de l’établissement.');
    setRevoking(null);
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Configuration"
        title="Utilisateurs et accès"
        description={`Qui peut se connecter au back-office de ${restaurant.name}, et avec quels droits.`}
        actions={
          manage && (
            <Button variant="primary" leftIcon={<MailPlus />} onClick={() => setInviteOpen(true)}>
              Inviter un membre
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Membres actifs" value={members.loading ? '—' : counts.active} icon={<Users />} tone="success" loading={members.loading} />
        <StatCard label="Invitations en attente" value={members.loading ? '—' : counts.invited} icon={<MailPlus />} tone="info" loading={members.loading} />
        <StatCard label="Rôles sur mesure" value={roles.loading ? '—' : roles.data.length} icon={<KeyRound />} tone="plum" loading={roles.loading} />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          if (value === 'roles') next.set('onglet', 'roles');
          else next.delete('onglet');
          setParams(next, { replace: true });
        }}
      >
        <TabsList aria-label="Sections">
          <TabsTrigger value="membres" icon={<Users />} count={members.loading ? undefined : list.length}>
            Membres
          </TabsTrigger>
          <TabsTrigger value="roles" icon={<ShieldCheck />} count={roles.loading ? undefined : roles.data.length + 6}>
            Rôles et permissions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="membres" className="pt-6">
          {members.error ? (
            <LoadError message={errorMessage(members.error)} />
          ) : (
            <DataTable
              data={list}
              columns={columns}
              getRowId={(m) => m.id}
              loading={members.loading}
              searchable
              searchPlaceholder="Rechercher un membre…"
              itemLabel="membres"
              onRowClick={(m) => editable(m) && setSelected(m)}
              filters={[
                {
                  id: 'status',
                  label: 'Statut',
                  options: (Object.keys(STATUS_META) as MemberStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label })),
                  getValue: (m) => statusOf(m),
                },
                {
                  id: 'role',
                  label: 'Rôle',
                  options: [...new Set(list.map((m) => m.role))].map((r) => ({ value: r, label: STAFF_ROLE_LABELS[r] })),
                  getValue: (m) => m.role,
                },
              ]}
              bulkActions={
                manage
                  ? [
                      {
                        label: 'Retirer l’accès',
                        icon: <UserMinus />,
                        destructive: true,
                        onClick: (rows, clear) => {
                          const targets = rows.filter((m) => editable(m) && m.active);
                          if (targets.length === 0) {
                            toast.info('Aucun des membres sélectionnés ne peut être retiré.');
                            return;
                          }
                          setRevoking(targets);
                          clear();
                        },
                      },
                    ]
                  : undefined
              }
              emptyState={
                <EmptyState
                  compact
                  icon={<Users />}
                  title="Aucun membre"
                  description="Invitez votre équipe pour partager le suivi des commandes."
                  action={
                    manage ? (
                      <Button variant="primary" leftIcon={<MailPlus />} onClick={() => setInviteOpen(true)}>
                        Inviter un membre
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          )}
          {counts.revoked > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
              <RotateCcw className="size-3.5" />
              Les accès retirés restent listés pour l’historique ; ils peuvent être rétablis à tout moment.
            </p>
          )}
        </TabsContent>
        <TabsContent value="roles" className="pt-6">
          <RolesTab roles={roles.data} loading={roles.loading} error={roles.error} members={list} />
        </TabsContent>
      </Tabs>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} customRoles={roles.data} />
      <MemberSheet member={selected} customRoles={roles.data} onClose={() => setSelected(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={revoking && revoking.length > 1 ? `Retirer l’accès de ${revoking.length} membres ?` : `Retirer l’accès de ${revoking?.[0]?.displayName ?? ''} ?`}
        description="La personne ne pourra plus ouvrir le back-office de cet établissement. Son historique est conservé."
        confirmLabel="Retirer l’accès"
        destructive
        requireReason
        reasonLabel="Motif (obligatoire, conservé dans l’historique)"
        onConfirm={confirmRevoke}
      />
    </PageContainer>
  );
}
