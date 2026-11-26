import fs from "node:fs";
import { readSav, ReadStatMeasure, ReadStatType, valueIsMissing } from "@irbisadm/statfmt";
import { IngestUserError } from "./errors.js";

const MEASURE_TYPE = {
  [ReadStatMeasure.NOMINAL]: "nominal",
  [ReadStatMeasure.ORDINAL]: "ordinal",
  [ReadStatMeasure.SCALE]: "scale",
};

function isMissingCell(value, variable) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && !Number.isFinite(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  try {
    if (typeof valueIsMissing === "function" && valueIsMissing(value, variable)) return true;
  } catch {
    // Some builds only accept ReadStatValue objects; range checks below still apply.
  }
  const ranges = variable?.missingRanges || [];
  if (typeof value === "number") {
    for (const range of ranges) {
      if (Array.isArray(range) && range.length >= 2) {
        if (value >= range[0] && value <= range[1]) return true;
      } else if (range && typeof range === "object") {
        const lo = range.from ?? range.lo ?? range.value;
        const hi = range.to ?? range.hi ?? range.value;
        if (lo !== undefined && hi !== undefined && value >= lo && value <= hi) return true;
      } else if (range === value) {
        return true;
      }
    }
  }
  return false;
}

function cellValue(value, variable) {
  if (isMissingCell(value, variable)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const date = value.toISOString().slice(0, 10);
    const time = value.toISOString().slice(11, 19);
    return time === "00:00:00" ? date : `${date} ${time}`;
  }
  if (typeof value === "string") {
    // SPSS 固定宽度字符串常以空格补齐。
    return value.trimEnd();
  }
  return value;
}

function valueLabelMap(variable) {
  const labels = variable?.valueLabels;
  if (!labels) return null;
  const map = {};
  if (Array.isArray(labels)) {
    for (const item of labels) {
      if (item == null) continue;
      if (typeof item === "object") {
        const value = item.value;
        const label = item.label;
        if (value !== undefined && label !== undefined) map[String(value)] = String(label);
      }
    }
  } else if (typeof labels === "object") {
    for (const [key, label] of Object.entries(labels)) {
      map[String(key)] = String(label);
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

function measureType(variable) {
  if (variable?.type === ReadStatType.STRING || variable?.type === ReadStatType.STRING_REF) {
    return "nominal";
  }
  return MEASURE_TYPE[variable?.measure] || null;
}

export function parseSavBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new IngestUserError("文件为空，不是有效的 SPSS 数据文件（.sav）。", "empty_file");
  }
  let dataset;
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const exact =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    dataset = readSav(exact);
  } catch (error) {
    const message = String(error?.message || error);
    throw new IngestUserError(
      `无法解析该 SPSS 数据文件（.sav），文件可能已损坏或不是有效的 SPSS 格式。${
        message && !/sav/i.test(message) ? `（${message}）` : ""
      }`,
      "corrupt"
    );
  }

  const variables = dataset.variables || [];
  if (variables.length === 0) {
    throw new IngestUserError("该 .sav 文件中没有任何变量列。", "empty");
  }

  const objects =
    typeof dataset.toObjects === "function"
      ? dataset.toObjects()
      : (dataset.rows || []).map((row) => {
          const record = {};
          variables.forEach((variable, index) => {
            record[variable.name] = row[index];
          });
          return record;
        });

  const records = objects.map((row) => {
    const record = {};
    for (const variable of variables) {
      record[variable.name] = cellValue(row[variable.name], variable);
    }
    return record;
  });

  if (records.length === 0) {
    throw new IngestUserError("该 .sav 文件没有数据行（至少需要 1 行记录）。", "empty");
  }

  const columnMeta = {};
  for (const variable of variables) {
    const meta = {
      label: variable.label && String(variable.label).trim() ? String(variable.label).trim() : variable.name,
    };
    const type = measureType(variable);
    if (type) meta.type = type;
    const labels = valueLabelMap(variable);
    if (labels) meta.valueLabels = labels;
    columnMeta[variable.name] = meta;
  }

  return {
    records,
    columnMeta,
    engine: "node",
  };
}

export function parseSavFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return parseSavBuffer(buffer);
}
