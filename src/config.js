import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const PLUGIN_VERSION = packageJson.version;
export const PLUGIN_NAME = "jasp-bridge";

export const HOME_DIR =
  process.env.JASP_BRIDGE_HOME || path.join(os.homedir(), ".workbuddy", "jasp-bridge");
export const SESSIONS_DIR = path.join(HOME_DIR, "sessions");
export const CACHE_FILE = path.join(HOME_DIR, "capabilities.json");

export const JASP_PATH = process.env.JASP_PATH || "";
export const RSCRIPT = process.env.RSCRIPT || "Rscript";
export const RUN_TIMEOUT_MS = Number(process.env.JASP_BRIDGE_TIMEOUT_MS || 300000);
export const DETECT_TIMEOUT_MS = Number(process.env.JASP_BRIDGE_DETECT_TIMEOUT_MS || 120000);
export const MAX_ROWS_PREVIEW = 10;

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionDir(sessionId) {
  return ensureDir(path.join(SESSIONS_DIR, sessionId));
}

export function runsDir(sessionId) {
  return ensureDir(path.join(sessionDir(sessionId), "runs"));
}

export function exportsDir(sessionId) {
  return ensureDir(path.join(sessionDir(sessionId), "exports"));
}
