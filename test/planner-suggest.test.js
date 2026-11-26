import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ingestText } from "../src/data/ingest.js";
import { buildPlan, planMarkdown } from "../src/plan/planner.js";
import { buildRequest } from "../src/plan/spec.js";

const FACTOR_CSV = `id,gender,sat1,sat2,sat3,anx1,anx2,anx3,sat_mean,age
1,男,4,5,4,2,3,2,4.33,30
2,女,5,4,5,3,2,3,4.67,28
3,男,3,4,4,4,3,4,3.67,35
4,女,4,4,5,2,2,3,4.33,32
5,男,5,5,4,1,2,2,4.67,40
6,女,4,3,4,3,3,2,3.67,29
7,男,3,4,3,2,1,2,3.33,45
8,女,5,4,5,4,4,3,4.67,38
`;

function factorSession() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-suggest-"));
  const data = ingestText(FACTOR_CSV, { outDir, name: "suggest" });
  return { outDir, session: { id: "s_suggest", data } };
}

test("planner: 未指定题项时 EFA 给出建议方案且状态为 proposed", () => {
  const { session } = factorSession();
  const plan = buildPlan({ session, utterance: "做探索性因子分析" });
  assert.equal(plan.analysis, "efa");
  assert.equal(plan.status, "proposed");
  assert.equal(plan.questions.length, 0);
  assert.ok(plan.suggestions?.pending);
  assert.deepEqual(plan.variables.variables, ["sat1", "sat2", "sat3", "anx1", "anx2", "anx3"]);
  assert.equal(plan.options.manualNumberOfFactors, 2);
  const markdown = planMarkdown(plan);
  assert.match(markdown, /建议（尚未确认/);
  assert.match(markdown, /不是已确认的事实/);
  assert.match(markdown, /sat1/);
  assert.doesNotMatch(markdown, /已确认的因子结构/);
});

test("planner: 建议方案确认后即可生成可执行请求", () => {
  const { session } = factorSession();
  const plan = buildPlan({ session, utterance: "做探索性因子分析" });
  assert.equal(plan.status, "proposed");
  assert.equal(plan.questions.length, 0);
  plan.status = "confirmed";
  plan.confirmed_at = new Date().toISOString();
  assert.equal(plan.status, "confirmed");
  const request = buildRequest(plan);
  assert.equal(request.name, "exploratoryFactorAnalysis");
  assert.deepEqual(request.options.variables, ["sat1", "sat2", "sat3", "anx1", "anx2", "anx3"]);
  assert.equal(request.options.manualNumberOfFactors, 2);
});

test("planner: 未给因子结构时 CFA 按前缀建议两个因子", () => {
  const { session } = factorSession();
  const plan = buildPlan({ session, utterance: "做验证性因子分析" });
  assert.equal(plan.analysis, "cfa");
  assert.equal(plan.status, "proposed");
  assert.equal(plan.questions.length, 0);
  assert.ok(plan.suggestions?.pending);
  const names = plan.options.factors.map((factor) => factor.name).sort();
  assert.deepEqual(names, ["anx", "sat"]);
  const sat = plan.options.factors.find((factor) => factor.name === "sat");
  const anx = plan.options.factors.find((factor) => factor.name === "anx");
  assert.deepEqual(sat.indicators, ["sat1", "sat2", "sat3"]);
  assert.deepEqual(anx.indicators, ["anx1", "anx2", "anx3"]);
  assert.match(planMarkdown(plan), /建议因子结构/);
});

test("planner: 未给语法时 SEM 给出建议测量模型", () => {
  const { session } = factorSession();
  const plan = buildPlan({ session, utterance: "用 lavaan 拟合结构方程模型" });
  assert.equal(plan.analysis, "sem");
  assert.equal(plan.status, "proposed");
  assert.equal(plan.questions.length, 0);
  assert.ok(plan.suggestions?.pending);
  const syntax = plan.options.models[0].syntax.model;
  assert.match(syntax, /sat =~ sat1 \+ sat2 \+ sat3/);
  assert.match(syntax, /anx =~ anx1 \+ anx2 \+ anx3/);
  assert.match(planMarkdown(plan), /建议模型语法/);
  assert.match(plan.warnings.join("\n"), /建议测量模型/);
});

test("planner: 没有可推断题项时 SEM 仍追问模型语法", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-suggest-empty-"));
  try {
    const csv = `id,gender,edu\n1,男,本科\n2,女,硕士\n`;
    const data = ingestText(csv, { outDir, name: "empty" });
    const plan = buildPlan({
      session: { id: "s_empty", data },
      utterance: "用 lavaan 拟合结构方程模型",
    });
    assert.equal(plan.status, "needs_input");
    assert.ok(plan.questions.some((question) => question.includes("options.models")));
    assert.equal(plan.suggestions, undefined);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("planner: 用户已指定题项时不覆盖", () => {
  const { session } = factorSession();
  const plan = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做探索性因子分析，提取 2 个因子",
    variables: { variables: ["sat1", "sat2", "sat3"] },
  });
  assert.deepEqual(plan.variables.variables, ["sat1", "sat2", "sat3"]);
  assert.equal(plan.options.manualNumberOfFactors, 2);
  assert.equal(plan.status, "proposed");
  assert.ok(!plan.suggestions?.pending);
});
