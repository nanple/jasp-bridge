import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { RUN_TIMEOUT_MS } from "../config.js";
import { findRscript, findRuntime } from "./detect.js";

let worker = null;

function workerScriptPath() {
  return fileURLToPath(new URL("../../scripts/worker.R", import.meta.url));
}

function logWorker(message) {
  const text = String(message || "").trim();
  if (text) console.error(`[jasp-worker] ${text}`);
}

export function isWorkerRunning() {
  return Boolean(worker && !worker.exited);
}

export async function ensureWorker({ timeoutMs = 180000 } = {}) {
  if (worker && !worker.exited) {
    await worker.ready;
    return worker;
  }

  const runtime = findRuntime();
  const rscript = findRscript();
  if (!runtime || !rscript) {
    throw new Error("JASP 运行时或 Rscript 不可用，无法启动常驻 R worker。");
  }

  const child = spawn(rscript, ["--vanilla", workerScriptPath()], {
    env: { ...process.env, JASP_RUNTIME: runtime.path },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const state = {
    child,
    pending: new Map(),
    nextId: 0,
    exited: false,
    ready: null,
    resolveReady: null,
    rejectReady: null,
  };
  state.ready = new Promise((resolve, reject) => {
    state.resolveReady = resolve;
    state.rejectReady = reject;
  });
  worker = state;

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed === "READY") {
      state.resolveReady?.();
      state.resolveReady = null;
      state.rejectReady = null;
      return;
    }
    if (!trimmed) return;
    try {
      const message = JSON.parse(trimmed);
      if (message.id && state.pending.has(message.id)) {
        const pending = state.pending.get(message.id);
        state.pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve(message);
      }
    } catch {
      logWorker(trimmed);
    }
  });

  child.stderr.on("data", (chunk) => logWorker(chunk.toString()));
  child.on("error", (error) => {
    state.exited = true;
    state.rejectReady?.(error);
    state.rejectReady = null;
    if (worker === state) worker = null;
  });
  child.on("exit", (code) => {
    state.exited = true;
    const error = new Error(`R worker 退出（code ${code}）`);
    state.rejectReady?.(error);
    state.rejectReady = null;
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    state.pending.clear();
    if (worker === state) worker = null;
  });

  const timer = setTimeout(() => {
    state.rejectReady?.(new Error("R worker 启动超时（首次加载 jaspTools 可能较慢）"));
    state.rejectReady = null;
    stopWorker();
  }, timeoutMs);

  try {
    await state.ready;
  } finally {
    clearTimeout(timer);
  }
  return state;
}

export async function requestWorker(payload, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
  const state = await ensureWorker({ timeoutMs: Math.max(180000, timeoutMs) });
  if (state.exited) throw new Error("R worker 已退出。");

  return new Promise((resolve, reject) => {
    const id = `w_${++state.nextId}`;
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`R worker 请求超时（${timeoutMs} ms）`));
      stopWorker();
    }, timeoutMs);

    state.pending.set(id, { resolve, reject, timer });
    try {
      state.child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    } catch (error) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(error);
    }
  });
}

export function stopWorker() {
  if (!worker) return;
  const state = worker;
  worker = null;
  state.exited = true;
  try {
    state.child.kill();
  } catch {
    // ignore
  }
}

process.on("exit", stopWorker);
