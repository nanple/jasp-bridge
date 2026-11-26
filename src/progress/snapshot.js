import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RECIPES } from "../plan/recipes.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "runtime",
  "sessions",
  ".codebuddy",
  "coverage",
  ".idea",
  ".vscode",
]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listFiles(root, { days = 7, max = 400 } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) continue;
        out.push({
          path: path.relative(root, full).replace(/\\/g, "/"),
          modified: stat.mtime.toISOString(),
          bytes: stat.size,
        });
      } catch {
        // ignore
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return out.slice(0, max);
}

function analyseRecipes() {
  return Object.values(RECIPES).map((recipe) => ({
    key: recipe.key,
    label: recipe.label,
    jaspAnalysis: recipe.jasp?.analysis || null,
    module: recipe.jasp?.module || null,
    roles: Object.entries(recipe.roles || {}).map(([name, spec]) => ({
      role: name,
      label: spec.label,
      required: Boolean(spec.required),
      max: spec.max ?? null,
    })),
    keywords: recipe.keywords || [],
  }));
}

function collectSessions(homeDir) {
  const dir = path.join(homeDir, "sessions");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith("s_"));
  } catch {
    return [];
  }
  const sessions = [];
  for (const name of names) {
    const session = readJson(path.join(dir, name, "session.json"));
    if (!session) continue;
    const runs = Object.values(session.runs || {}).map((run) => ({
      run_id: run.run_id || run.id,
      analysis: run.analysis || null,
      status: run.status || "unknown",
      created_at: run.created_at || null,
    }));
    sessions.push({
      session_id: session.id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      data: session.data ? { path: session.data.path, n: session.data.n, columns: session.data.columns?.length } : null,
      plans: Object.keys(session.plans || {}).length,
      runs,
    });
  }
  sessions.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return sessions;
}

function defaultHomeDir() {
  return (
    process.env.JASP_BRIDGE_HOME ||
    path.join(os.homedir(), ".workbuddy", "jasp-bridge")
  );
}

function installedDrift(root) {
  const installed = defaultHomeDir();
  if (!fs.existsSync(path.join(installed, "package.json"))) return null;
  if (path.resolve(installed) === path.resolve(root)) return { same: true, changed: [] };

  const changed = [];
  const compare = (relative) => {
    const source = path.join(root, relative);
    const target = path.join(installed, relative);
    if (!fs.existsSync(source) || !fs.existsSync(target)) {
      changed.push(relative);
      return;
    }
    const a = fs.readFileSync(source);
    const b = fs.readFileSync(target);
    if (!a.equals(b)) changed.push(relative);
  };
  for (const relative of [
    "src/server.js",
    "src/plan/recipes.js",
    "src/plan/planner.js",
    "src/export/jaspWriter.js",
    "scripts/analysis_core.R",
    "scripts/worker.R",
    "package.json",
    "PROGRESS.json",
  ]) {
    compare(relative);
  }
  return { same: changed.length === 0, changed };
}

/**
 * Build the machine readable project snapshot used by the progress endpoint.
 */
export function buildSnapshot({ root = PROJECT_ROOT, homeDir, days = 7 } = {}) {
  const staticState = readJson(path.join(root, "PROGRESS.json")) || {};
  const pkg = readJson(path.join(root, "package.json")) || {};
  const sessions = collectSessions(homeDir || defaultHomeDir());

  return {
    schema: "jasp-bridge/progress@1",
    generated_at: new Date().toISOString(),
    root,
    version: pkg.version || staticState.version || null,
    phase: staticState.phase || null,
    status: staticState.status || "unknown",
    summary: staticState.summary || null,
    completed: staticState.completed || [],
    next: staticState.next || [],
    known_issues: staticState.known_issues || [],
    todos: staticState.todos || [],
    commands: staticState.commands || {
      smoke: "npm run smoke",
      status: "npm run status",
    },
    paths: staticState.paths || {},
    analyses: analyseRecipes(),
    analysis_count: Object.keys(RECIPES).length,
    docs: Object.fromEntries(
      ["README.md", "GUIDE.md", "HANDOFF.md", "CHANGELOG.md"].map((name) => {
        const text = readText(path.join(root, name));
        return [name, text ? { bytes: text.length, lines: text.split("\n").length } : null];
      })
    ),
    recent_files: listFiles(root, { days }),
    sessions,
    drift: installedDrift(root),
  };
}

/**
 * Render a compact markdown briefing for a chat bot.
 */
export function renderMarkdown(snapshot) {
  const lines = [];
  lines.push(`# jasp-bridge 进度快照（${snapshot.generated_at}）`);
  lines.push("");
  lines.push(`- 版本：${snapshot.version || "?"}　阶段：${snapshot.phase || snapshot.status}`);
  if (snapshot.summary) lines.push(`- 概述：${snapshot.summary}`);
  lines.push(`- 分析类型：${snapshot.analysis_count} 类`);
  lines.push("");
  lines.push("## 已完成");
  for (const item of snapshot.completed) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## 下一步");
  for (const item of snapshot.next) lines.push(`- ${item}`);
  if (snapshot.known_issues.length) {
    lines.push("");
    lines.push("## 已知问题 / 边界");
    for (const item of snapshot.known_issues) lines.push(`- ${item}`);
  }
  if (snapshot.todos.length) {
    lines.push("");
    lines.push("## 待办清单");
    for (const todo of snapshot.todos) {
      const mark = todo.status === "completed" ? "x" : todo.status === "in_progress" ? ">" : " ";
      lines.push(`- [${mark}] ${todo.content}`);
    }
  }
  lines.push("");
  lines.push("## 分析类型一览");
  for (const analysis of snapshot.analyses) {
    lines.push(
      `- \`${analysis.key}\` → ${analysis.label}　JASP: ${analysis.jaspAnalysis || "?"}（${analysis.module || "?"}）`
    );
  }
  lines.push("");
  lines.push("## 最近改动的文件");
  for (const file of snapshot.recent_files.slice(0, 25)) {
    lines.push(`- ${file.path}　${file.modified.slice(0, 16).replace("T", " ")}`);
  }
  lines.push("");
  lines.push("## 接口");
  lines.push("- GET /progress.json　机器可读快照");
  lines.push("- GET /progress.md　本文件");
  lines.push("- GET /handoff.md、/readme.md、/guide.md、/changelog.md　原文");
  lines.push("- GET /analyses.json　分析配方与变量角色");
  lines.push("- GET /files?days=7　最近改动文件");
  lines.push("- GET /tests?run=1　跑冒烟测试并返回结果");
  lines.push("- GET /sessions　会话与运行记录");
  lines.push("- POST /todos　写入待办清单（{\"content\":\"...\",\"status\":\"pending\"}）");
  lines.push("");
  lines.push("## 在别的机器人里继续用的提示词");
  lines.push("");
  lines.push("```text");
  lines.push(`项目根目录：${snapshot.root}`);
  lines.push("先读 PROGRESS.json 与 HANDOFF.md，不要重做已完成的功能。");
  lines.push(
    `当前已完成：${snapshot.completed.slice(0, 3).join("、")} 等共 ${snapshot.completed.length} 项。`
  );
  lines.push(`下一步：${(snapshot.next[0] || "（见 PROGRESS.json）")}`);
  lines.push("修改前先跑 npm run smoke；修改后用真实 JASP 数据验证。");
  lines.push("```");
  return lines.join("\n");
}

export function writeTodos(root, todos) {
  const file = path.join(root, "PROGRESS.json");
  const state = readJson(file) || {};
  state.todos = todos;
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}
