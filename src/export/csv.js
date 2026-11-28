import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../config.js";
import { formatCell } from "../format.js";
import { tableToRows } from "../jasp/parse.js";

function csvEscape(value) {
  const text = formatCell(value);
  if (text === "") return "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeName(value, fallback) {
  const name = String(value || fallback)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return name || fallback;
}

export function exportTablesToCsv(tables, outDir) {
  ensureDir(outDir);

  const entries = Object.entries(tables || {});
  const files = [];

  entries.forEach(([key, table], index) => {
    const { headers, rows } = tableToRows(table);
    if (headers.length === 0 || rows.length === 0) return;

    const title = table?.title || key || `table_${index + 1}`;
    const fileName = `${String(index + 1).padStart(2, "0")}_${safeName(
      title,
      `table_${index + 1}`
    )}.csv`;
    const filePath = path.join(outDir, fileName);

    const lines = [
      headers.map(csvEscape).join(","),
      ...rows.map((row) => row.map(csvEscape).join(",")),
    ];
    // BOM so Excel opens Chinese headers correctly.
    fs.writeFileSync(filePath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");

    files.push({
      key,
      title,
      file: filePath,
      rows: rows.length,
      columns: headers.length,
    });
  });

  return files;
}
