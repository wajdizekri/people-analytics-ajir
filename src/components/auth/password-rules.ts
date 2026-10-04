// Règles du nouveau mot de passe, vérifiées dans le navigateur avant l'envoi (mêmes règles que passwordPolicyError
// côté serveur) : l'erreur s'affiche sous le champ concerné au lieu d'un refus du serveur qui vide le formulaire.

export const PASSWORD_MIN = 10;
export const hasLength = (p: string) => p.length >= PASSWORD_MIN;
export const hasMix = (p: string) => /[A-Za-z]/.test(p) && /[0-9]/.test(p);

export type NewPasswordErrors = { password?: string; confirm?: string };

export function newPasswordErrors(password: string, confirm: string): NewPasswordErrors {
  const e: NewPasswordErrors = {};
  if (!password) e.password = "Saisissez un nouveau mot de passe.";
  else if (!hasLength(password)) e.password = `Mot de passe trop court : ${PASSWORD_MIN} caractères au moins (${password.length} saisis).`;
  else if (!hasMix(password)) e.password = "Ajoutez au moins une lettre et un chiffre : le mot de passe doit contenir les deux.";
  if (!confirm) e.confirm = "Saisissez de nouveau le mot de passe pour le confirmer.";
  else if (confirm !== password) e.confirm = "Les deux saisies sont différentes : saisissez le même mot de passe dans les deux champs.";
  return e;
}
