import { openSqlite } from "../src/db/client";
import { AI_TOPICS } from "../src/db/schema";
import { promoteTopicModel, registerTopicModel, type AiTopic } from "../src/lib/ai/registry";

// Usage : npm run topic-model -- register <SUJET> <dossier> | promote <version> | list [SUJET]
function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const sqlite = openSqlite();
  try {
    if (cmd === "register") {
      if (!AI_TOPICS.includes(a as AiTopic) || !b) throw new Error(`register <${AI_TOPICS.join("|")}> <dossier>`);
      const r = registerTopicModel(sqlite, a as AiTopic, b);
      console.log(`Enregistré : ${r.version} (${r.topic}, ${r.kind}, ${r.status})`);
    } else if (cmd === "promote") {
      if (!a) throw new Error("promote <version>");
      promoteTopicModel(sqlite, a);
      console.log(`Promu : ${a}`);
    } else if (cmd === "list") {
      console.table(sqlite.prepare(`SELECT topic, version, kind, status, created_at FROM topic_model ${a ? "WHERE topic = ?" : ""} ORDER BY topic, created_at`).all(...(a ? [a] : [])));
    } else throw new Error("Commandes : register, promote, list");
  } finally {
    sqlite.close();
  }
}

try {
  main();
} catch (e) {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exit(1);
}
