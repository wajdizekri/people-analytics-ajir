import fs from "node:fs";
import { pipeline } from "node:stream";
import { parse, type CsvError } from "csv-parse";

export type CsvRow = { line: number; data: Record<string, string>; raw: string; badWidth: boolean };

export class CsvHeaderError extends Error {
  constructor(readonly missing: string[]) {
    super(`Colonnes manquantes dans l'en-tête : ${missing.join(", ")}`);
  }
}

// Lecture en flux : séparateur « ; », UTF-8 avec ou sans BOM, en-tête obligatoire.
// Les champs vides sont omis de `data` (valeur absente).
export async function* readCsv(
  file: string,
  columns: readonly string[],
  onMalformed: (line: number | null, message: string) => void,
): AsyncGenerator<CsvRow> {
  const parser = parse({
    delimiter: ";",
    bom: true,
    info: true,
    raw: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    skip_records_with_error: true,
  });
  parser.on("skip", (err: CsvError & { lines?: number }) => onMalformed(err.lines ?? null, err.message));
  pipeline(fs.createReadStream(file), parser, () => {});

  let index: number[] | null = null;
  let width = 0;
  for await (const rec of parser as AsyncIterable<{ record: string[]; info: { lines: number }; raw: string }>) {
    if (!index) {
      const header = rec.record.map((h) => h.trim().toLowerCase());
      const missing = columns.filter((c) => !header.includes(c));
      if (missing.length) throw new CsvHeaderError(missing);
      index = columns.map((c) => header.indexOf(c));
      width = header.length;
      continue;
    }
    const data: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      const v = rec.record[index[i]];
      if (v !== undefined && v !== "") data[columns[i]] = v;
    }
    yield { line: rec.info.lines, data, raw: rec.raw, badWidth: rec.record.length !== width };
  }
}
