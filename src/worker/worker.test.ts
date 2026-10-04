import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/fixtures/engine/db";
import { openSqlite } from "../db/client";
import { enqueueJob, getJob } from "../lib/jobs";
import { getSetting } from "../lib/settings";
import { onStopSignals, startWorker, STOP_SIGNALS } from "./run";

const silent = pino({ level: "silent" });

describe("worker : arrêt propre", () => {
  it.each(STOP_SIGNALS)("%s : fin de la boucle, base fermée", async (signal) => {
    const db = createTestDb();
    const target = new EventEmitter();
    const exits: number[] = [];
    const worker = startWorker(db.sqlite, silent, { pollMs: 20, cron: false });
    const off = onStopSignals(worker, silent, target, (code) => exits.push(code));
    expect(getSetting(db.sqlite, "worker_heartbeat")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await new Promise((r) => setTimeout(r, 50));
    target.emit(signal);
    await worker.done;
    expect(db.sqlite.open).toBe(false);
    expect(exits).toEqual([]);
    off();
    expect(STOP_SIGNALS.every((s) => target.listenerCount(s) === 0)).toBe(true);
    db.close();
  });

  it("le job en cours est terminé avant la fermeture ; un second signal force la sortie", async () => {
    const db = createTestDb();
    const id = enqueueJob(db.sqlite, "AGGREGATE");
    const target = new EventEmitter();
    const exits: number[] = [];
    const worker = startWorker(db.sqlite, silent, { pollMs: 20, cron: false });
    onStopSignals(worker, silent, target, (code) => exits.push(code));
    target.emit("SIGINT");
    target.emit("SIGBREAK");
    expect(exits).toEqual([130]);
    await worker.done;
    expect(db.sqlite.open).toBe(false);
    const reopened = openSqlite(db.file, { readonly: true });
    expect(getJob(reopened, id)?.status).toBe("TERMINE");
    reopened.close();
    db.close();
  });
});
