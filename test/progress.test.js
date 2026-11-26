import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSnapshot, renderMarkdown } from "../src/progress/snapshot.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("progress: 快照包含阶段、分析清单与待办", () => {
  const snapshot = buildSnapshot({ root });
  assert.equal(snapshot.schema, "jasp-bridge/progress@1");
  assert.ok(snapshot.version);
  assert.ok(snapshot.phase);
  assert.ok(snapshot.analysis_count >= 15);
  const keys = snapshot.analyses.map((analysis) => analysis.key);
  assert.ok(keys.includes("anova"));
  assert.ok(keys.includes("process"));
  assert.ok(keys.includes("mixed_lmm"));
  assert.ok(Array.isArray(snapshot.completed));
  assert.ok(Array.isArray(snapshot.next));
  assert.ok(snapshot.recent_files.length >= 0);
});

test("progress: markdown 简报包含关键小节", () => {
  const snapshot = buildSnapshot({ root });
  const markdown = renderMarkdown(snapshot);
  assert.match(markdown, /## 已完成/);
  assert.match(markdown, /## 下一步/);
  assert.match(markdown, /## 待办清单/);
  assert.match(markdown, /## 接口/);
  assert.match(markdown, /在别的机器人里继续用的提示词/);
});

test("progress: PROGRESS.json 可解析且含 todos", () => {
  const file = path.join(root, "PROGRESS.json");
  assert.ok(fs.existsSync(file));
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(state.schema, "jasp-bridge/progress@1");
  assert.ok(Array.isArray(state.todos));
  assert.ok(Array.isArray(state.completed));
});
