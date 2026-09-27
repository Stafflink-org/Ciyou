// E-mails envoyés aux restaurants par l'équipe GoLink : validation, refus,
// documents manquants ou expirants, suspension, réactivation, message groupé.
import { APP_URLS, PLATFORM_NAME } from '../../lib/config';
import { renderEmail } from '../../lib/email-layout';
import type { EmailMessage } from '../../lib/emails';

const backOffice = (path = '/') => `${APP_URLS.restaurant}${path}`;

export function applicationApprovedEmail(input: { restaurantName: string; live: boolean }): EmailMessage {
  return {
    subject: `${input.restaurantName} est validé sur ${PLATFORM_NAME}`,
    ...renderEmail({
      preheader: 'Votre dossier a été validé par notre équipe.',
      eyebrow: 'Dossier validé',
      title: 'Bienvenue parmi nos partenaires',
      paragraphs: [
        'Bonne nouvelle : votre dossier est complet et validé.',
        input.live
          ? 'Votre établissement est désormais visible dans l’application GoLink. Ouvrez-le depuis votre back-office dès que vous êtes prêt à recevoir des commandes.'
          : 'Votre établissement sera mis en ligne très prochainement. Vérifiez votre carte et vos horaires en attendant.',
      ],
      details: [
        { label: 'Établissement', value: input.restaurantName },
        { label: 'Statut', value: input.live ? 'En ligne' : 'Validé' },
      ],
      cta: { label: 'Ouvrir mon back-office', url: backOffice('/') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function applicationRejectedEmail(input: { restaurantName: string; reason: string }): EmailMessage {
  return {
    subject: `Votre demande pour ${input.restaurantName}`,
    ...renderEmail({
      preheader: 'Votre dossier n’a pas pu être validé.',
      eyebrow: 'Inscription',
      title: 'Votre dossier n’a pas pu être validé',
      paragraphs: [
        'Après examen, nous ne pouvons pas donner suite à votre demande pour le moment.',
        `Motif : ${input.reason}`,
        'Si la situation évolue, vous pouvez nous recontacter depuis le support de votre back-office.',
      ],
      details: [{ label: 'Établissement', value: input.restaurantName }],
      footerReason: `Vous recevez cet e-mail suite à l’inscription de ${input.restaurantName} sur ${PLATFORM_NAME}.`,
    }),
  };
}

export function documentsMissingEmail(input: { restaurantName: string; reason: string; documents: string[] }): EmailMessage {
  return {
    subject: `Documents à compléter pour ${input.restaurantName}`,
    ...renderEmail({
      preheader: 'Il manque quelques pièces pour finaliser votre dossier.',
      eyebrow: 'Documents',
      title: 'Encore quelques pièces à déposer',
      paragraphs: [
        'Votre dossier est presque complet. Déposez les pièces ci-dessous depuis la rubrique Documents de votre back-office.',
        input.reason,
      ],
      details: input.documents.map((label) => ({ label, value: 'À déposer' })),
      cta: { label: 'Déposer mes documents', url: backOffice('/documents') },
      footerReason: `Vous recevez cet e-mail suite à l’inscription de ${input.restaurantName} sur ${PLATFORM_NAME}.`,
    }),
  };
}

export function documentRejectedEmail(input: { restaurantName: string; documentLabel: string; reason: string }): EmailMessage {
  return {
    subject: `Document refusé : ${input.documentLabel}`,
    ...renderEmail({
      preheader: 'Un justificatif doit être déposé à nouveau.',
      eyebrow: 'Documents',
      title: 'Un document doit être remplacé',
      paragraphs: [`Le document « ${input.documentLabel} » n’a pas pu être accepté.`, `Motif : ${input.reason}`],
      cta: { label: 'Déposer une nouvelle version', url: backOffice('/documents') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function documentExpiringEmail(input: { restaurantName: string; documentLabel: string; expiresOn: string; days: number }): EmailMessage {
  return {
    subject: `${input.documentLabel} : expiration dans ${input.days} jours`,
    ...renderEmail({
      preheader: 'Déposez la nouvelle version avant la date d’expiration.',
      eyebrow: 'Rappel',
      title: 'Un document arrive à expiration',
      paragraphs: [
        `Le document « ${input.documentLabel} » expire le ${input.expiresOn}.`,
        'Sans nouvelle version valide à cette date, la réception des commandes sera suspendue jusqu’au dépôt du document.',
      ],
      cta: { label: 'Mettre à jour mes documents', url: backOffice('/documents') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function documentExpiredEmail(input: { restaurantName: string; documentLabel: string }): EmailMessage {
  return {
    subject: `Commandes suspendues : ${input.documentLabel} expiré`,
    ...renderEmail({
      preheader: 'Déposez une version valide pour reprendre les commandes.',
      eyebrow: 'Documents',
      title: 'Un document obligatoire a expiré',
      paragraphs: [
        `Le document « ${input.documentLabel} » a expiré. La réception des commandes est suspendue.`,
        'Déposez une version en cours de validité : les commandes reprendront dès sa validation par notre équipe.',
      ],
      cta: { label: 'Déposer le document', url: backOffice('/documents') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function suspensionEmail(input: { restaurantName: string; reason: string; until: string | null; permanent: boolean; message?: string | null }): EmailMessage {
  return {
    subject: input.permanent ? `${input.restaurantName} : compte fermé` : `${input.restaurantName} : compte suspendu`,
    ...renderEmail({
      preheader: input.permanent ? 'Votre établissement a été retiré de la plateforme.' : 'La réception des commandes est suspendue.',
      eyebrow: 'Compte',
      title: input.permanent ? 'Votre établissement a été retiré' : 'Votre établissement est suspendu',
      paragraphs: [
        input.permanent
          ? 'Votre établissement n’est plus visible dans l’application GoLink.'
          : 'Votre établissement n’est temporairement plus visible dans l’application GoLink.',
        `Motif : ${input.reason}`,
        ...(input.message ? [input.message] : []),
      ],
      details: [{ label: 'Jusqu’au', value: input.until ?? (input.permanent ? 'Définitif' : 'Nouvel avis') }],
      cta: { label: 'Contacter le support', url: backOffice('/support') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function reactivationEmail(input: { restaurantName: string }): EmailMessage {
  return {
    subject: `${input.restaurantName} est de nouveau actif`,
    ...renderEmail({
      preheader: 'Vous pouvez à nouveau recevoir des commandes.',
      eyebrow: 'Compte',
      title: 'Votre établissement est réactivé',
      paragraphs: ['Votre établissement est de nouveau visible. Ouvrez-le depuis votre back-office pour reprendre les commandes.'],
      cta: { label: 'Ouvrir mon back-office', url: backOffice('/') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function partnerMessageEmail(input: { restaurantName: string; subject: string; message: string }): EmailMessage {
  return {
    subject: input.subject,
    ...renderEmail({
      preheader: input.message.slice(0, 90),
      eyebrow: 'Message de l’équipe GoLink',
      title: input.subject,
      paragraphs: input.message.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
      cta: { label: 'Ouvrir mon back-office', url: backOffice('/') },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} est partenaire de ${PLATFORM_NAME}.`,
    }),
  };
}

export function ownerAccessEmail(input: { restaurantName: string; firstName: string; link: string }): EmailMessage {
  return {
    subject: `Votre espace ${PLATFORM_NAME} pour ${input.restaurantName}`,
    ...renderEmail({
      preheader: 'Votre back-office est prêt.',
      eyebrow: 'Accès',
      title: 'Votre back-office est prêt',
      paragraphs: [
        `Bonjour ${input.firstName},`,
        `L’équipe ${PLATFORM_NAME} a créé l’espace de ${input.restaurantName}. Définissez votre mot de passe pour composer votre carte, régler vos horaires et déposer vos documents.`,
      ],
      cta: { label: 'Définir mon mot de passe', url: input.link },
      footerReason: `Vous recevez cet e-mail car ${input.restaurantName} a été inscrit sur ${PLATFORM_NAME}.`,
    }),
  };
}
