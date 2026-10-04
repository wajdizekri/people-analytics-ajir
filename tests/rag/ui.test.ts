import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Role } from "@/db/schema";
import type { AssistantAnswer } from "@/lib/rag/types";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

const { HelpAssistant, AssistantPanel, assistantReducer, assistantErrorMessage, parseAssistantAnswer, questionError } = await import("@/components/help/help-assistant");
const help = await import("@/components/help");
const { ASSISTANT_EXAMPLES, FAQ, forRole } = await import("@/lib/help/content");

const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

const extrait: AssistantAnswer = {
  mode: "EXTRAIT",
  answer: "Le niveau de risque classe les collaborateurs selon la capacité d'entretiens RH.",
  sources: [
    { title: "Niveau de risque", href: "/aide#risque" },
    { title: "Questions fréquentes", href: "/aide#faq" },
  ],
  notice: "Extrait de l'aide, sans reformulation.",
};

describe("HelpAssistant replié (rendu statique)", () => {
  const m = html(createElement(HelpAssistant, { examples: ASSISTANT_EXAMPLES.RH }));

  it("une seule ligne : formulaire de recherche, un champ, un bouton, aucun paragraphe ni panneau", () => {
    expect(help.HelpAssistant).toBe(HelpAssistant);
    expect(m).toContain('role="search"');
    expect(m.match(/<input/g)).toHaveLength(1);
    expect(m.match(/<button/g)).toHaveLength(1);
    expect(m).not.toMatch(/<p[\s>]/);
    expect(m).not.toMatch(/<(ul|ol|h\d)[\s>]/);
    expect(text(m)).not.toContain("Sources");
    expect(text(m)).not.toContain("Fermer");
  });

  it("libellé accessible relié au formulaire et au champ ; texte indicatif court ; longueur bornée", () => {
    const labelId = /<label id="([^"]+)" for="([^"]+)"/.exec(m);
    expect(labelId).toBeTruthy();
    expect(m).toContain(`aria-labelledby="${labelId![1]}"`);
    expect(m).toContain(`id="${labelId![2]}"`);
    expect(text(m)).toContain("Poser une question à l'assistant d'aide");
    expect(m).toContain('placeholder="Poser une question…"');
    expect(m).toContain('maxLength="300"');
  });

  it("bouton « Demander » (icône + texte, ≥ 40 px), zone de réponse annoncée, questions d'exemple masquées hors focus", () => {
    expect(m).toMatch(/<button type="submit"[^>]*min-h-10[^>]*>.*<svg[^>]*aria-hidden="true".*Demander<\/button>/);
    expect(m).toContain('aria-live="polite"');
    for (const ex of ASSISTANT_EXAMPLES.RH) expect(m).not.toContain(ex.replace(/'/g, "&#x27;"));
  });

  it("jetons sémantiques seulement (clair et sombre), rien de figé en couleur Tailwind", () => {
    const all = m + html(createElement(AssistantPanel, { state: { status: "done", question: "risque", answer: extrait }, onClose: noop }));
    expect(all).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|white|black|sky|blue|red|amber|emerald)\b/);
    expect(all).toContain("bg-surface");
    expect(all).toContain("border-line");
    expect(all).toContain("text-link");
  });
});

