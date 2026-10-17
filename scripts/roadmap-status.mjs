import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const groups = {
  BASE: "Release foundation and acceptance", REL: "Release foundation and acceptance",
  ISO: "Isolation, membership and authentication", IAM: "Isolation, membership and authentication",
  SCORE: "Match-day scoring and mobile",
  REG: "Registration and competition", COMP: "Registration and competition",
  PUB: "Public records, awards and prizes",
  UX: "Role UX and fan engagement", FAN: "Role UX and fan engagement",
  PREM: "White-label and commercial",
};

/** Inventory only. Never infer completion/acceptance from code or test counts. */
export function roadmapStatus(source) {
  const start = source.indexOf("## 16. Phased Implementation Checklists");
  const end = source.indexOf("## 17. Delivery Gates", start);
  if (start < 0 || end < 0) throw new Error("Authoritative roadmap checklist section is missing");
  const tasks = [...source.slice(start, end).matchAll(/^- \[([ xX])\] \*\*([A-Z]+-\d+):\*\*\s*(.+)$/gm)]
    .map(([, checked, id, description]) => ({ id, checked: checked.toLowerCase() === "x", description: description.trim() }));
  if (!tasks.length) throw new Error("No authoritative roadmap tasks found");
  const seen = new Set();
  const grouped = new Map();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`Duplicate roadmap ID: ${task.id}`);
    seen.add(task.id);
    const group = groups[task.id.split("-")[0]];
    if (!group) throw new Error(`Unclassified roadmap task: ${task.id}`);
    if (!task.checked) grouped.set(group, [...(grouped.get(group) ?? []), task.id]);
  }
  const checked = tasks.filter(task => task.checked).length;
  return { total: tasks.length, checked, open: tasks.length - checked,
    groups: [...grouped].map(([name, ids]) => ({ name, open: ids.length, ids })),
    caveat: "Open includes partially implemented work and acceptance gates; these are not remaining batch estimates." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = roadmapStatus(readFileSync(new URL("../docs/SAAS_MASTER_PLAN_2026-10-12.md", import.meta.url), "utf8"));
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Roadmap: ${report.checked} checked / ${report.open} open / ${report.total} IDs`);
    console.table(report.groups.map(({ name, open }) => ({ group: name, open })));
    console.log(report.caveat);
  }
}
