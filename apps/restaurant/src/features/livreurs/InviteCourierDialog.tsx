import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailPlus } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, Select } from '@golink/ui';
import { VEHICLE_LABELS, VEHICLE_TYPES, type RestaurantDeliveryZone, type VehicleType, type WithId } from '@golink/shared';
import { callFunction, useMutation } from '@/lib/firestore';

export const inviteOwnCourier = callFunction<
  { restaurantId: string; firstName: string; lastName: string; email: string; phone: string; vehicle: VehicleType; zoneIds: string[] },
  { driverId: string; newAccount: boolean; emailSent: boolean; resent: boolean }
>('inviteOwnCourier');

const schema = z.object({
  firstName: z.string().trim().min(1, 'Indiquez le prénom.').max(80),
  lastName: z.string().trim().min(1, 'Indiquez le nom.').max(80),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.'),
  phone: z.string().trim().regex(/^\+?[0-9 .()-]{6,20}$/, 'Numéro de téléphone invalide.'),
  vehicle: z.enum(VEHICLE_TYPES),
  zoneIds: z.array(z.string()),
});
type FormValues = z.infer<typeof schema>;

/** Invitation d'un livreur propre : e-mail d'activation et accès à l'application Ciyou Eats Livreur. */
export function InviteCourierDialog({
  open,
  onOpenChange,
  restaurantId,
  zones,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  zones: WithId<RestaurantDeliveryZone>[];
  initial?: Partial<FormValues>;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', vehicle: 'e_bike', zoneIds: [], ...initial },
  });
  const invite = useMutation(inviteOwnCourier, {
    success: (r) => (r.resent ? 'Invitation renvoyée.' : r.emailSent ? 'Invitation envoyée par e-mail.' : 'Livreur ajouté. L’e-mail n’a pas pu partir : renvoyez l’invitation plus tard.'),
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const result = await invite.mutate({ restaurantId, ...values });
    if (result) {
      form.reset();
      onOpenChange(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !invite.loading && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<MailPlus />}
          title="Inviter un livreur"
          description="Il recevra un e-mail pour activer son compte, puis se connectera à l’application Ciyou Eats Livreur pour recevoir vos courses."
        />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Prénom" required error={errors.firstName?.message}>
              <Input autoComplete="off" {...form.register('firstName')} />
            </FormField>
            <FormField label="Nom" required error={errors.lastName?.message}>
              <Input autoComplete="off" {...form.register('lastName')} />
            </FormField>
            <FormField label="E-mail" required error={errors.email?.message} hint="Adresse personnelle du livreur.">
              <Input type="email" autoComplete="off" {...form.register('email')} />
            </FormField>
            <FormField label="Téléphone" required error={errors.phone?.message}>
              <Input type="tel" autoComplete="off" placeholder="+33 6 12 34 56 78" {...form.register('phone')} />
            </FormField>
            <FormField label="Véhicule" className="sm:col-span-2">
              <Controller
                control={form.control}
                name="vehicle"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} options={VEHICLE_TYPES.map((v) => ({ value: v, label: VEHICLE_LABELS[v] }))} />
                )}
              />
            </FormField>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-medium text-fg">Zones de livraison</p>
              {zones.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-strong p-3 text-sm text-fg-muted">
                  Aucune zone de livraison propre n’est définie. Vous pourrez les attribuer après les avoir créées dans « Zones de livraison ».
                </p>
              ) : (
                <Controller
                  control={form.control}
                  name="zoneIds"
                  render={({ field }) => (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {zones.map((zone) => {
                        const checked = field.value.includes(zone.id);
                        return (
                          <label key={zone.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => field.onChange(value === true ? [...field.value, zone.id] : field.value.filter((id) => id !== zone.id))}
                            />
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: zone.color }} />
                            <span className="truncate">{zone.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                />
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={invite.loading}>
              Annuler
            </Button>
            <Button type="submit" loading={invite.loading} leftIcon={<MailPlus />}>
              Envoyer l’invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
