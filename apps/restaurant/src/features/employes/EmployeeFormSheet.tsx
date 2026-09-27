import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { addDoc, doc, orderBy, query, updateDoc } from 'firebase/firestore';
import { UserRoundPlus, UserRoundPen } from 'lucide-react';
import {
  Button,
  FormField,
  Input,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  cn,
} from '@golink/ui';
import {
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  STAFF_ROLE_LABELS,
  paths,
  type Employee,
  type RestaurantMember,
  type WithId,
} from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, updatedFields, useCollection, useMutation } from '@/lib/firestore';
import { todayIso } from '../_rh/dates';

/** Couleurs proposées pour distinguer les salariés au planning. */
export const EMPLOYEE_COLORS = ['#19343b', '#e8784b', '#4a846c', '#9467a5', '#4a7fbb', '#e09b24', '#31968b', '#d6533f', '#577b90', '#c39d6b'];

const DEPARTMENTS = ['Cuisine', 'Salle', 'Direction', 'Livraison', 'Plonge', 'Administration'];

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

const schema = z
  .object({
    firstName: z.string().trim().min(1, 'Indiquez le prénom').max(60),
    lastName: z.string().trim().min(1, 'Indiquez le nom').max(60),
    email: z.string().trim().email('Adresse e-mail invalide').optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 .()-]{6,20}$/, 'Numéro invalide')
      .optional()
      .or(z.literal('')),
    position: z.string().trim().min(2, 'Indiquez le poste').max(60),
    department: optionalText(40),
    contractType: z.enum(CONTRACT_TYPES),
    status: z.enum(EMPLOYEE_STATUSES),
    hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date requise'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    weeklyHours: z.coerce.number<string>().min(1, 'Au moins 1 h').max(48, '48 h au maximum'),
    hourlyRate: z
      .string()
      .trim()
      .regex(/^\d{1,3}([.,]\d{1,2})?$/, 'Montant invalide (ex. 12,50)'),
    classification: optionalText(80),
    socialCategory: z.enum(['employee', 'supervisor', 'executive']),
    socialSecurityLast4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, '4 chiffres')
      .optional()
      .or(z.literal('')),
    withholdingRate: z
      .string()
      .trim()
      .regex(/^\d{1,2}([.,]\d{1,2})?$/, 'Taux invalide')
      .optional()
      .or(z.literal('')),
    paidLeaveBalanceDays: z.coerce.number<string>().min(-30).max(90),
    rttBalanceDays: z.coerce.number<string>().min(-30).max(60),
    color: z.string(),
    uid: z.string().optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.hireDate, { path: ['endDate'], message: 'La fin doit suivre l’entrée' });

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

const toCents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);

function defaults(employee?: WithId<Employee> | null): FormInput {
  return {
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    position: employee?.position ?? '',
    department: employee?.department ?? 'Cuisine',
    contractType: employee?.contractType ?? 'cdi',
    status: employee?.status ?? 'active',
    hireDate: employee?.hireDate ?? todayIso(),
    endDate: employee?.endDate ?? '',
    weeklyHours: String(employee?.weeklyHours ?? 35),
    hourlyRate: employee ? (employee.hourlyRateCents / 100).toFixed(2).replace('.', ',') : '12,02',
    classification: employee?.classification ?? '',
    socialCategory: employee?.socialCategory ?? 'employee',
    socialSecurityLast4: employee?.socialSecurityLast4 ?? '',
    withholdingRate:
      employee?.withholdingTaxRateBps !== null && employee?.withholdingTaxRateBps !== undefined
        ? (employee.withholdingTaxRateBps / 100).toString().replace('.', ',')
        : '',
    paidLeaveBalanceDays: String(employee?.paidLeaveBalanceDays ?? 0),
    rttBalanceDays: String(employee?.rttBalanceDays ?? 0),
    color: employee?.color ?? EMPLOYEE_COLORS[0]!,
    uid: employee?.uid ?? '',
  };
}

