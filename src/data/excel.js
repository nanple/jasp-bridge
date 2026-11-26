import fs from "node:fs";
import * as XLSX from "@e965/xlsx";
import { IngestUserError, listSheets } from "./errors.js";

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENCRYPTION_ENTRY = /(?:^|\/)(encryptioninfo|encryptedpackage)$/i;

function isOle(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_MAGIC);
}

function isZip(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function zipEntryNames(buffer) {
  if (buffer.length < 22) return null;
  const eocdSig = 0x06054b50;
  const start = Math.max(0, buffer.length - 22 - 65536);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      return null;
    }
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8"));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function cfbPaths(buffer) {
  const parsed = XLSX.CFB.read(buffer, { type: "buffer" });
  return (parsed.FullPaths || []).map((item) => String(item));
}

function looksLikeWorkbookZip(names) {
  return names.some((name) => {
    const lower = name.replace(/\\/g, "/").toLowerCase();
    return (
      lower.endsWith("xl/workbook.xml") ||
      lower === "[content_types].xml" ||
      lower.endsWith("/workbook.xml")
    );
  });
}

function encryptedError(kind) {
  const label = kind === "xls" ? "旧版 Excel 工作簿（.xls）" : "Excel 工作簿";
  return new IngestUserError(
    `该${label}已加密或受密码保护，无法读取。请先在 Excel 中取消密码后再加载。`,
    "encrypted"
  );
}

function corruptError(ext) {
  return new IngestUserError(
    `无法解析该 Excel 文件（${ext}），文件可能已损坏、不是有效的 Excel 工作簿，或使用了无法识别的格式。`,
    "corrupt"
  );
}

export function inspectExcelBuffer(buffer, ext = ".xlsx") {
  if (!buffer || buffer.length === 0) {
    throw new IngestUserError(`文件为空，不是有效的 Excel 工作簿（${ext}）。`, "empty_file");
  }
  if (isOle(buffer)) {
    let paths = [];
    try {
      paths = cfbPaths(buffer);
    } catch {
      if (ext === ".xlsx" || ext === ".xlsm") throw encryptedError(ext);
      throw corruptError(ext);
    }
    if (paths.some((name) => ENCRYPTION_ENTRY.test(name.replace(/\\/g, "/")))) {
      throw encryptedError(ext);
    }
    if (ext === ".xlsx" || ext === ".xlsm") {
      // Unencrypted OOXML is a ZIP; an .xlsx that is an OLE container is almost always encrypted.
      throw encryptedError(ext);
    }
    return "xls";
  }
  if (isZip(buffer)) {
    const names = zipEntryNames(buffer);
    if (!names) throw corruptError(ext);
    if (names.some((name) => ENCRYPTION_ENTRY.test(name.replace(/\\/g, "/")))) {
      throw encryptedError(ext);
    }
    if (!looksLikeWorkbookZip(names)) throw corruptError(ext);
    return "xlsx";
  }
  throw corruptError(ext);
}

export function resolveSheet(sheetNames, sheet) {
  const available = listSheets(sheetNames);
  if (!sheetNames || sheetNames.length === 0) {
    throw new IngestUserError("工作簿中没有任何工作表。", "no_sheets");
  }
  if (sheet === undefined || sheet === null || sheet === "") {
    return { name: sheetNames[0], index: 1 };
  }
  if (typeof sheet === "number" || (typeof sheet === "string" && /^-?\d+$/.test(String(sheet).trim()))) {
    const n = Number(sheet);
    if (!Number.isInteger(n) || n < 1) {
      throw new IngestUserError(
        `工作表序号从 1 开始（对应 Excel 中的第 1 张表），收到的是 ${sheet}。可用工作表：${available}`,
        "sheet_not_found",
        { sheets: sheetNames }
      );
    }
    if (n > sheetNames.length) {
      throw new IngestUserError(
        `工作簿没有第 ${n} 张表。可用工作表：${available}`,
        "sheet_not_found",
        { sheets: sheetNames }
      );
    }
    return { name: sheetNames[n - 1], index: n };
  }
  const name = String(sheet);
  const idx = sheetNames.indexOf(name);
  if (idx === -1) {
    throw new IngestUserError(
      `找不到名为「${name}」的工作表。可用工作表：${available}`,
      "sheet_not_found",
      { sheets: sheetNames }
    );
  }
  return { name, index: idx + 1 };
}

function uniquifyHeaders(headers) {
  const seen = new Map();
  return headers.map((raw, index) => {
    let name = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!name) name = `未命名${index + 1}`;
    const base = name;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const date = value.toISOString().slice(0, 10);
    const time = value.toISOString().slice(11, 19);
    return time === "00:00:00" ? date : `${date} ${time}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : value;
  }
  if (typeof value === "boolean") return value;
  return value;
}

function recordsFromSheet(worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    return { columns: [], records: [] };
  }
  const headers = uniquifyHeaders(rows[0] || []);
  const records = [];
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row) || row.every((value) => cellValue(value) === null)) continue;
    const record = {};
    headers.forEach((column, index) => {
      record[column] = cellValue(row[index]);
    });
    records.push(record);
  }
  return { columns: headers, records };
}

export function parseExcelBuffer(buffer, options = {}, ext = ".xlsx") {
  inspectExcelBuffer(buffer, ext);
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      raw: true,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/password|encrypt/i.test(message)) throw encryptedError(ext);
    throw corruptError(ext);
  }
  const sheetNames = workbook.SheetNames || [];
  const selected = resolveSheet(sheetNames, options.sheet);
  const worksheet = workbook.Sheets[selected.name];
  if (!worksheet) {
    throw new IngestUserError(
      `找不到名为「${selected.name}」的工作表。可用工作表：${listSheets(sheetNames)}`,
      "sheet_not_found",
      { sheets: sheetNames }
    );
  }
  const { records } = recordsFromSheet(worksheet);
  if (records.length === 0) {
    const hint =
      sheetNames.length > 1
        ? `该工作簿还有其他工作表：${listSheets(sheetNames)}。可用 sheet 参数指定表名或从 1 开始的序号。`
        : "请确认第一行是变量名，且至少有 1 行数据。";
    throw new IngestUserError(
      `工作表「${selected.name}」没有数据行（至少需要 1 行记录）。${hint}`,
      "empty",
      { sheets: sheetNames, sheet: selected.name }
    );
  }
  return {
    records,
    sheet: selected.name,
    sheetIndex: selected.index,
    sheets: sheetNames,
    engine: "node",
  };
}

export function parseExcelFile(filePath, options = {}, ext = ".xlsx") {
  const buffer = fs.readFileSync(filePath);
  return parseExcelBuffer(buffer, options, ext);
}
