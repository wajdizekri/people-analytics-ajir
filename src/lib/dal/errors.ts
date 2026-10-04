import { z } from "zod";

// Filet de sécurité : messages zod par défaut en français (module importé par toute la DAL, les actions et les routes).
// Les champs affichés gardent leurs messages explicites, définis dans chaque schéma.
z.config(z.locales.fr());

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Ressource") => new HttpError(404, "INTROUVABLE", `${what} introuvable. Rechargez la page ou revenez à la liste.`);
export const forbidden = () => new HttpError(403, "INTERDIT", "Accès refusé : cette donnée ou cette action ne fait pas partie de votre périmètre.");
