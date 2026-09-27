// Contrôle du numéro d'immatriculation d'un commerce selon le pays (validation
// automatique des dossiers). Contrôle de format et, quand elle existe, de clé.
// Aucun appel à un registre officiel : un numéro cohérent n'est pas un numéro prouvé,
// d'où la vérification des pièces déposées en plus.

export interface RegistrationCheck {
  ok: boolean;
  normalized: string;
  /** Nature du numéro attendu, pour les messages (« SIRET », « RCS »…). */
  label: string;
  detail: string;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** SIRET : 14 chiffres, clé de Luhn (exception historique de La Poste, SIREN 356000000). */
function siretValid(value: string): boolean {
  if (!/^\d{14}$/.test(value)) return false;
  if (value.startsWith('356000000')) return value.split('').reduce((s, d) => s + Number(d), 0) % 5 === 0;
  return luhnValid(value);
}

/** Numéro d'entreprise belge (BCE) : 10 chiffres commençant par 0 ou 1, clé modulo 97. */
function bceValid(value: string): boolean {
  if (!/^[01]\d{9}$/.test(value)) return false;
  const base = Number(value.slice(0, 8));
  const key = Number(value.slice(8));
  return 97 - (base % 97) === key;
}

/**
 * Formats par pays :
 * - FR : SIRET (14 chiffres, clé de Luhn) ou SIREN (9 chiffres, Luhn)
 * - BE : numéro BCE (10 chiffres, clé modulo 97)
 * - LU : numéro RCS (lettre puis 1 à 7 chiffres) ou matricule national (11 à 13 chiffres)
 * - DZ : NIF (15 ou 20 chiffres) ou registre de commerce (7 à 14 caractères)
 * - MA : ICE (15 chiffres) ou registre de commerce (3 à 10 chiffres)
 * - TN : matricule fiscal (7 chiffres et une lettre, suffixes facultatifs) ou registre national des entreprises
 */
export function checkRegistrationNumber(countryId: string, raw: string): RegistrationCheck {
  const compact = raw.replace(/[\s.\-/]/g, '').toUpperCase();
  const fail = (label: string, detail: string): RegistrationCheck => ({ ok: false, normalized: compact, label, detail });
  const ok = (label: string): RegistrationCheck => ({ ok: true, normalized: compact, label, detail: `${label} conforme.` });
  switch (countryId) {
    case 'FR':
      if (/^\d{14}$/.test(compact)) return siretValid(compact) ? ok('SIRET') : fail('SIRET', 'La clé de contrôle du SIRET est incorrecte.');
      if (/^\d{9}$/.test(compact)) return luhnValid(compact) ? ok('SIREN') : fail('SIREN', 'La clé de contrôle du SIREN est incorrecte.');
      return fail('SIRET', 'Un SIRET compte 14 chiffres (ou un SIREN 9).');
    case 'BE':
      return bceValid(compact.replace(/^BE/, '')) ? ok('Numéro BCE') : fail('Numéro BCE', 'Numéro BCE invalide : 10 chiffres et clé de contrôle.');
    case 'LU':
      if (/^[A-Z]\d{1,7}$/.test(compact)) return ok('Numéro RCS');
      if (/^\d{11,13}$/.test(compact)) return ok('Matricule national');
      return fail('Numéro RCS', 'Un numéro RCS luxembourgeois est une lettre suivie de 1 à 7 chiffres (B123456).');
    case 'DZ':
      if (/^(\d{15}|\d{20})$/.test(compact)) return ok('NIF');
      if (/^[0-9A-Z]{7,14}$/.test(compact)) return ok('Registre de commerce');
      return fail('NIF', 'Un NIF algérien compte 15 ou 20 chiffres.');
    case 'MA':
      if (/^\d{15}$/.test(compact)) return ok('ICE');
      if (/^\d{3,10}$/.test(compact)) return ok('Registre de commerce');
      return fail('ICE', 'Un ICE marocain compte 15 chiffres.');
    case 'TN':
      if (/^\d{7}[A-Z]([A-Z]{0,1}[A-Z]?\d{3})?$/.test(compact) || /^\d{7}[A-Z]$/.test(compact)) return ok('Matricule fiscal');
      if (/^[A-Z]\d{6,10}$/.test(compact)) return ok('Registre national des entreprises');
      return fail('Matricule fiscal', 'Un matricule fiscal tunisien compte 7 chiffres suivis d’une lettre.');
    default:
      return fail('Immatriculation', 'Pays non pris en charge pour le contrôle automatique.');
  }
}
