// Masquage des données personnelles pour les rôles qui ne doivent pas voir les
// coordonnées complètes (support, restaurants, commerciaux).

/** « camille.dubois@exemple.fr » → « c••••••@exemple.fr ». */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '••••';
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

/** « +33 6 12 34 56 78 » → « +33 6 •• •• •• 78 ». */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  const last = digits.slice(-2);
  const prefix = phone.trim().startsWith('+') ? `+${digits.slice(0, 2)} ${digits.slice(2, 3)}` : digits.slice(0, 2);
  return `${prefix} •• •• •• ${last}`;
}

/** « FR7630006000011234567890189 » → « FR76 •••• •••• 0189 ». */
export function maskIban(iban: string): string {
  const compact = iban.replace(/\s/g, '').toUpperCase();
  if (compact.length < 8) return '••••';
  return `${compact.slice(0, 4)} •••• •••• ${compact.slice(-4)}`;
}

/** Libellé de carte : (« visa », « 4242 ») → « Visa ···· 4242 ». */
export function formatCardLabel(brand: string, last4: string): string {
  const name = brand.length > 0 ? brand[0].toUpperCase() + brand.slice(1) : 'Carte';
  return `${name} ···· ${last4}`;
}

/** Nom public d'un client : « Camille D. ». */
export function publicDisplayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0);
  return initial ? `${firstName.trim()} ${initial.toUpperCase()}.` : firstName.trim();
}
