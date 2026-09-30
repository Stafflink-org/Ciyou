import { StrictMode, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Building2, CheckCircle2, Clock3, Mail, MapPin, ShieldCheck, Store, Wrench } from 'lucide-react';
import { Logo } from '@golink/ui';
import { createPublicLead, type LeadPayload } from './firebase';
import './styles.css';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

const initialForm: LeadPayload = {
  fullName: '',
  businessName: '',
  email: '',
  phone: '',
  city: '',
  message: '',
};

function App() {
  const [form, setForm] = useState<LeadPayload>(initialForm);
  const [state, setState] = useState<SubmitState>('idle');

  const update = (field: keyof LeadPayload, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (state !== 'idle') setState('idle');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState('submitting');
    try {
      await createPublicLead({
        fullName: form.fullName.trim(),
        businessName: form.businessName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        message: form.message.trim(),
      });
      setForm(initialForm);
      setState('success');
    } catch (error) {
      console.error(error);
      setState('error');
    }
  };

  return (
    <main className="site-shell">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <header className="topbar">
        <a className="brand" href="/" aria-label="Accueil Ciyou Eats">
          <Logo size={40} />
        </a>
        <nav className="top-actions" aria-label="Accès rapides">
          <a href="https://restaurant.ciyou.io" className="link-button muted">
            Accès restaurant
          </a>
          <a href="mailto:contact@ciyou.io" className="link-button primary">
            Nous contacter
          </a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><Wrench size={16} /> Plateforme en préparation</p>
          <h1>Ciyou Eats prépare son lancement officiel.</h1>
          <p className="lead">
            Notre site public est actuellement en réparation pour finaliser une expérience plus claire pour les restaurants,
            les livreurs et les clients. Les espaces professionnels restent accessibles pendant cette phase.
          </p>
          <div className="hero-actions">
            <a href="https://restaurant.ciyou.io" className="cta">
              Accéder au backoffice restaurant <ArrowRight size={18} />
            </a>
            <a href="https://admin.ciyou.io" className="secondary-cta">
              Accès équipe Ciyou
            </a>
          </div>
          <div className="status-row" aria-label="État des services">
            <span><CheckCircle2 size={17} /> Backoffice restaurant actif</span>
            <span><ShieldCheck size={17} /> Données sécurisées</span>
            <span><Clock3 size={17} /> Site public en finalisation</span>
          </div>
        </div>

        <aside className="notice-card" aria-label="Information de lancement">
          <div className="notice-icon"><Store size={30} /></div>
          <h2>Vous souhaitez devenir partenaire ?</h2>
          <p>
            Laissez vos coordonnées. Notre équipe vous recontactera pour vérifier votre établissement et préparer vos accès.
          </p>
          <ul>
            <li>Présentation de votre restaurant</li>
            <li>Configuration du backoffice</li>
            <li>Accompagnement au lancement</li>
          </ul>
        </aside>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-copy">
          <p className="eyebrow"><Mail size={16} /> Demande d’accès</p>
          <h2>Contactez l’équipe Ciyou Eats</h2>
          <p>
            Remplissez ce formulaire si vous souhaitez rejoindre la plateforme ou obtenir un accès restaurant. Nous vous
            répondrons dès que la validation de votre demande sera effectuée.
          </p>
          <div className="info-list">
            <span><Building2 size={18} /> Restaurants, franchises et commerces alimentaires</span>
            <span><MapPin size={18} /> Déploiement progressif par ville</span>
          </div>
        </div>

        <form className="contact-card" onSubmit={submit}>
          <div className="field-grid">
            <label>
              Nom complet *
              <input value={form.fullName} onChange={(e) => update('fullName', e.target.value)} required maxLength={120} autoComplete="name" />
            </label>
            <label>
              Restaurant / société *
              <input value={form.businessName} onChange={(e) => update('businessName', e.target.value)} required maxLength={140} autoComplete="organization" />
            </label>
          </div>
          <div className="field-grid">
            <label>
              E-mail professionnel *
              <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required maxLength={160} autoComplete="email" />
            </label>
            <label>
              Téléphone *
              <input value={form.phone} onChange={(e) => update('phone', e.target.value)} required maxLength={40} autoComplete="tel" />
            </label>
          </div>
          <label>
            Ville *
            <input value={form.city} onChange={(e) => update('city', e.target.value)} required maxLength={90} autoComplete="address-level2" />
          </label>
          <label>
            Message
            <textarea value={form.message} onChange={(e) => update('message', e.target.value)} maxLength={1200} rows={5} placeholder="Présentez votre activité, vos besoins ou la date souhaitée pour être rappelé." />
          </label>
          <button className="submit" type="submit" disabled={state === 'submitting'}>
            {state === 'submitting' ? 'Envoi en cours…' : 'Envoyer ma demande'}
          </button>
          {state === 'success' && <p className="form-message success">Votre demande a bien été envoyée. Nous vous contacterons prochainement.</p>}
          {state === 'error' && <p className="form-message error">L’envoi n’a pas abouti. Réessayez ou contactez-nous par e-mail.</p>}
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
