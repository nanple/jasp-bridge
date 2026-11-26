import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const CSV = `id,gender,age,sat1,sat2,sat3,perf
1,男,30,4,5,4,90
2,女,28,5,4,5,88
3,男,35,3,4,4,85
4,女,32,4,4,5,87
5,男,40,5,5,4,92
6,女,29,4,3,4,80
7,男,45,3,4,3,78
8,女,38,5,4,5,89
`;

function startServer(home) {
  const child = spawn(process.execPath, [path.join(root, "src", "server.js")], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, JASP_BRIDGE_HOME: home },
  });
  const responses = new Map();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) responses.set(message.id, message);
    } catch {
      // ignore
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return { child, responses, send };
}

async function waitFor(responses, id, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`等待响应 ${id} 超时`);
}

test("端到端：加载数据 → 计划 → 确认 → dry-run → 结果", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-e2e-"));
  const csvPath = path.join(home, "demo.csv");
  fs.writeFileSync(csvPath, CSV, "utf8");

  const { child, responses, send } = startServer(home);
  let nextId = 100;
  const call = async (name, args) => {
    const id = nextId++;
    send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const response = await waitFor(responses, id);
    assert.ok(!response.error, `${name} 返回协议错误：${JSON.stringify(response.error)}`);
    return response.result;
  };
  const textOf = (result) => result.content.map((item) => item.text).join("\n");

  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "jasp-bridge-e2e", version: "0.0.0" },
      },
    });
    await waitFor(responses, 1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await waitFor(responses, 2);

    const loaded = await call("jasp_load_data", {
      path: csvPath,
      types: { age: "scale", perf: "scale" },
    });
    const loadedText = textOf(loaded);
    const sessionId = loadedText.match(/session_id\*\*：`(s_[a-z0-9]+)`/)?.[1];
    assert.ok(sessionId, `未解析到 session_id：${loadedText}`);
    assert.match(loadedText, /样本量/);

    const described = await call("jasp_describe_data", { session_id: sessionId });
    assert.match(textOf(described), /gender/);

    const planned = await call("jasp_plan_analysis", {
      session_id: sessionId,
      utterance: "比较男女在绩效上的差异",
      analysis: "ttest_independent",
      variables: { dependent: ["perf"], group: ["gender"] },
    });
    const plannedText = textOf(planned);
    const planId = plannedText.match(/分析计划 `(p_[a-z0-9]+)`/)?.[1];
    assert.ok(planId, `未解析到 plan_id：${plannedText}`);

    const confirmed = await call("jasp_confirm_plan", {
      session_id: sessionId,
      plan_id: planId,
    });
    assert.match(textOf(confirmed), /已确认/);

    const run = await call("jasp_run", { session_id: sessionId, plan_id: planId });
    const runText = textOf(run);
    assert.match(runText, /dry-run/);
    const runId = runText.match(/run_id：`(r_[a-z0-9]+)`/)?.[1];
    assert.ok(runId, `未解析到 run_id：${runText}`);

    const results = await call("jasp_get_results", {
      session_id: sessionId,
      run_id: runId,
    });
    assert.match(textOf(results), /dry-run/);

    const exportedRequest = await call("jasp_export", {
      session_id: sessionId,
      plan_id: planId,
      format: "request",
    });
    assert.match(textOf(exportedRequest), /已导出/);

    const exportedScript = await call("jasp_export", {
      session_id: sessionId,
      plan_id: planId,
      format: "rscript",
    });
    assert.match(textOf(exportedScript), /run_analysis\.R/);
  } finally {
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
