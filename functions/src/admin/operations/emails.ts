// E-mails adressés aux livreurs par l'exploitation : décision sur l'inscription,
// sanction, document expiré. Mise en page commune GoLink.
import { PARTNER_DOCUMENT_LABELS, SANCTION_TYPE_LABELS, type PartnerDocumentType, type SanctionType } from '@golink/shared';
import { PLATFORM_NAME } from '../../lib/config';
import { renderEmail } from '../../lib/email-layout';
import type { EmailMessage } from '../../lib/emails';

const footer = `Vous recevez cet e-mail car vous êtes inscrit comme livreur sur ${PLATFORM_NAME}.`;

export function driverApprovedEmail(firstName: string, cityName: string): EmailMessage {
  return {
    subject: `Votre compte livreur ${PLATFORM_NAME} est validé`,
    ...renderEmail({
      preheader: 'Vous pouvez vous connecter et commencer vos premières livraisons.',
      eyebrow: 'Inscription validée',
      title: 'Bienvenue dans la flotte',
      paragraphs: [
        `Bonjour ${firstName},`,
        `Votre dossier est complet et votre compte est désormais actif à ${cityName}.`,
        'Ouvrez l’application livreur, passez « En ligne » et les courses proches de vous vous seront proposées.',
      ],
      footerReason: footer,
    }),
  };
}

export function driverDocumentsMissingEmail(firstName: string, missing: PartnerDocumentType[], reason: string): EmailMessage {
  return {
    subject: 'Il manque des pièces à votre dossier',
    ...renderEmail({
      preheader: 'Déposez les documents demandés pour finaliser votre inscription.',
      eyebrow: 'Inscription',
      title: 'Votre dossier est presque complet',
      paragraphs: [`Bonjour ${firstName},`, reason, 'Déposez les pièces ci-dessous depuis l’application livreur : nous les vérifions dès réception.'],
      details: missing.map((type) => ({ label: PARTNER_DOCUMENT_LABELS[type], value: 'À déposer' })),
      footerReason: footer,
    }),
  };
}

export function driverRejectedEmail(firstName: string, reason: string): EmailMessage {
  return {
    subject: 'Votre inscription n’a pas été retenue',
    ...renderEmail({
      preheader: 'Décision concernant votre inscription de livreur.',
      eyebrow: 'Inscription',
      title: 'Nous ne pouvons pas valider votre inscription',
      paragraphs: [`Bonjour ${firstName},`, `Motif : ${reason}`, 'Pour toute question, répondez depuis la rubrique Aide de l’application.'],
      footerReason: footer,
    }),
  };
}

export function driverSanctionEmail(firstName: string, type: SanctionType, reason: string, endsAt: Date | null): EmailMessage {
  const until = endsAt ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(endsAt) : null;
  return {
    subject: `${SANCTION_TYPE_LABELS[type]} sur votre compte livreur`,
    ...renderEmail({
      preheader: 'Une décision a été prise sur votre compte. Vous pouvez la contester.',
      eyebrow: 'Compte livreur',
      title: SANCTION_TYPE_LABELS[type],
      paragraphs: [
        `Bonjour ${firstName},`,
        `Motif : ${reason}`,
        type === 'warning'
          ? 'Il s’agit d’un avertissement : votre compte reste actif.'
          : type === 'temporary_suspension'
            ? `Votre compte est suspendu${until ? ` jusqu’au ${until}` : ''}.`
            : 'Votre compte est désactivé.',
        'Vous pouvez contester cette décision depuis l’application livreur, rubrique Compte.',
      ],
      footerReason: footer,
    }),
  };
}

export function driverDocumentExpiredEmail(firstName: string, types: PartnerDocumentType[]): EmailMessage {
  return {
    subject: 'Document expiré : votre compte est en pause',
    ...renderEmail({
      preheader: 'Déposez un document à jour pour reprendre vos livraisons.',
      eyebrow: 'Documents',
      title: 'Un document a expiré',
      paragraphs: [
        `Bonjour ${firstName},`,
        'Par sécurité, les courses ne peuvent plus vous être proposées tant qu’un document à jour n’a pas été validé.',
      ],
      details: types.map((type) => ({ label: PARTNER_DOCUMENT_LABELS[type], value: 'Expiré' })),
      footerReason: footer,
    }),
  };
}
