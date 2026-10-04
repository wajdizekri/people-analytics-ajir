import type Database from "better-sqlite3";
import { Cron } from "croner";
import type { Logger } from "pino";
import { enqueueJob, heartbeat, HEARTBEAT_MS, recoverStale } from "../lib/jobs";
import { processNextJob, scheduledBatchMonth } from "../lib/jobs/handlers";

const POLL_MS = 5_000;
const RECOVER_EVERY_MS = 60_000;
// le 10 de chaque mois à 02:00 (heure de Tunis), après la paie : batch du dernier mois complet importé, s'il n'est pas déjà publié
export const MONTHLY_CRON = "0 2 10 * *";
// Ctrl+C, arrêt de service, Ctrl+Pause (Windows)
export const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK"] as const;

export type WorkerHandle = { stop: (reason: string) => void; done: Promise<void> };

// stop() laisse finir le job en cours, puis arrête minuteries et cron et ferme la base ; done est résolu une fois la base fermée.
export function startWorker(sqlite: Database.Database, log: Logger, opts: { pollMs?: number; cron?: boolean } = {}): WorkerHandle {
  const pollMs = opts.pollMs ?? POLL_MS;
  let current: number | null = null;
  let stopping = false;
  let wake: (() => void) | null = null;
  let lastBeat = 0;
  const beat = (force = false) => {
    const now = Date.now();
    if (!force && now - lastBeat < HEARTBEAT_MS) return;
    lastBeat = now;
    try {
      heartbeat(sqlite, current);
    } catch (e) {
      log.warn({ err: e }, "heartbeat impossible");
    }
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const stop = (reason: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal: reason, job: current }, "arrêt demandé : fin du job en cours puis sortie");
    wake?.();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let cron: Cron | null = null;
  const done = (async () => {
    try {
      const recovered = recoverStale(sqlite);
      if (recovered.requeued || recovered.failed || recovered.failedRuns) log.warn(recovered, "reprise après arrêt");
      beat(true);
      timer = setInterval(() => beat(), HEARTBEAT_MS);
      if (opts.cron !== false)
        cron = new Cron(MONTHLY_CRON, { timezone: "Africa/Tunis", name: "batch-mensuel" }, () => {
          const month = scheduledBatchMonth(sqlite);
          if (!month) {
            log.warn("batch mensuel non planifié : aucun nouveau mois complet importé depuis le dernier calcul publié");
            return;
          }
          const id = enqueueJob(sqlite, "BATCH_MENSUEL", month);
          log.info({ job: id, month }, "batch mensuel planifié");
          wake?.();
        });

      let lastRecover = Date.now();
      while (!stopping) {
        if (Date.now() - lastRecover > RECOVER_EVERY_MS) {
          const r = recoverStale(sqlite);
          if (r.requeued || r.failed || r.failedRuns) log.warn(r, "jobs ou runs orphelins traités");
          lastRecover = Date.now();
        }
        const processed = await processNextJob(sqlite, (jobId) => {
          current = jobId;
          beat(true);
          return () => beat();
        });
        current = null;
        if (!processed) {
          if (!stopping) await sleep(pollMs);
          continue;
        }
        beat(true);
        if (processed.ok) log.info({ job: processed.job.id, type: processed.job.type, ms: processed.ms }, processed.summary);
        else log.error({ job: processed.job.id, type: processed.job.type, ms: processed.ms }, `échec : ${processed.summary}`);
      }
    } finally {
      clearInterval(timer);
      cron?.stop();
      sqlite.close();
      log.info("worker arrêté, base fermée");
    }
  })();

  return { stop, done };
}

// Premier signal : arrêt propre. Second signal : sortie immédiate (le job interrompu est repris au redémarrage par recoverStale).
export function onStopSignals(
  worker: WorkerHandle,
  log: Logger,
  target: NodeJS.EventEmitter = process,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  let received = 0;
  const handlers = STOP_SIGNALS.map((sig) => {
    const h = () => {
      if (++received === 1) return worker.stop(sig);
      log.warn({ signal: sig }, "second signal : arrêt immédiat");
      exit(130);
    };
    target.on(sig, h);
    return [sig, h] as const;
  });
  return () => handlers.forEach(([sig, h]) => target.off(sig, h));
}
