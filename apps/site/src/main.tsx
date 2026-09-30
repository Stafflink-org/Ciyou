import { StrictMode, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Building2, CheckCircle2, Clock3, Mail, MapPin, ShieldCheck, Store, Wrench } from 'lucide-react';
import { Logo } from '@golink/ui';
import './styles.css';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

interface LeadPayload {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  city: string;
  message: string;
}

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
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          businessName: form.businessName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          city: form.city.trim(),
          message: form.message.trim(),
        }),
      });
      if (!response.ok) throw new Error('contact_failed');
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

      <div className="route-art" aria-hidden="true">
        <svg viewBox="0 0 780 360" role="presentation">
          <path className="route-shadow" d="M52 288 C178 276 218 234 318 210 C412 188 472 190 528 118 C586 44 684 50 746 48" />
          <path className="route-line" d="M52 288 C178 276 218 234 318 210 C412 188 472 190 528 118 C586 44 684 50 746 48" />
          <circle className="route-start-halo" cx="52" cy="288" r="46" />
          <circle className="route-start" cx="52" cy="288" r="18" />
          <circle className="route-start-core" cx="52" cy="288" r="8" />
          <circle className="route-mid" cx="612" cy="56" r="16" />
          <circle className="route-end-halo" cx="746" cy="48" r="54" />
          <circle className="route-end" cx="746" cy="48" r="24" />
          <circle className="route-end-core" cx="746" cy="48" r="12" />
        </svg>
      </div>

      <header className="topbar">
        <a className="brand" href="/" aria-label="Accueil Ciyou Eats">
          <Logo size={40} />
        </a>
        <nav className="top-actions" aria-label="Accès rapides">
          <a href="https://restaurant.ciyou.io" className="link-button muted">
            Accès restaurant
          </a>
          <a href="#contact" className="link-button primary">
            Nous contacter
          </a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><Wrench size={16} /> Plateforme en préparation</p>
          <h1>Votre restaurant, <span>livré avec soin.</span></h1>
          <p className="lead">
            Le site public Ciyou Eats est en préparation. Nous finalisons une expérience claire pour les restaurants,
            les livreurs et les clients, avec un backoffice partenaire déjà accessible.
          </p>
          <div className="hero-actions">
            <a href="https://restaurant.ciyou.io" className="cta">
              Accéder au backoffice restaurant <ArrowRight size={18} />
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
            <span><Building2 size={18} /> Restaurants</span>
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
          {state === 'error' && <p className="form-message error">L’envoi n’a pas abouti. Réessayez dans quelques instants.</p>}
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
