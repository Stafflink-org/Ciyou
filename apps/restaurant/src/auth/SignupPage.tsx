// Inscription autonome d'un commerce (décision client : validation automatique si possible).
// Appelle la fonction publique `restaurantSignup` pour les six pays (FR, BE, LU, DZ, MA, TN),
// contrôle en direct le format du numéro d'immatriculation, puis ouvre la session du gérant.
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, Building2, CheckCircle2, Mail, MapPin, Phone, User } from 'lucide-react';
import { Button, Checkbox, FormField, Input, Select } from '@golink/ui';
import { checkRegistrationNumber } from '@golink/shared';
import { AuthAlert, AuthHeading, PasswordInput, useAuth, useDocumentTitle, useTranslation } from '@golink/web';
import { callFunction, errorMessage } from '@/lib/firestore';
import { AuthPageLayout } from './pages';

const COUNTRY_CODES = ['FR', 'BE', 'LU', 'DZ', 'MA', 'TN'] as const;
type CountryCode = (typeof COUNTRY_CODES)[number];

interface SignupInput {
  restaurant: {
    name: string;
    phone: string;
    address: { line1: string; postalCode: string; city: string; countryCode: CountryCode };
  };
  owner: { firstName: string; lastName: string; email: string; phone: string; password: string };
  legal: { legalName: string; registrationNumber: string; vatNumber?: string };
  acceptTerms: true;
  referralCode?: string;
}

interface SignupResult {
  status: 'pending' | 'waitlisted';
  restaurantId: string | null;
  prospectId: string | null;
}

const signup = callFunction<SignupInput, SignupResult>('restaurantSignup');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 .()-]{6,20}$/;
const POSTAL = /^(L-)?\d{4,5}$/;

