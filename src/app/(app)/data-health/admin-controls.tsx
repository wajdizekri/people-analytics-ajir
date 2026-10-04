"use client";

import { useActionState, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmButton, Icon, Notice, Steps, buttonClass, type StepStatus } from "@/components/ui";
import { toast, useActionToast } from "@/components/ui/toast";
import { recomputeAction, type RecomputeState } from "./actions";

// Sans ces deux fichiers, l'import échoue côté worker (MANDATORY dans src/lib/import/index.ts) : on prévient avant l'envoi
const MANDATORY = ["departments.csv", "employees.csv"];
const mo = (bytes: number) =>
  bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("fr-FR")} Ko` : `${(bytes / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
const files = (n: number, adj = "") => `${n} fichier${n > 1 ? "s" : ""}${adj ? ` ${adj}${n > 1 ? "s" : ""}` : ""}`;

type Picked = { name: string; size: number };

function Block({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`etape-${n}`} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 id={`etape-${n}`} className="flex items-center gap-2 text-sm font-semibold text-heading">
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors duration-200 ${done ? "bg-success-soft text-success" : "bg-surface-3 text-fg-muted"}`}
        >
          {done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}
        </span>
        <span>
          <span className="sr-only">{n}. </span>
          {title}
        </span>
      </h3>
      <div className="mt-2 space-y-2 text-sm text-fg-muted">{children}</div>
    </section>
  );
}

const FILE_TONE = {
  ok: "border-success/40 bg-success-soft text-success",
  missing: "border-danger/40 bg-danger-soft text-danger",
  optional: "border-line bg-surface text-fg-muted",
} as const;

export function UploadForm({ accepted, maxBytes, workerUp }: { accepted: readonly string[]; maxBytes: number; workerUp: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ ok?: string; error?: string }>({});
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);

  const unknown = selected.filter((f) => !accepted.includes(f.name));
  const missing = MANDATORY.filter((m) => !selected.some((f) => f.name === m));
  const total = selected.reduce((s, f) => s + f.size, 0);
  const problem = !selected.length
    ? "Choisissez d'abord les fichiers (étape 1)."
    : unknown.length
      ? `Retirez ou renommez ${unknown.length > 1 ? "les fichiers non prévus" : "le fichier non prévu"} : ${unknown.map((f) => f.name).join(", ")}.`
      : missing.length
        ? `Ajoutez ${missing.length > 1 ? "les fichiers obligatoires" : "le fichier obligatoire"} : ${missing.join(", ")}.`
        : total > maxBytes
          ? `L'export pèse ${mo(total)} pour ${mo(maxBytes)} au maximum : importez-le en deux fois.`
          : null;

  function pick(list: FileList | null) {
    setSelected(Array.from(list ?? []).map((f) => ({ name: f.name, size: f.size })));
    setState({});
  }

  // Glisser-déposer : les fichiers déposés remplacent la sélection du champ (envoyé tel quel)
  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped.length || !input.current) return;
    input.current.files = dropped;
    pick(dropped);
  }

  function remove(name: string) {
    const el = input.current;
    if (!el?.files) return;
    const keep = new DataTransfer();
    Array.from(el.files)
      .filter((f) => f.name !== name)
      .forEach((f) => keep.items.add(f));
    el.files = keep.files;
    pick(keep.files);
  }

  function clear() {
    if (input.current) input.current.value = "";
    pick(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const chosen = Array.from(input.current?.files ?? []);
    if (problem || !chosen.length) {
      const error = problem ?? "Choisissez d'abord les fichiers (étape 1).";
      toast.error("Import non lancé", { description: error });
      return setState({ error });
    }

    const body = new FormData();
    chosen.forEach((f) => body.append("files", f, f.name));
    setPending(true);
    setState({});
    // Même id : la notification « Envoi… » est remplacée par le résultat
    const id = toast.info("Envoi de l'export en cours…", { description: `${files(chosen.length)} · ${mo(total)}`, duration: 0 });
    try {
      const res = await fetch("/api/imports", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const reason = json?.error?.issues?.[0]?.message ?? json?.error?.message ?? "réponse inattendue du serveur.";
        toast.error("Import refusé", { id, description: `${reason} Corrigez puis relancez.` });
        setState({ error: `L'import n'a pas été lancé : ${reason} Corrigez puis relancez.` });
        return;
      }
      toast.success("Import lancé", { id, description: `${files(chosen.length, "reçu")}, traitement n° ${json.jobId} en file d'attente.` });
      setState({ ok: `Import lancé : ${files(chosen.length, "reçu")}, traitement n° ${json.jobId} en file d'attente` });
      form.reset();
      setSelected([]);
      router.refresh();
    } catch {
      toast.error("Le serveur ne répond pas", { id, description: "Vérifiez votre connexion puis relancez l'import." });
      setState({ error: "Le serveur ne répond pas. Vérifiez votre connexion puis relancez l'import." });
    } finally {
      setPending(false);
    }
  }

  const picked = new Map(selected.map((f) => [f.name, f]));
  const s1: StepStatus = selected.length ? "done" : "current";
  const s2: StepStatus = !selected.length ? "todo" : problem ? "error" : "done";
  const s3: StepStatus = !selected.length || problem ? "todo" : "current";
  return (
    <form onSubmit={onSubmit} aria-describedby="import-aide">
      <p id="import-aide" className="mb-4 text-sm text-fg-muted">
        Format : CSV · séparateur « ; » · UTF-8 · {Math.round(maxBytes / 1048576)} Mo max
      </p>
      <Steps
        label="Étapes de l'import"
        className="mb-5"
        steps={[
          { title: "Choisir les fichiers", status: s1, description: selected.length ? files(selected.length, "choisi") : undefined },
          { title: "Vérifier la sélection", status: s2, description: s2 === "error" ? "À corriger avant l'import" : undefined },
          { title: "Lancer l'import", status: s3 },
        ]}
      />
      <div className="space-y-5">
        <Block n={1} title="Choisir les fichiers" done={s1 === "done"}>
          <input
            ref={input}
            id="export-files"
            name="files"
            type="file"
            multiple
            accept=".csv,text/csv"
            className="peer sr-only"
            onChange={(e) => pick(e.currentTarget.files)}
          />
          <label
            htmlFor="export-files"
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={onDrop}
            className={`group flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--pa-focus)] ${
              dragging ? "border-primary bg-primary-soft" : "border-line-strong bg-surface-2 hover:border-primary hover:bg-primary-soft"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-surface text-link shadow-card transition-transform duration-200 ${dragging ? "-translate-y-1 scale-110" : "group-hover:-translate-y-0.5"}`}
            >
              <Icon name="upload" className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-fg">{dragging ? "Déposer les fichiers" : "Glisser-déposer les fichiers CSV"}</span>
            <span className={buttonClass("secondary", "md", "pointer-events-none mt-1")}>
              <Icon name="plus" />
              Choisir les fichiers CSV
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-fg-muted" aria-live="polite">
              {selected.length ? `${files(selected.length, "choisi")} · ${mo(total)}` : "Aucun fichier choisi"}
            </span>
            {selected.length > 0 && (
              <Button variant="tertiary" size="sm" icon="x" onClick={clear}>
                Vider la sélection
              </Button>
            )}
          </div>
        </Block>

        <Block n={2} title="Vérifier la sélection" done={s2 === "done"}>
          <ul aria-label="Fichiers attendus" className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
            {accepted.map((name) => {
              const f = picked.get(name);
              const required = MANDATORY.includes(name);
              const tone = f ? FILE_TONE.ok : required ? FILE_TONE.missing : FILE_TONE.optional;
              return (
                <li key={name} className={`flex min-h-9 items-center justify-between gap-2 rounded-control border px-2.5 py-1.5 transition-colors duration-200 ${tone}`}>
                  <span className="truncate font-mono">{name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-medium">
                    {(f || required) && <Icon name={f ? "check" : "x"} className="h-3.5 w-3.5" />}
                    {f ? `Reçu · ${mo(f.size)}` : required ? "Manquant · obligatoire" : "Non fourni"}
                  </span>
                </li>
              );
            })}
            {unknown.map((f) => (
              <li key={f.name} className={`flex min-h-9 items-center justify-between gap-2 rounded-control border px-2.5 py-1 ${FILE_TONE.missing}`}>
                <span className="truncate font-mono">{f.name}</span>
                <span className="inline-flex shrink-0 items-center gap-2 font-medium">
                  Non prévu
                  <button
                    type="button"
                    onClick={() => remove(f.name)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-control px-1.5 underline underline-offset-2 transition-colors duration-150 hover:bg-surface active:translate-y-px"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                    Retirer<span className="sr-only"> {f.name}</span>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Block>

        <Block n={3} title="Lancer l'import">
          {!workerUp && <Notice tone="warning">Service de calcul arrêté : import mis en attente</Notice>}
          <Button type="submit" variant="primary" icon="upload" pending={pending} pendingLabel="Envoi en cours…" disabled={!!problem} disabledReason={problem ?? undefined}>
            Lancer l&apos;import
          </Button>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          {state.ok && <Notice tone="success">{state.ok}</Notice>}
        </Block>
      </div>
    </form>
  );
}

export function RecomputeForm({ disabled, reason }: { disabled: boolean; reason?: string }) {
  const [state, action, pending] = useActionState<RecomputeState, FormData>(recomputeAction, {});
  useActionToast(state);
  return (
    <form action={action} className="space-y-2">
      <ConfirmButton
        variant="secondary"
        icon="refresh"
        title="Relancer le calcul mensuel ?"
        consequence="Recalcul des indicateurs, niveaux de risque, anomalies et alertes · quelques minutes"
        confirmLabel="Relancer le calcul"
        disabled={disabled}
        pending={pending}
        pendingLabel="Mise en file…"
      >
        Relancer le calcul mensuel
      </ConfirmButton>
      {disabled && reason && <p className="text-xs text-fg-muted">{reason}</p>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.ok && <Notice tone="success">{state.ok}</Notice>}
    </form>
  );
}
