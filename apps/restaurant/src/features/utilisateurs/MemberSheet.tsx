import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import {
  Avatar,
  Button,
  FormField,
  RadioGroup,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  formatDate,
} from '@golink/ui';
import {
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  STAFF_ROLE_LABELS,
  memberHasPermission,
  type RestaurantMember,
  type RestaurantPermission,
  type StaffRole,
  type StaffRoleDefinition,
  type WithId,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { toDate, useMutation } from '@/lib/firestore';
import { setMemberPermissions } from '../parametres/kit/api';
import { Notice } from '../parametres/kit/ui';
import { PermissionMatrix } from './PermissionMatrix';
import { ROLE_DESCRIPTIONS } from './permissions-catalog';

type EditableRole = Exclude<StaffRole, 'owner'>;
const ROLES: EditableRole[] = ['manager', 'kitchen', 'service', 'accountant', 'employee', 'custom'];
const BESPOKE = '__bespoke__';

/** Détail d'un membre : rôle, droits sur mesure, rétablissement d'un accès retiré. */
export function MemberSheet({
  member,
  customRoles,
  onClose,
}: {
  member: WithId<RestaurantMember> | null;
  customRoles: Array<WithId<StaffRoleDefinition>>;
  onClose: () => void;
}) {
  const { restaurantId, member: me } = useRestaurantAccess();
  const [role, setRole] = useState<EditableRole>('service');
  const [customChoice, setCustomChoice] = useState<string>(BESPOKE);
  const [permissions, setPermissions] = useState<RestaurantPermission[]>([]);
  const save = useMutation(setMemberPermissions, { success: 'Accès mis à jour.' });

  useEffect(() => {
    if (!member || member.role === 'owner') return;
    setRole(member.role);
    setCustomChoice(member.customRoleId ?? BESPOKE);
    setPermissions(member.permissions);
  }, [member]);

  const effective = useMemo<RestaurantPermission[]>(() => {
    if (role !== 'custom') return [...DEFAULT_STAFF_ROLE_PERMISSIONS[role]];
    if (customChoice !== BESPOKE) return customRoles.find((r) => r.id === customChoice)?.permissions ?? [];
    return permissions;
  }, [role, customChoice, customRoles, permissions]);

  const grantable = (p: RestaurantPermission) => me.role === 'owner' || memberHasPermission(me, p);
  const beyond = effective.filter((p) => !grantable(p));
  const revoked = member ? !member.active : false;

  const submit = async () => {
    if (!member) return;
    const result = await save.mutate({
      restaurantId,
      uid: member.uid,
      role,
      customRoleId: role === 'custom' && customChoice !== BESPOKE ? customChoice : null,
      permissions: role === 'custom' && customChoice === BESPOKE ? permissions : null,
      reactivate: revoked || undefined,
    });
    if (result) onClose();
  };

  const revokedAt = toDate(member?.revokedAt);

  return (
    <Sheet open={member !== null} onOpenChange={(open) => !open && !save.loading && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        {member && (
          <>
            <SheetHeader
              title={member.displayName}
              description={member.email}
              icon={<Avatar name={member.displayName} size="sm" />}
            />
            <SheetBody className="space-y-6">
              {revoked && (
                <Notice tone="amber" title="Accès retiré" icon={<RotateCcw />}>
                  {revokedAt ? `Le ${formatDate(revokedAt)}` : 'Accès désactivé'}
                  {member.revokeReason ? ` · « ${member.revokeReason} »` : ''}. Choisissez un rôle puis rétablissez l’accès.
                </Notice>
              )}
              <div>
                <p className="mb-2 text-sm font-medium text-fg">Rôle</p>
                <RadioGroup
                  variant="cards"
                  value={role}
                  onValueChange={(v) => setRole(v as EditableRole)}
                  options={ROLES.map((r) => ({
                    value: r,
                    label: r === 'custom' ? 'Sur mesure' : STAFF_ROLE_LABELS[r],
                    description: ROLE_DESCRIPTIONS[r],
                    disabled: r === 'manager' && !['owner', 'manager'].includes(me.role),
                  }))}
                />
              </div>
              {role === 'custom' && (
                <FormField label="Modèle de droits" hint="Un rôle partagé se met à jour pour tous ses membres ; « Droits individuels » ne concerne que cette personne.">
                  <Select
                    value={customChoice}
                    onValueChange={(v) => {
                      setCustomChoice(v);
                      if (v === BESPOKE && permissions.length === 0) setPermissions(member.permissions);
                    }}
                    options={[
                      { value: BESPOKE, label: 'Droits individuels' },
                      ...customRoles.map((r) => ({ value: r.id, label: r.name, description: `${r.permissions.length} droits` })),
                    ]}
                  />
                </FormField>
              )}
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-fg">Droits accordés</p>
                  <span className="font-mono text-xs text-fg-subtle num">{effective.length} droits</span>
                </div>
                {beyond.length > 0 && (
                  <Notice tone="amber" className="mb-3">
                    Ce rôle comprend des droits que vous ne possédez pas : seul le propriétaire peut l’attribuer.
                  </Notice>
                )}
                <PermissionMatrix
                  compact
                  value={effective}
                  readOnly={!(role === 'custom' && customChoice === BESPOKE)}
                  grantable={grantable}
                  onChange={setPermissions}
                />
              </div>
            </SheetBody>
            <SheetFooter>
              <Button variant="ghost" onClick={onClose} disabled={save.loading}>
                Annuler
              </Button>
              <Button
                variant="primary"
                leftIcon={revoked ? <RotateCcw /> : <Save />}
                loading={save.loading}
                disabled={beyond.length > 0 || effective.length === 0}
                onClick={() => void submit()}
              >
                {revoked ? 'Rétablir l’accès' : 'Enregistrer'}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
