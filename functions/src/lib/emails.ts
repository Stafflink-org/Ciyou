// Gabarits des e-mails transactionnels du socle (invitations, inscription).
import { ADMIN_ROLE_LABELS, STAFF_ROLE_LABELS, type AdminRole, type StaffRole } from '@golink/shared';
import { PLATFORM_NAME } from './config';
import { renderEmail, type RenderedEmail } from './email-layout';

export interface EmailMessage extends RenderedEmail {
  subject: string;
}

export function memberInvitationEmail(input: {
  firstName: string;
  restaurantName: string;
  inviterName: string;
  role: StaffRole;
  link: string;
  newAccount: boolean;
}): EmailMessage {
  const role = STAFF_ROLE_LABELS[input.role];
  return {
    subject: `${input.restaurantName} vous invite sur ${PLATFORM_NAME}`,
    ...renderEmail({
      preheader: `Rejoignez l'équipe de ${input.restaurantName} sur le back-office ${PLATFORM_NAME}.`,
      eyebrow: 'Invitation',
      title: `Rejoignez l'équipe de ${input.restaurantName}`,
      paragraphs: [
        `Bonjour ${input.firstName},`,
        `${input.inviterName} vous donne accès au back-office ${PLATFORM_NAME} de ${input.restaurantName}.`,
        input.newAccount
          ? 'Choisissez votre mot de passe pour activer votre compte, puis connectez-vous.'
          : 'Connectez-vous avec votre compte habituel pour accepter l’invitation.',
      ],
      details: [
        { label: 'Établissement', value: input.restaurantName },
        { label: 'Rôle', value: role },
      ],
      cta: { label: input.newAccount ? 'Activer mon compte' : 'Accepter l’invitation', url: input.link },
      note: input.newAccount
        ? 'Ce lien est personnel et expire dans une heure. Passé ce délai, utilisez « Mot de passe oublié » sur la page de connexion.'
        : 'Si vous ne connaissez pas cet établissement, ignorez simplement cet e-mail.',
      footerReason: `Vous recevez cet e-mail car ${input.inviterName} a saisi votre adresse dans le back-office de ${input.restaurantName}.`,
    }),
  };
}

export function adminInvitationEmail(input: {
  firstName: string;
  inviterName: string;
  role: AdminRole;
  link: string;
  newAccount: boolean;
}): EmailMessage {
  return {
    subject: `Votre accès à l'administration ${PLATFORM_NAME}`,
    ...renderEmail({
      preheader: `${input.inviterName} vous a ouvert un accès à l'administration ${PLATFORM_NAME}.`,
      eyebrow: 'Équipe interne',
      title: `Bienvenue dans l'équipe ${PLATFORM_NAME}`,
      paragraphs: [
        `Bonjour ${input.firstName},`,
        `${input.inviterName} vous a ouvert un accès à l'administration de la plateforme.`,
        input.newAccount
          ? 'Définissez votre mot de passe pour activer votre accès. Choisissez-le long et unique : il protège des données sensibles.'
          : 'Votre compte existant a reçu ce nouvel accès. Connectez-vous pour le découvrir.',
      ],
      details: [{ label: 'Rôle', value: ADMIN_ROLE_LABELS[input.role] }],
      cta: { label: input.newAccount ? 'Définir mon mot de passe' : 'Me connecter', url: input.link },
      note: 'Toutes les actions réalisées dans l’administration sont enregistrées dans le journal d’audit.',
      footerReason: `Vous recevez cet e-mail car un administrateur ${PLATFORM_NAME} vous a invité.`,
    }),
  };
}

export function restaurantSignupReceivedEmail(input: {
  firstName: string;
  restaurantName: string;
  city: string;
  link: string;
}): EmailMessage {
  return {
    subject: `Nous avons bien reçu l'inscription de ${input.restaurantName}`,
    ...renderEmail({
      preheader: 'Votre demande est en cours de vérification par notre équipe.',
      eyebrow: 'Inscription',
      title: 'Votre demande est entre de bonnes mains',
      paragraphs: [
        `Bonjour ${input.firstName},`,
        `Merci d'avoir choisi ${PLATFORM_NAME} pour ${input.restaurantName}. Notre équipe vérifie votre dossier, en général sous 48 heures ouvrées.`,
        'En attendant, vous pouvez déjà vous connecter au back-office pour déposer vos justificatifs, composer votre carte et régler vos horaires.',
      ],
      details: [
        { label: 'Établissement', value: input.restaurantName },
        { label: 'Ville', value: input.city },
        { label: 'Statut', value: 'En cours de vérification' },
      ],
      cta: { label: 'Accéder à mon back-office', url: input.link },
      note: 'Documents demandés : extrait Kbis de moins de 3 mois, pièce d’identité du gérant, RIB professionnel et, le cas échéant, licence de débit de boissons.',
      footerReason: `Vous recevez cet e-mail suite à l'inscription de ${input.restaurantName} sur ${PLATFORM_NAME}.`,
    }),
  };
}