export function SignupPage() {
  const { t } = useTranslation('inscription');
  useDocumentTitle(t('title'));
  const { signIn } = useAuth();
  const [params] = useSearchParams();
  const [referral, setReferral] = useState((params.get('parrain') ?? '').toUpperCase().slice(0, 20));
  const [country, setCountry] = useState<CountryCode>('FR');
  const [values, setValues] = useState({
    name: '',
    businessPhone: '',
    line1: '',
    postalCode: '',
    city: '',
    legalName: '',
    registration: '',
    vat: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);

  const set = (key: keyof typeof values) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const registration = useMemo(() => (values.registration.trim() ? checkRegistrationNumber(country, values.registration) : null), [country, values.registration]);

  const errors = {
    name: values.name.trim().length < 2 ? t('errors.required') : undefined,
    businessPhone: !PHONE.test(values.businessPhone.trim()) ? t('errors.phone') : undefined,
    line1: values.line1.trim().length < 3 ? t('errors.required') : undefined,
    postalCode: !POSTAL.test(values.postalCode.trim()) ? t('errors.postalCode') : undefined,
    city: values.city.trim().length < 2 ? t('errors.required') : undefined,
    legalName: values.legalName.trim().length < 2 ? t('errors.required') : undefined,
    registration: !registration ? t('errors.required') : registration.ok ? undefined : registration.detail,
    firstName: !values.firstName.trim() ? t('errors.required') : undefined,
    lastName: !values.lastName.trim() ? t('errors.required') : undefined,
    email: !EMAIL.test(values.email.trim()) ? t('errors.email') : undefined,
    phone: !PHONE.test(values.phone.trim()) ? t('errors.phone') : undefined,
    password: values.password.length < 10 || !/[A-Za-z]/.test(values.password) || !/[0-9]/.test(values.password) ? t('errors.password') : undefined,
    terms: terms ? undefined : t('errors.terms'),
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    setError(null);
    setLoading(true);
    try {
      const response = await signup({
        restaurant: {
          name: values.name.trim(),
          phone: values.businessPhone.trim(),
          address: { line1: values.line1.trim(), postalCode: values.postalCode.trim(), city: values.city.trim(), countryCode: country },
        },
        owner: { firstName: values.firstName.trim(), lastName: values.lastName.trim(), email: values.email.trim(), phone: values.phone.trim(), password: values.password },
        legal: { legalName: values.legalName.trim(), registrationNumber: values.registration.trim(), ...(values.vat.trim() ? { vatNumber: values.vat.trim() } : {}) },
        acceptTerms: true,
        ...(referral.trim() ? { referralCode: referral.trim() } : {}),
      });
      setResult(response);
      // Commerce créé : la session du gérant s'ouvre (la garde de route ouvre alors l'espace).
      if (response.status === 'pending') await signIn(values.email.trim(), values.password, true).catch(() => undefined);
    } catch (caught) {
      setError(errorMessage(caught, t('errors.failed')));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const waitlisted = result.status === 'waitlisted';
    return (
      <AuthPageLayout>
        <div className="space-y-6">
          <span className="grid size-12 place-items-center rounded-2xl bg-success-soft text-success [&_svg]:size-6">
            <CheckCircle2 />
          </span>
          <AuthHeading title={t(waitlisted ? 'waitlist.title' : 'done.title')} description={t(waitlisted ? 'waitlist.text' : 'done.text', { email: values.email.trim(), city: values.city.trim() })} />
          <Button asChild variant="primary" size="lg" block>
            <Link to="/connexion">
              {t(waitlisted ? 'waitlist.cta' : 'done.cta')}
              <ArrowRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout>
      <AuthHeading eyebrow={t('eyebrow')} title={t('heading')} description={t('description')} />
      <form onSubmit={submit} noValidate className="space-y-6" aria-busy={loading}>
        <fieldset className="space-y-4">
          <legend className="eyebrow mb-3 text-fg-muted">{t('sections.business')}</legend>
          <FormField label={t('fields.country')}>
            <Select
              value={country}
              onValueChange={(v) => setCountry(v as CountryCode)}
              options={COUNTRY_CODES.map((c) => ({ value: c, label: t(`countries.${c}`) }))}
              size="lg"
              aria-label={t('fields.country')}
            />
          </FormField>
          <FormField label={t('fields.businessName')} error={show('name')}>
            <Input size="lg" value={values.name} onChange={(e) => set('name')(e.target.value)} autoComplete="organization" leading={<Building2 />} invalid={Boolean(show('name'))} />
          </FormField>
          <FormField label={t('fields.businessPhone')} error={show('businessPhone')}>
            <Input size="lg" type="tel" inputMode="tel" value={values.businessPhone} onChange={(e) => set('businessPhone')(e.target.value)} leading={<Phone />} invalid={Boolean(show('businessPhone'))} />
          </FormField>
          <FormField label={t('fields.address')} error={show('line1')}>
            <Input size="lg" value={values.line1} onChange={(e) => set('line1')(e.target.value)} autoComplete="address-line1" leading={<MapPin />} invalid={Boolean(show('line1'))} />
          </FormField>
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
            <FormField label={t('fields.postalCode')} error={show('postalCode')}>
              <Input size="lg" inputMode="numeric" value={values.postalCode} onChange={(e) => set('postalCode')(e.target.value)} autoComplete="postal-code" invalid={Boolean(show('postalCode'))} />
            </FormField>
            <FormField label={t('fields.city')} error={show('city')}>
              <Input size="lg" value={values.city} onChange={(e) => set('city')(e.target.value)} autoComplete="address-level2" invalid={Boolean(show('city'))} />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="eyebrow mb-3 text-fg-muted">{t('sections.legal')}</legend>
          <FormField label={t('fields.legalName')} error={show('legalName')}>
            <Input size="lg" value={values.legalName} onChange={(e) => set('legalName')(e.target.value)} invalid={Boolean(show('legalName'))} />
          </FormField>
          <FormField label={t(`registrationLabels.${country}`)} error={touched || values.registration ? errors.registration : undefined} hint={registration?.ok ? t('registrationOk') : undefined}>
            <Input size="lg" value={values.registration} onChange={(e) => set('registration')(e.target.value)} inputMode="text" autoCapitalize="characters" invalid={Boolean(values.registration && registration && !registration.ok)} />
          </FormField>
          <FormField label={t('fields.vat')}>
            <Input size="lg" value={values.vat} onChange={(e) => set('vat')(e.target.value)} autoCapitalize="characters" />
          </FormField>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="eyebrow mb-3 text-fg-muted">{t('sections.account')}</legend>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('fields.firstName')} error={show('firstName')}>
              <Input size="lg" value={values.firstName} onChange={(e) => set('firstName')(e.target.value)} autoComplete="given-name" leading={<User />} invalid={Boolean(show('firstName'))} />
            </FormField>
            <FormField label={t('fields.lastName')} error={show('lastName')}>
              <Input size="lg" value={values.lastName} onChange={(e) => set('lastName')(e.target.value)} autoComplete="family-name" invalid={Boolean(show('lastName'))} />
            </FormField>
          </div>
          <FormField label={t('fields.email')} error={show('email')}>
            <Input size="lg" type="email" inputMode="email" value={values.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" leading={<Mail />} invalid={Boolean(show('email'))} />
          </FormField>
          <FormField label={t('fields.phone')} error={show('phone')}>
            <Input size="lg" type="tel" inputMode="tel" value={values.phone} onChange={(e) => set('phone')(e.target.value)} autoComplete="tel" leading={<Phone />} invalid={Boolean(show('phone'))} />
          </FormField>
          <FormField label={t('fields.password')} error={show('password')} hint={t('fields.passwordHint')}>
            <PasswordInput value={values.password} onChange={set('password')} autoComplete="new-password" invalid={Boolean(show('password'))} />
          </FormField>
          <FormField label={t('fields.referral')} hint={t('fields.referralHint')}>
            <Input size="lg" value={referral} maxLength={20} onChange={(e) => setReferral(e.target.value.toUpperCase())} autoComplete="off" />
          </FormField>
        </fieldset>

        <div className="space-y-1.5">
          <Checkbox label={t('terms')} checked={terms} onCheckedChange={(checked) => setTerms(checked === true)} />
          {show('terms') && <p className="text-xs text-danger">{show('terms')}</p>}
        </div>
        {error && <AuthAlert>{error}</AuthAlert>}
        <Button type="submit" variant="primary" size="lg" block loading={loading} rightIcon={<ArrowRight className="rtl:-scale-x-100" />}>
          {t('submit')}
        </Button>
        <p className="text-center text-sm text-fg-muted">
          {t('haveAccount')}{' '}
          <Link to="/connexion" className="font-medium text-primary-soft-fg hover:underline">
            {t('login')}
          </Link>
        </p>
      </form>
    </AuthPageLayout>
  );
}
