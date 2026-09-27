import { useEffect, useState } from 'react';
import { MailPlus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  RadioGroup,
  Select,
} from '@golink/ui';
import { STAFF_ROLE_LABELS, type StaffRole, type StaffRoleDefinition, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { useMutation } from '@/lib/firestore';
import { inviteRestaurantMember } from '../parametres/kit/api';
import { ROLE_DESCRIPTIONS } from './permissions-catalog';

type InviteRole = Exclude<StaffRole, 'owner'>;
const ROLES: InviteRole[] = ['manager', 'kitchen', 'service', 'accountant', 'employee', 'custom'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Invitation d'un membre : un e-mail lui permet de définir son mot de passe ou de se connecter. */
export function InviteDialog({
  open,
  onOpenChange,
  customRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customRoles: Array<WithId<StaffRoleDefinition>>;
}) {
  const { restaurant, restaurantId, member } = useRestaurantAccess();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<InviteRole>('service');
  const [customRoleId, setCustomRoleId] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);
  const invite = useMutation(inviteRestaurantMember, {
    success: (r) => (r.emailSent ? 'Invitation envoyée par e-mail.' : 'Accès créé. L’e-mail n’a pas pu partir : transmettez le lien de connexion vous-même.'),
  });

  useEffect(() => {
    if (open) {
      setEmail('');
      setFirstName('');
      setLastName('');
      setRole('service');
      setCustomRoleId(undefined);
      setTouched(false);
    }
  }, [open]);

  const canInviteManager = member.role === 'owner' || member.role === 'manager';
  const errors = {
    email: !EMAIL.test(email.trim()) ? 'Adresse e-mail invalide.' : null,
    firstName: !firstName.trim() ? 'Obligatoire.' : null,
    lastName: !lastName.trim() ? 'Obligatoire.' : null,
    customRole: role === 'custom' && !customRoleId ? 'Choisissez un rôle sur mesure.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    const result = await invite.mutate({
      restaurantId,
      email: email.trim().toLowerCase(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role,
      ...(role === 'custom' && customRoleId ? { customRoleId } : {}),
    });
    if (result) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !invite.loading && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader icon={<MailPlus />} title="Inviter un membre" description={`La personne recevra un e-mail pour accéder au back-office de ${restaurant.name}.`} />
        <DialogBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Prénom" required error={touched ? errors.firstName : undefined}>
              <Input value={firstName} autoComplete="off" onChange={(e) => setFirstName(e.target.value)} />
            </FormField>
            <FormField label="Nom" required error={touched ? errors.lastName : undefined}>
              <Input value={lastName} autoComplete="off" onChange={(e) => setLastName(e.target.value)} />
            </FormField>
          </div>
          <FormField label="E-mail professionnel" required error={touched ? errors.email : undefined}>
            <Input type="email" value={email} autoComplete="off" placeholder="prenom.nom@exemple.fr" onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <div>
            <p className="mb-2 text-sm font-medium text-fg">Rôle</p>
            <RadioGroup
              variant="cards"
              value={role}
              onValueChange={(v) => setRole(v as InviteRole)}
              options={ROLES.map((r) => ({
                value: r,
                label: r === 'custom' ? 'Sur mesure' : STAFF_ROLE_LABELS[r],
                description: ROLE_DESCRIPTIONS[r],
                disabled: (r === 'manager' && !canInviteManager) || (r === 'custom' && customRoles.length === 0),
              }))}
            />
            {customRoles.length === 0 && <p className="mt-2 text-xs text-fg-subtle">Créez d’abord un rôle sur mesure dans l’onglet « Rôles et permissions ».</p>}
          </div>
          {role === 'custom' && (
            <FormField label="Rôle sur mesure" required error={touched ? errors.customRole : undefined}>
              <Select
                value={customRoleId}
                placeholder="Choisir un rôle"
                onValueChange={setCustomRoleId}
                options={customRoles.map((r) => ({ value: r.id, label: r.name, description: `${r.permissions.length} droits` }))}
              />
            </FormField>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={invite.loading}>
            Annuler
          </Button>
          <Button variant="primary" leftIcon={<MailPlus />} loading={invite.loading} onClick={() => void submit()}>
            Envoyer l’invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
