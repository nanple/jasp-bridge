import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function startServer() {
  const child = spawn(process.execPath, [path.join(root, "src", "server.js")], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, JASP_BRIDGE_HOME: path.join(root, ".test-home") },
  });
  const responses = new Map();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) responses.set(message.id, message);
    } catch {
      // ignore non-JSON diagnostics
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return { child, responses, send };
}

async function waitFor(responses, id, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待响应 ${id} 超时`);
}

test("MCP stdio: 初始化并列出工具", async () => {
  const { child, responses, send } = startServer();
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "jasp-bridge-test", version: "0.0.0" },
      },
    });
    const init = await waitFor(responses, 1);
    assert.equal(init.result.serverInfo.name, "jasp-bridge");

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await waitFor(responses, 2);
    const names = list.result.tools.map((tool) => tool.name);
    for (const expected of [
      "jasp_status",
      "jasp_check_update",
      "jasp_download_update",
      "jasp_load_data",
      "jasp_plan_analysis",
      "jasp_confirm_plan",
      "jasp_run",
      "jasp_get_results",
      "jasp_export",
      "jasp_run_template",
    ]) {
      assert.ok(names.includes(expected), `缺少工具 ${expected}`);
    }
    assert.ok(names.length >= 15);

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "jasp_status", arguments: {} },
    });
    const call = await waitFor(responses, 3, 20000);
    assert.ok(call.result.content[0].text.includes("JASP-Bridge"));
  } finally {
    child.kill();
  }
});