export function EmployeeFormSheet({
  open,
  onOpenChange,
  employee,
  employees,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: WithId<Employee> | null;
  employees: WithId<Employee>[];
  onSaved?: (id: string) => void;
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const members = useCollection<RestaurantMember>(open ? query(collectionAt(paths.restaurantSub(restaurantId, 'members')), orderBy('displayName')) : null);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema), defaultValues: defaults(employee) });
  const { register, control, handleSubmit, reset, watch, formState } = form;
  const { errors } = formState;

  useEffect(() => {
    if (open) reset(defaults(employee));
  }, [open, employee, reset]);

  const linkedUids = useMemo(
    () => new Set(employees.filter((e) => e.uid && e.id !== employee?.id).map((e) => e.uid!)),
    [employees, employee?.id],
  );
  const memberOptions = [
    { value: 'none', label: 'Aucun compte relié' },
    ...members.data
      .filter((m) => m.role !== 'owner' && !linkedUids.has(m.id))
      .map((m) => ({ value: m.id, label: m.displayName, description: `${STAFF_ROLE_LABELS[m.role]} · ${m.email}` })),
  ];
  const contract = watch('contractType');
  const needsEnd = contract !== 'cdi';

  const save = useMutation(
    async (values: FormOutput) => {
      const data = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email || null,
        phone: values.phone || null,
        position: values.position,
        department: values.department || null,
        contractType: values.contractType,
        status: values.status,
        hireDate: values.hireDate,
        endDate: values.endDate || null,
        weeklyHours: values.weeklyHours,
        hourlyRateCents: toCents(values.hourlyRate),
        classification: values.classification || null,
        coefficient: employee?.coefficient ?? null,
        socialCategory: values.socialCategory,
        socialSecurityLast4: values.socialSecurityLast4 || null,
        withholdingTaxRateBps: values.withholdingRate ? Math.round(Number(values.withholdingRate.replace(',', '.')) * 100) : null,
        paidLeaveBalanceDays: values.paidLeaveBalanceDays,
        rttBalanceDays: values.rttBalanceDays,
        color: values.color,
        uid: values.uid && values.uid !== 'none' ? values.uid : null,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'employees'));
      if (employee) {
        await updateDoc(doc(collection, employee.id), { ...data, ...updatedFields(user!.uid) });
        return employee.id;
      }
      const created = await addDoc(collection, { ...data, clockPinHash: null, ...createdFields(user!.uid) });
      return created.id;
    },
    { success: employee ? 'Fiche mise à jour' : 'Salarié ajouté à l’équipe' },
  );

  const submit = handleSubmit(async (values) => {
    const id = await save.mutate(values);
    if (id) {
      onOpenChange(false);
      onSaved?.(id);
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader
          icon={employee ? <UserRoundPen /> : <UserRoundPlus />}
          title={employee ? `Modifier la fiche de ${employee.firstName}` : 'Nouveau salarié'}
          description="Identité, contrat et rémunération. Ces informations alimentent le planning, les pointages et la paie."
        />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <SheetBody className="space-y-6">
            <fieldset className="space-y-4">
              <legend className="eyebrow mb-3">Identité</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Prénom" required error={errors.firstName?.message}>
                  <Input autoComplete="off" {...register('firstName')} />
                </FormField>
                <FormField label="Nom" required error={errors.lastName?.message}>
                  <Input autoComplete="off" {...register('lastName')} />
                </FormField>
                <FormField label="E-mail" error={errors.email?.message}>
                  <Input type="email" autoComplete="off" {...register('email')} />
                </FormField>
                <FormField label="Téléphone" error={errors.phone?.message}>
                  <Input type="tel" autoComplete="off" {...register('phone')} />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="eyebrow mb-3">Poste et contrat</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Poste" required error={errors.position?.message}>
                  <Input placeholder="Cuisinier, serveuse, plonge…" {...register('position')} />
                </FormField>
                <FormField label="Service">
                  <Controller
                    control={control}
                    name="department"
                    render={({ field }) => (
                      <Select value={field.value || 'Cuisine'} onValueChange={field.onChange} options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} />
                    )}
                  />
                </FormField>
                <FormField label="Type de contrat">
                  <Controller
                    control={control}
                    name="contractType"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} options={CONTRACT_TYPES.map((c) => ({ value: c, label: CONTRACT_TYPE_LABELS[c] }))} />
                    )}
                  />
                </FormField>
                <FormField label="Statut">
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} options={EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] }))} />
                    )}
                  />
                </FormField>
                <FormField label="Date d’entrée" required error={errors.hireDate?.message}>
                  <Input type="date" {...register('hireDate')} />
                </FormField>
                <FormField label={needsEnd ? 'Date de fin de contrat' : 'Date de sortie'} error={errors.endDate?.message} hint={needsEnd ? undefined : 'Uniquement en cas de départ.'}>
                  <Input type="date" {...register('endDate')} />
                </FormField>
                <FormField label="Classification" hint="Convention HCR : niveau et échelon.">
                  <Input placeholder="Niveau II, échelon 2" {...register('classification')} />
                </FormField>
                <FormField label="Catégorie">
                  <Controller
                    control={control}
                    name="socialCategory"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        options={[
                          { value: 'employee', label: 'Employé' },
                          { value: 'supervisor', label: 'Agent de maîtrise' },
                          { value: 'executive', label: 'Cadre' },
                        ]}
                      />
                    )}
                  />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="eyebrow mb-3">Temps de travail et rémunération</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Heures par semaine" required error={errors.weeklyHours?.message}>
                  <Input type="number" inputMode="decimal" step="0.5" min={1} max={48} trailing="h" {...register('weeklyHours')} />
                </FormField>
                <FormField label="Taux horaire brut" required error={errors.hourlyRate?.message}>
                  <Input inputMode="decimal" trailing="€" {...register('hourlyRate')} />
                </FormField>
                <FormField label="Taux de prélèvement à la source" hint="Vide : taux neutre du barème." error={errors.withholdingRate?.message}>
                  <Input inputMode="decimal" trailing="%" {...register('withholdingRate')} />
                </FormField>
                <FormField label="N° de sécurité sociale" hint="Seuls les 4 derniers chiffres sont conservés." error={errors.socialSecurityLast4?.message}>
                  <Input inputMode="numeric" maxLength={4} placeholder="1234" {...register('socialSecurityLast4')} />
                </FormField>
                <FormField label="Solde de congés payés" error={errors.paidLeaveBalanceDays?.message}>
                  <Input type="number" step="0.5" trailing="j" {...register('paidLeaveBalanceDays')} />
                </FormField>
                <FormField label="Solde de RTT" error={errors.rttBalanceDays?.message}>
                  <Input type="number" step="0.5" trailing="j" {...register('rttBalanceDays')} />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="eyebrow mb-3">Planning et accès</legend>
              <FormField label="Couleur au planning">
                <Controller
                  control={control}
                  name="color"
                  render={({ field }) => (
                    <div role="radiogroup" aria-label="Couleur au planning" className="flex flex-wrap gap-2">
                      {EMPLOYEE_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={field.value === color}
                          aria-label={`Couleur ${color}`}
                          onClick={() => field.onChange(color)}
                          className={cn(
                            'size-8 rounded-full border-2 border-surface shadow-xs ring-2 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring',
                            field.value === color ? 'ring-fg' : 'ring-transparent',
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                />
              </FormField>
              <FormField label="Compte GoLink relié" hint="Permet au salarié de voir son planning, de pointer et de demander ses absences.">
                <Controller
                  control={control}
                  name="uid"
                  render={({ field }) => (
                    <Select value={field.value || 'none'} onValueChange={field.onChange} options={memberOptions} placeholder={members.loading ? 'Chargement…' : undefined} />
                  )}
                />
              </FormField>
            </fieldset>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={save.loading}>
              {employee ? 'Enregistrer' : 'Ajouter le salarié'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

