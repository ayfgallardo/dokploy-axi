import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countTokens } from "gpt-tokenizer/model/gpt-4o";

const FIXTURES_DIR = fileURLToPath(new URL("fixtures/", import.meta.url));

function read(name: string): string {
  return readFileSync(`${FIXTURES_DIR}${name}`, "utf-8");
}

interface Case {
  name: string;
  raw: string;
  axi: string;
  note?: string;
}

const cases: Case[] = [
  {
    name: "home",
    raw: read("raw-project-all.json"),
    axi: read("axi-home-output.txt"),
    note: "raw = project.all (the MCP call `home` is built on)",
  },
  {
    name: "service view",
    raw: read("raw-compose-one.json"),
    axi: read("axi-service-view-output.txt"),
    note: "raw = compose.one",
  },
  {
    name: "deployments",
    raw: read("raw-deployment-allByCompose.json"),
    axi: read("axi-deployments-output.txt"),
    note: "raw = deployment.allByCompose",
  },
  {
    name: "logs",
    raw: read("raw-deployment-readLogs.json"),
    axi: read("axi-logs-output.txt"),
    note: "raw = deployment.readLogs, tail=200",
  },
];

interface Row {
  name: string;
  rawTokens: number;
  axiTokens: number;
  deltaPct: number;
  note?: string;
}

function main(): void {
  const rows: Row[] = cases.map((c) => {
    const rawTokens = countTokens(c.raw);
    const axiTokens = countTokens(c.axi);
    const deltaPct =
      rawTokens === 0 ? 0 : ((axiTokens - rawTokens) / rawTokens) * 100;
    return { name: c.name, rawTokens, axiTokens, deltaPct, note: c.note };
  });

  const lines: string[] = [];
  lines.push(
    `| Commande | Tokens MCP brut | Tokens dokploy-axi | Delta % | Note |`,
  );
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const row of rows) {
    const delta = `${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct.toFixed(1)}%`;
    lines.push(
      `| ${row.name} | ${row.rawTokens} | ${row.axiTokens} | ${delta} | ${row.note ?? ""} |`,
    );
  }
  console.log(lines.join("\n"));

  const sorted = rows.map((r) => r.deltaPct).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  console.error(`\nDelta médian: ${median.toFixed(1)}%`);
}

main();
