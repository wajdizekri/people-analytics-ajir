import type Database from "better-sqlite3";
import { logger } from "../logger";
import * as absenteeism from "./absenteeism/step";
import * as training from "./training/step";
import * as workforce from "./workforce/step";
import * as workload from "./workload/step";

// Chaque sujet possède son module ; une erreur dans un sujet n'arrête pas le batch.
const AI_STEPS: { topic: string; run: (sqlite: Database.Database, asOf: string) => { summary: string } }[] = [
  { topic: "absentéisme", run: absenteeism.runStep },
  { topic: "effectifs et masse salariale", run: workforce.runStep },
  { topic: "formation", run: training.runStep },
  { topic: "charge de travail", run: workload.runStep },
];

export function runAiSteps(sqlite: Database.Database, asOf: string): string[] {
  return AI_STEPS.map(({ topic, run }) => {
    try {
      return `${topic} : ${run(sqlite, asOf).summary}`;
    } catch (err) {
      logger.error({ err, topic, asOf }, "Échec d'une étape IA");
      return `${topic} : ÉCHEC (${(err as Error).message})`;
    }
  });
}
