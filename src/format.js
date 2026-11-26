function cell(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  s = s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  if (s.length > 160) s = `${s.slice(0, 157)}...`;
  return s;
}

export function mdTable(headers, rows) {
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(cell).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

export function jsonBlock(value) {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

export function truncate(value, max = 4000) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max)}\n... (${s.length - max} chars omitted)` : s;
}

export function bulletList(items) {
  if (!items || items.length === 0) return "";
  return items.map((item) => `- ${item}`).join("\n");
}

export function formatNumber(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return Number(value.toFixed(digits)).toString();
}
