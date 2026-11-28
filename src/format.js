const CELL_META_KEYS = new Set([
  "type",
  "format",
  "superscript",
  "superscripts",
  "rowSpan",
  "colSpan",
  ".isNewGroup",
  "isStartOfNewGroup",
]);

/**
 * Flatten a JASP table cell into readable text.
 * Numeric cells often arrive as { value, type, format } instead of a bare number.
 */
export function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatCell).filter((item) => item !== "").join(", ");
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      const main = formatCell(value.value);
      const mark = value.superscript == null || value.superscript === "" ? "" : String(value.superscript);
      return mark ? `${main}${mark}` : main;
    }
    const lower = value.lower ?? value.min;
    const upper = value.upper ?? value.max;
    if (lower != null || upper != null) {
      const lo = formatCell(lower);
      const hi = formatCell(upper);
      if (lo && hi) return `${lo}–${hi}`;
      return lo || hi;
    }
    const keys = Object.keys(value);
    const dataKeys = keys.filter((key) => !CELL_META_KEYS.has(key) && !String(key).startsWith("."));
    const useKeys = dataKeys.length > 0 ? dataKeys : keys;
    const parts = useKeys
      .map((key) => {
        const formatted = formatCell(value[key]);
        if (formatted === "") return "";
        return useKeys.length > 1 ? `${key}: ${formatted}` : formatted;
      })
      .filter(Boolean);
    return parts.join(", ");
  }
  return String(value);
}

function cell(value) {
  let s = formatCell(value);
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
