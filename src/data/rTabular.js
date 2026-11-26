import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DETECT_TIMEOUT_MS } from "../config.js";
import { findRscript, findRuntime } from "../jasp/detect.js";
import { IngestUserError, listSheets } from "./errors.js";

const USER_CODES = new Set(["encrypted", "sheet_not_found", "empty", "empty_file", "no_sheets"]);

function readerScriptPath() {
  return fileURLToPath(new URL("../../scripts/read_tabular.R", import.meta.url));
}

function resolvePreferredEngine(explicit) {
  const raw = String(explicit || process.env.JASP_BRIDGE_TABULAR || "auto").trim().toLowerCase();
  if (raw === "node" || raw === "r" || raw === "auto") return raw;
  return "auto";
}

export function preferredTabularEngine(explicit) {
  return resolvePreferredEngine(explicit);
}

function readOutput(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decorateUserError(payload, fmt) {
  const code = payload?.code;
  const sheets = payload?.sheets;
  let message = payload?.message || "读取失败。";
  if (code === "sheet_not_found" && Array.isArray(sheets) && sheets.length > 0) {
    if (!message.includes("可用工作表")) {
      message = `${message.replace(/。$/, "")}。可用工作表：${listSheets(sheets)}`;
    }
  }
  if (code === "empty" && Array.isArray(sheets) && sheets.length > 1) {
    if (!message.includes("其他工作表") && !message.includes("sheet 参数")) {
      message = `${message.replace(/。$/, "")}。该工作簿还有其他工作表：${listSheets(sheets)}。可用 sheet 参数指定表名或从 1 开始的序号。`;
    }
  }
  if (code === "encrypted" && !/密码/.test(message)) {
    message =
      fmt === "sav"
        ? message
        : "该 Excel 工作簿已加密或受密码保护，无法读取。请先在 Excel 中取消密码后再加载。";
  }
  return new IngestUserError(message, code || "parse_error", payload || {});
}

export function tryReadWithR(filePath, { format, sheet, timeoutMs } = {}) {
  const rscript = findRscript();
  const runtime = findRuntime();
  if (!rscript) return { ok: false, code: "no_r", message: "未找到 Rscript" };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-tabular-"));
  const output = path.join(tmpDir, "result.json");
  const sheetArg = sheet === undefined || sheet === null ? "" : String(sheet);
  const result = spawnSync(
    rscript,
    ["--vanilla", readerScriptPath(), filePath, output, format, sheetArg],
    {
      encoding: "utf8",
      timeout: timeoutMs || Math.min(DETECT_TIMEOUT_MS, 60000),
      windowsHide: true,
      env: {
        ...process.env,
        ...(runtime?.path ? { JASP_RUNTIME: runtime.path } : {}),
      },
    }
  );

  const payload = readOutput(output);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }

  if (payload?.ok) {
    return {
      ok: true,
      records: payload.records || [],
      columnMeta: Object.fromEntries(
        (Array.isArray(payload.columnMeta)
          ? payload.columnMeta.map((item) => [item.name, item])
          : Object.entries(payload.columnMeta || {})
        ).map(([name, item]) => [
          name,
          {
            label: item.label || name,
            ...(item.type ? { type: item.type } : {}),
            ...(item.valueLabels ? { valueLabels: item.valueLabels } : {}),
          },
        ])
      ),
      engine: payload.engine || "r",
      sheet: payload.sheet,
      sheetIndex: payload.sheetIndex,
      sheets: payload.sheets,
    };
  }

  if (payload && USER_CODES.has(payload.code)) {
    return { ok: false, userError: decorateUserError(payload, format), code: payload.code };
  }

  const detail = (
    payload?.message ||
    result.error?.message ||
    String(result.stderr || "").trim() ||
    (result.status == null ? "R 读取超时或被中止" : "R 未能读取该文件")
  ).trim();

  return {
    ok: false,
    code: payload?.code || "parse_error",
    message: detail,
  };
}

export function readWithPreferredEngine({ filePath, format, sheet, engine, nodeRead }) {
  const mode = resolvePreferredEngine(engine);
  if (mode !== "node") {
    const r = tryReadWithR(filePath, { format, sheet });
    if (r.ok) return r;
    if (r.userError) throw r.userError;
    if (mode === "r") {
      throw new Error(`R 未能读取该文件（haven/readxl）：${r.message}`);
    }
  }
  return nodeRead();
}
