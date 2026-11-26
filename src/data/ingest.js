import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { ensureDir } from "../config.js";

const MISSING = new Set(["", "na", "n/a", "null", "nan", "none", "."]);

function isMissing(value) {
  return value === null || value === undefined || MISSING.has(String(value).trim().toLowerCase());
}

function toNumber(value) {
  if (isMissing(value)) return NaN;
  const cleaned = String(value).trim().replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function looksLikeId(name) {
  return /^(id|no|index|编号|序号|被试编号|subject_?id|participant_?id)$/i.test(String(name).trim());
}

export function looksCategorical(name) {
  return /(gender|sex|性别|group|组别|分组|condition|实验条件|edu|education|学历|年级|class|类别|category|type|类型|level|水平)/i.test(
    name
  );
}

function isIntegerToken(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
  const raw = String(value).trim().replace(/,/g, "");
  // "4.0" / "3.50" keep a decimal point in the source, so treat as continuous.
  return !/[.]/.test(raw);
}

function isLikertLikeIntegers(nums) {
  if (nums.length === 0) return false;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  // Typical item scales such as 1–5, 1–7, or 0–10. A sample may only use part of the range.
  return min >= 0 && max <= 10 && max - min <= 10;
}

export function inferType(name, values, override) {
  if (override) return override;
  if (looksLikeId(name)) return "nominal";
  if (looksCategorical(name)) return "nominal";

  const present = values.filter((v) => !isMissing(v));
  if (present.length === 0) return "nominal";

  const nums = present.map(toNumber).filter(Number.isFinite);
  const numericRatio = nums.length / present.length;

  if (numericRatio >= 0.9) {
    const allInteger = present.every(isIntegerToken);
    const uniqueNumeric = new Set(nums.map((n) => n)).size;
    // Unique count alone is not enough: decimal means/totals stay scale even when few distinct values.
    if (!allInteger) return "scale";
    if (uniqueNumeric <= 2) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      // Typical dummy codes such as 0/1 or 1/2. A 1–5 item that only used 4 and 5 stays ordinal.
      if ((min === 0 || min === 1) && max - min <= 1) return "nominal";
      if (isLikertLikeIntegers(nums)) return "ordinal";
      return "scale";
    }
    if (isLikertLikeIntegers(nums)) return "ordinal";
    return "scale";
  }
  return "nominal";
}

function summarize(values, type) {
  const present = values.filter((v) => !isMissing(v));
  const missing = values.length - present.length;
  const unique = new Set(present.map((v) => String(v).trim())).size;
  const summary = { missing, unique };

  if (type === "scale" || type === "ordinal") {
    const nums = present.map(toNumber).filter(Number.isFinite);
    if (nums.length > 0) {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance =
        nums.length > 1
          ? nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (nums.length - 1)
          : 0;
      summary.mean = Number(mean.toFixed(4));
      summary.sd = Number(Math.sqrt(variance).toFixed(4));
      summary.min = Math.min(...nums);
      summary.max = Math.max(...nums);
    }
  }

  if (type === "nominal" || type === "ordinal") {
    const counts = new Map();
    for (const value of present) {
      const key = String(value).trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    summary.levels = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([value, count]) => ({ value, count }));
  }

  return summary;
}

function normalizeRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("数据为空：至少需要 1 行记录。");
  }
  const columns = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0) throw new Error("未能识别出任何变量列。");
  return { columns, records };
}

function parseCsv(text, delimiter) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: false,
    delimiter,
  });
}

function parseJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.data)) return parsed.data;
  throw new Error("JSON 数据需为对象数组，或包含 rows/data 数组。");
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filePath, columns, records) {
  const lines = [columns.map(csvEscape).join(",")];
  for (const record of records) {
    lines.push(columns.map((column) => csvEscape(record[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function ingestText(text, options) {
  const { format = "csv", types = {}, outDir, name = "data" } = options;
  if (!outDir) throw new Error("ingestText 需要 outDir 参数。");
  ensureDir(outDir);

  let records;
  if (format === "json") {
    records = parseJson(text);
  } else if (format === "tsv" || format === "tab") {
    records = parseCsv(text, "\t");
  } else {
    records = parseCsv(text, ",");
  }

  const normalized = normalizeRecords(records);
  const columns = normalized.columns;
  const rows = normalized.records;

  const variables = columns.map((column) => {
    const values = rows.map((row) => row[column]);
    const type = inferType(column, values, types[column]);
    return {
      name: column,
      label: column,
      type,
      ...summarize(values, type),
    };
  });

  const dataPath = path.join(outDir, `${name.replace(/[^\w.-]+/g, "_")}.csv`);
  writeCsv(dataPath, columns, rows);

  return {
    path: dataPath,
    format,
    name,
    n: rows.length,
    columns,
    variables,
    preview: rows.slice(0, 10),
  };
}

export function ingestFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".sav") {
    throw new Error(
      "P0 暂不支持直接读取 .sav。请先在 JASP 中另存为 CSV，或使用 jasp_run_template 重放已有 .jasp 模板。"
    );
  }
  const format =
    options.format ||
    (ext === ".json" ? "json" : ext === ".tsv" || ext === ".tab" ? "tsv" : "csv");
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return ingestText(text, {
    ...options,
    format,
    name: options.name || path.basename(filePath, ext),
    sourcePath: filePath,
  });
}

export function profileMarkdown(data) {
  const headers = ["变量", "类型", "缺失", "唯一值", "均值", "标准差", "范围", "水平"];
  const rows = data.variables.map((v) => [
    v.name,
    v.type,
    v.missing,
    v.unique,
    v.mean ?? "",
    v.sd ?? "",
    v.min !== undefined ? `${v.min} ~ ${v.max}` : "",
    v.levels ? v.levels.map((l) => `${l.value}(${l.count})`).join(", ") : "",
  ]);
  const lines = [
    `**样本量**：${data.n} 行 × ${data.columns.length} 列`,
    "",
    "| " + headers.join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
    ...rows.map((row) => "| " + row.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ") + " |"),
  ];
  return lines.join("\n");
}
