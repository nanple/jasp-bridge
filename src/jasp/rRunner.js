import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_TIMEOUT_MS, ensureDir, newId, nowIso } from "../config.js";
import { findRscript, findRuntime } from "./detect.js";
import { buildRequest } from "../plan/spec.js";
import { requestWorker } from "./worker.js";

const active = new Set();

function runnerScriptPath() {
  return fileURLToPath(new URL("../../scripts/run_analysis.R", import.meta.url));
}

function writeStatus(runDir, status) {
  const target = path.join(runDir, "status.json");
  fs.writeFileSync(target, JSON.stringify(status, null, 2), "utf8");
}

export function readStatus(runDir) {
  const file = path.join(runDir, "status.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readResult(runDir) {
  const file = path.join(runDir, "result.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeDryRun({ session, plan, sessionRunsDir, seed = 1 }) {
  const runId = newId("r");
  const runDir = ensureDir(path.join(sessionRunsDir, runId));
  const dataSource = session.data.path;
  if (!fs.existsSync(dataSource)) throw new Error(`数据文件不存在：${dataSource}`);
  fs.copyFileSync(dataSource, path.join(runDir, "data.csv"));

  const request = buildRequest(plan, { seed });
  fs.writeFileSync(path.join(runDir, "request.json"), JSON.stringify(request, null, 2), "utf8");
  fs.copyFileSync(runnerScriptPath(), path.join(runDir, "run_analysis.R"));

  const status = {
    run_id: runId,
    plan_id: plan.id,
    analysis: plan.jasp.analysis,
    status: "dry_run",
    reason: "headless R 未就绪",
    dir: runDir,
    started_at: nowIso(),
    finished_at: nowIso(),
  };
  writeStatus(runDir, status);
  return status;
}

export function startRun({ session, plan, sessionRunsDir, seed = 1, timeoutMs = RUN_TIMEOUT_MS }) {
  const runtime = findRuntime();
  const rscript = findRscript();
  if (!runtime || !rscript) {
    return { status: writeDryRun({ session, plan, sessionRunsDir, seed }), dryRun: true };
  }

  const runId = newId("r");
  const runDir = ensureDir(path.join(sessionRunsDir, runId));
  const dataSource = session.data.path;
  if (!fs.existsSync(dataSource)) throw new Error(`数据文件不存在：${dataSource}`);
  const dataPath = path.join(runDir, "data.csv");
  fs.copyFileSync(dataSource, dataPath);

  const request = buildRequest(plan, { seed });
  const requestPath = path.join(runDir, "request.json");
  const resultPath = path.join(runDir, "result.json");
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf8");
  fs.copyFileSync(runnerScriptPath(), path.join(runDir, "run_analysis.R"));

  const status = {
    run_id: runId,
    plan_id: plan.id,
    analysis: plan.jasp.analysis,
    status: "running",
    engine: "worker",
    dir: runDir,
    started_at: nowIso(),
    timeout_ms: timeoutMs,
  };
  writeStatus(runDir, status);
  active.add(runId);

  const workerTimeout = Math.max(timeoutMs, 180000) + 120000;
  requestWorker(
    {
      id: runId,
      name: request.name,
      options: request.options,
      data_path: dataPath,
      output_dir: runDir,
      seed: request.seed,
    },
    { timeoutMs: workerTimeout }
  )
    .then((result) => {
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
      const ok = result.status === "ok" || result.status === "partial";
      writeStatus(runDir, {
        ...status,
        status: ok ? "done" : "error",
        finished_at: nowIso(),
        ...(ok
          ? {}
          : { error: result.message || result.error_message || "JASP 分析失败" }),
      });
    })
    .catch((error) => {
      writeStatus(runDir, {
        ...status,
        status: "error",
        error: error.message,
        finished_at: nowIso(),
      });
    })
    .finally(() => {
      active.delete(runId);
    });

  return { status, dryRun: false };
}

export function getRunStatus(runDir) {
  const status = readStatus(runDir);
  if (!status) return null;
  if (status.status === "running" && !active.has(status.run_id)) {
    // 服务重启后遗留的 running 状态
    const result = readResult(runDir);
    if (result) {
      return { ...status, status: result.status === "ok" ? "done" : "error" };
    }
    return { ...status, status: "interrupted" };
  }
  return status;
}