describe("panneau de réponse", () => {
  it("réponse extraite : texte, sources en liens internes, mention discrète, bouton Fermer accessible", () => {
    const m = html(createElement(AssistantPanel, { state: { status: "done", question: "risque", answer: extrait }, onClose: noop }));
    const t = text(m);
    expect(t).toContain(extrait.answer);
    expect(t).toContain("Sources");
    expect(m).toContain('href="/aide#risque"');
    expect(m).toContain('href="/aide#faq"');
    expect(m).toMatch(/<p class="[^"]*text-fg-subtle[^"]*">Extrait de l(&#x27;|')aide, sans reformulation\.<\/p>/);
    expect(m).toMatch(/<button type="button"[^>]*h-10 w-10[^>]*>.*<span class="sr-only">Fermer la réponse<\/span><\/button>/);
    expect(t).not.toContain("Ouvrir l'aide");
    expect(t).not.toContain("[1]");
  });

  it("réponse reformulée par IA : sources numérotées comme les citations du texte", () => {
    const ia: AssistantAnswer = { ...extrait, mode: "IA", answer: "Le niveau dépend de la capacité d'entretiens [1]. Voir aussi la FAQ [2].", notice: "Réponse rédigée par IA générative." };
    const t = text(html(createElement(AssistantPanel, { state: { status: "done", question: "risque", answer: ia }, onClose: noop })));
    expect(t).toContain("[1] Niveau de risque");
    expect(t).toContain("[2] Questions fréquentes");
  });

  it("aucune réponse : message, lien « Ouvrir l'aide » vers /aide ; message par défaut si le texte est vide", () => {
    const m = html(createElement(AssistantPanel, { state: { status: "done", question: "météo", answer: { mode: "AUCUN", answer: "", sources: [] } }, onClose: noop }));
    expect(text(m)).toContain("L'aide ne couvre pas cette question.");
    expect(m).toMatch(/<a href="\/aide"[^>]*>.*Ouvrir l(&#x27;|')aide<\/a>/);
    expect(text(m)).not.toContain("Sources");
  });

  it("erreur : message affiché en couleur de danger ; rien en attente ou au repos", () => {
    const m = html(createElement(AssistantPanel, { state: { status: "error", question: "x", message: assistantErrorMessage(null) }, onClose: noop }));
    expect(m).toContain("text-danger");
    expect(text(m)).toContain("Vérifiez votre connexion");
    expect(html(createElement(AssistantPanel, { state: { status: "loading", question: "x" }, onClose: noop }))).toBe("");
    expect(html(createElement(AssistantPanel, { state: { status: "idle" }, onClose: noop }))).toBe("");
  });
});

describe("logique d'état", () => {
  it("envoi : question nettoyée → en cours ; trop courte → erreur sans appel", () => {
    expect(assistantReducer({ status: "idle" }, { type: "submit", question: "  Comment importer ?  " })).toEqual({ status: "loading", question: "Comment importer ?" });
    const short = assistantReducer({ status: "idle" }, { type: "submit", question: " a " });
    expect(short.status).toBe("error");
    expect(short.status === "error" && short.message).toContain("au moins 3 caractères");
    expect(questionError("x".repeat(301))).toContain("300 caractères");
    expect(questionError("abc")).toBeNull();
  });

  it("réponse et erreur appliquées seulement pendant l'attente ; fermeture → repli", () => {
    const loading = { status: "loading", question: "risque" } as const;
    expect(assistantReducer(loading, { type: "success", answer: extrait })).toEqual({ status: "done", question: "risque", answer: extrait });
    expect(assistantReducer(loading, { type: "failure", message: "Oups" })).toEqual({ status: "error", question: "risque", message: "Oups" });
    // Réponse tardive après fermeture : ignorée
    expect(assistantReducer({ status: "idle" }, { type: "success", answer: extrait })).toEqual({ status: "idle" });
    expect(assistantReducer({ status: "done", question: "risque", answer: extrait }, { type: "close" })).toEqual({ status: "idle" });
  });

  it("messages d'erreur clairs : ce qui s'est passé + quoi faire ; message du serveur repris pour 400, 403 et 429", () => {
    expect(assistantErrorMessage(null)).toMatch(/n'a pas pu être joint.*réessayez/);
    expect(assistantErrorMessage(429)).toMatch(/beaucoup de questions.*Patientez/);
    expect(assistantErrorMessage(429, "Trop de questions. Réessayez dans 2 minutes.")).toBe("Trop de questions. Réessayez dans 2 minutes.");
    expect(assistantErrorMessage(400)).toMatch(/Reformulez-la en 3 à 300 caractères/);
    expect(assistantErrorMessage(400, "  ")).toMatch(/Reformulez-la/);
    expect(assistantErrorMessage(413)).toMatch(/Reformulez-la/);
    expect(assistantErrorMessage(413, "Question trop longue : raccourcissez-la puis réessayez.")).toBe("Question trop longue : raccourcissez-la puis réessayez.");
    expect(assistantErrorMessage(401, "Non authentifié")).toMatch(/Reconnectez-vous/);
    expect(assistantErrorMessage(500, "Erreur inattendue du serveur.")).toMatch(/indisponible/);
    expect(assistantErrorMessage(401)).toMatch(/session a expiré.*Reconnectez-vous/);
    expect(assistantErrorMessage(500)).toMatch(/indisponible.*Réessayez/);
    for (const s of [null, 400, 401, 403, 429, 500, 503]) expect(assistantErrorMessage(s).split(/[.!?]\s/).every((p) => p.split(/\s+/).length <= 20)).toBe(true);
  });

  it("réponse du serveur validée : liens internes seuls, forme inattendue refusée", () => {
    const parsed = parseAssistantAnswer({
      mode: "IA",
      answer: "Texte",
      notice: "Reformulé par IA générative.",
      sources: [{ title: "Aide", href: "/aide#faq" }, { title: "Externe", href: "https://exemple.org" }, { title: "Relatif", href: "//exemple.org" }, { title: "Antislash", href: "/\\exemple.org" }, { href: "/x" }],
    });
    expect(parsed).toEqual({ mode: "IA", answer: "Texte", notice: "Reformulé par IA générative.", sources: [{ title: "Aide", href: "/aide#faq" }] });
    expect(parseAssistantAnswer({ mode: "AUCUN", answer: "Rien", sources: null })).toEqual({ mode: "AUCUN", answer: "Rien", sources: [] });
    expect(parseAssistantAnswer({ mode: "AUTRE", answer: "x", sources: [] })).toBeNull();
    expect(parseAssistantAnswer({ error: { message: "x" } })).toBeNull();
    expect(parseAssistantAnswer(null)).toBeNull();
  });
});

describe("contenus de l'assistant", () => {
  it("trois questions d'exemple par rôle, courtes, sur les sujets du rôle", () => {
    for (const role of ["ADMIN", "RH", "MANAGER"] as Role[]) {
      expect(ASSISTANT_EXAMPLES[role], role).toHaveLength(3);
      for (const q of ASSISTANT_EXAMPLES[role]) {
        expect(q.length, q).toBeLessThanOrEqual(300);
        expect(q.endsWith("?"), q).toBe(true);
      }
    }
    expect(ASSISTANT_EXAMPLES.ADMIN.join(" ")).toMatch(/import.*capacité.*compte/i);
    expect(ASSISTANT_EXAMPLES.RH.join(" ")).toMatch(/niveau de risque.*alerte.*fourchette/i);
    expect(ASSISTANT_EXAMPLES.MANAGER.join(" ")).toMatch(/niveau de risque de mon équipe.*absentéisme.*recommandation/i);
  });

  it("question fréquente « Comment fonctionne l'assistant d'aide ? » visible par tous les rôles, en dernier", () => {
    const faq = FAQ.at(-1)!;
    expect(faq.q).toBe("Comment fonctionne l'assistant d'aide ?");
    for (const role of ["ADMIN", "RH", "MANAGER"] as Role[]) expect(forRole(FAQ, role)).toContain(faq);
    expect(faq.a).toContain("documentation et l'aide de votre rôle");
    expect(faq.a).toContain("jamais les données des collaborateurs");
    expect(faq.a).toContain("ne sont pas conservées");
  });
});
