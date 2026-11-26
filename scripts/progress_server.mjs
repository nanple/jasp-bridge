#!/usr/bin/env node
/**
 * jasp-bridge progress endpoint.
 *
 * Serves the current project state over HTTP so another assistant (e.g. a bot
 * in a chat app) can pick the work up without reading the whole repository:
 *
 *   GET  /                      markdown briefing
 *   GET  /progress.json         machine readable snapshot
 *   GET  /progress.md           markdown briefing
 *   GET  /handoff.md            HANDOFF.md as-is
 *   GET  /readme.md /guide.md /changelog.md
 *   GET  /analyses.json         analysis recipes + variable roles
 *   GET  /files?days=7          recently modified files
 *   GET  /tests?run=1           run the smoke suite and return the summary
 *   GET  /sessions              sessions and runs recorded by the plugin
 *   POST /todos                 {"content":"...","status":"pending"}
 *
 * Usage: node scripts/progress_server.mjs [--port 8787]
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildSnapshot, renderMarkdown, writeTodos, PROJECT_ROOT } from "../src/progress/snapshot.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const START_PORT = Number(argValue("port", process.env.PORT || 8787));
const HOST = argValue("host", process.env.HOST || "127.0.0.1");

const DOC_FILES = {
  "/handoff.md": "HANDOFF.md",
  "/readme.md": "README.md",
  "/guide.md": "GUIDE.md",
  "/changelog.md": "CHANGELOG.md",
};

function send(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const sendJson = (res, status, value) => send(res, status, "application/json", JSON.stringify(value, null, 2));
const sendText = (res, status, value) => send(res, status, "text/plain", value);

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function runSmoke() {
  return new Promise((resolve) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", "smoke"], { cwd: ROOT, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", (error) => resolve({ ok: false, error: error.message, output }));
    child.on("exit", (code) => {
      const tests = /tests\s+(\d+)/.exec(output);
      const pass = /pass\s+(\d+)/.exec(output);
      const fail = /fail\s+(\d+)/.exec(output);
      resolve({
        ok: code === 0,
        exit_code: code,
        tests: tests ? Number(tests[1]) : null,
        passed: pass ? Number(pass[1]) : null,
        failed: fail ? Number(fail[1]) : null,
        tail: output.split("\n").slice(-25).join("\n"),
      });
    });
  });
}

function makeHandler() {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = url.pathname.replace(/\/+$/, "") || "/";
    const days = Number(url.searchParams.get("days") || 7);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      if (route === "/" || route === "/progress.md") {
        const snapshot = buildSnapshot({ root: ROOT, days });
        return sendText(res, 200, renderMarkdown(snapshot));
      }

      if (route === "/progress.json" || route === "/snapshot.json") {
        return sendJson(res, 200, buildSnapshot({ root: ROOT, days }));
      }

      if (route === "/analyses.json") {
        const snapshot = buildSnapshot({ root: ROOT, days });
        return sendJson(res, 200, {
          generated_at: snapshot.generated_at,
          count: snapshot.analysis_count,
          analyses: snapshot.analyses,
        });
      }

      if (route === "/files") {
        const snapshot = buildSnapshot({ root: ROOT, days });
        return sendJson(res, 200, { generated_at: snapshot.generated_at, files: snapshot.recent_files });
      }

      if (route === "/sessions") {
        const snapshot = buildSnapshot({ root: ROOT, days });
        return sendJson(res, 200, { generated_at: snapshot.generated_at, sessions: snapshot.sessions });
      }

      if (route === "/tests") {
        if (url.searchParams.get("run") === "1") {
          const result = await runSmoke();
          return sendJson(res, 200, { ran: true, ...result });
        }
        const snapshot = buildSnapshot({ root: ROOT, days });
        return sendJson(res, 200, { ran: false, hint: "加 ?run=1 执行 npm run smoke", tests: snapshot.tests || null });
      }

      if (DOC_FILES[route]) {
        const file = path.join(ROOT, DOC_FILES[route]);
        if (!fs.existsSync(file)) return sendText(res, 404, `缺少 ${DOC_FILES[route]}`);
        return sendText(res, 200, fs.readFileSync(file, "utf8"));
      }

      if (route === "/todos" && req.method === "POST") {
        const body = await readBody(req);
        const snapshot = buildSnapshot({ root: ROOT, days });
        const todos = Array.isArray(snapshot.todos) ? [...snapshot.todos] : [];
        if (body.content) {
          todos.push({
            id: body.id || `t_${Date.now().toString(36)}`,
            content: String(body.content),
            status: body.status || "pending",
          });
        }
        if (body.status && body.id) {
          const target = todos.find((todo) => todo.id === body.id);
          if (target) target.status = body.status;
        }
        const state = writeTodos(ROOT, todos);
        return sendJson(res, 200, { ok: true, todos: state.todos });
      }

      if (route === "/todos" && req.method === "GET") {
        const snapshot = buildSnapshot({ root: ROOT, days });
        return sendJson(res, 200, { todos: snapshot.todos });
      }

      if (route === "/openapi.json") {
        return sendJson(res, 200, {
          name: "jasp-bridge progress",
          version: "1.0",
          endpoints: [
            "GET /",
            "GET /progress.json",
            "GET /progress.md",
            "GET /handoff.md",
            "GET /readme.md",
            "GET /guide.md",
            "GET /changelog.md",
            "GET /analyses.json",
            "GET /files?days=7",
            "GET /sessions",
            "GET /tests?run=1",
            "GET /todos",
            "POST /todos",
          ],
        });
      }

      return sendJson(res, 404, { error: "not found", available: Object.keys(DOC_FILES) });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  };
}

function listen(port, attemptsLeft = 10) {
  const server = http.createServer(makeHandler());
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`端口 ${port} 被占用，改用 ${port + 1}`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`无法启动：${error.message}`);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    const info = { port, host: HOST, pid: process.pid, started_at: new Date().toISOString(), root: ROOT };
    try {
      const dir = path.join(ROOT, "sessions");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ".progress-port.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
    } catch {
      // ignore
    }
    console.log(`jasp-bridge 进度服务已启动：http://${HOST}:${port}`);
    console.log(`  GET  http://${HOST}:${port}/progress.json   机器可读快照`);
    console.log(`  GET  http://${HOST}:${port}/progress.md     给机器人读的简报`);
    console.log(`  GET  http://${HOST}:${port}/handoff.md      交接文档原文`);
    console.log(`  GET  http://${HOST}:${port}/tests?run=1     跑冒烟测试`);
    if (HOST === "0.0.0.0" || HOST === "::") {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const entry of list || []) {
          if (entry.family === "IPv4" && !entry.internal) {
            console.log(`  局域网：http://${entry.address}:${port}/progress.md`);
          }
        }
      }
    }
  });
}

listen(Number.isFinite(START_PORT) ? START_PORT : 8787);
