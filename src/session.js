import fs from "node:fs";
import path from "node:path";
import { newId, nowIso, sessionDir } from "./config.js";

function sessionFile(sessionId) {
  return path.join(sessionDir(sessionId), "session.json");
}

export function createSession(meta = {}) {
  const id = newId("s");
  const session = {
    schema: "jasp-bridge/session@1",
    id,
    created_at: nowIso(),
    updated_at: nowIso(),
    data: null,
    plans: {},
    runs: {},
    ...meta,
  };
  saveSession(session);
  return session;
}

export function saveSession(session) {
  session.updated_at = nowIso();
  const dir = sessionDir(session.id);
  const target = path.join(dir, "session.json");
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), "utf8");
  fs.renameSync(tmp, target);
  return session;
}

export function loadSession(sessionId) {
  const file = sessionFile(sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function requireSession(sessionId) {
  const session = loadSession(sessionId);
  if (!session) {
    throw new Error(
      `找不到会话 ${sessionId}。请先调用 jasp_load_data 或 jasp_ingest_data 创建会话。`
    );
  }
  return session;
}

export function updateSession(sessionId, mutator) {
  const session = requireSession(sessionId);
  const next = mutator(session) || session;
  return saveSession(next);
}
