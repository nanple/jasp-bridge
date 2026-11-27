import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ingestText } from "../src/data/ingest.js";
import { detectDesign, matchSlots, wantsDemographicComparisons } from "../src/plan/advise.js";
import { buildPlan, buildPlanPackage, planMarkdown } from "../src/plan/planner.js";
import { detectNamedMethod } from "../src/plan/recipes.js";
import { isDemographicName, looksLikeDemographic } from "../src/plan/suggest.js";

const STROOP_UTTERANCE =
  "这是我的实验数据，我的实验情景是在stroop条件下检验被试的反应时与正确率，然后我使用的是颜色stroop素材，我做了个组内实验，被试考察了性别年龄和学历这三项人口学变量";

function sessionFromCsv(csv, name, types = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-advise-"));
  const data = ingestText(csv, { outDir, name, types });
  return { outDir, session: { id: `s_${name}`, data } };
}

function stroopWideSession() {
  const csv = `id,gender,age,education,rt_cong,rt_incong,acc_cong,acc_incong
1,男,21,本科,520,610,0.95,0.88
2,女,22,硕士,540,640,0.93,0.84
3,男,20,本科,500,590,0.97,0.90
4,女,23,本科,530,660,0.92,0.80
5,男,25,硕士,510,600,0.96,0.86
6,女,24,博士,550,670,0.91,0.82
`;
  return sessionFromCsv(csv, "stroop", {
    rt_cong: "scale",
    rt_incong: "scale",
    acc_cong: "scale",
    acc_incong: "scale",
    age: "scale",
  });
}

function aliasSession() {
  const csv = `id,rt,acc,gender,age,education
1,520,0.95,男,21,本科
2,540,0.90,女,22,硕士
3,500,0.97,男,20,本科
4,530,0.88,女,23,本科
`;
  return sessionFromCsv(csv, "alias", { rt: "scale", acc: "scale", age: "scale" });
}

test("设计用语：组内与被试内、重复测量、within-subjects 属于同一类", () => {
  assert.equal(detectDesign("我做了个组内实验"), "within");
  assert.equal(detectDesign("这是被试内设计"), "within");
  assert.equal(detectDesign("采用重复测量"), "within");
  assert.equal(detectDesign("a within-subjects design"), "within");
  assert.equal(detectDesign("组间实验"), "between");
  assert.equal(detectDesign("被试间设计"), "between");
  assert.equal(detectDesign("between-subjects"), "between");
  assert.equal(detectDesign("混合设计，既有组内也有组间"), "mixed");
});

test("组内不会被当成已经点名的方法", () => {
  assert.ok(!detectNamedMethod("我做了个组内实验，看反应时和正确率"));
  assert.equal(detectNamedMethod("对 sat1 到 sat3 做重复测量方差分析"), "rm_anova");
});

test("口语别名在唯一匹配时能对上 rt/acc/gender/age/education", () => {
  const { session } = aliasSession();
  const slots = matchSlots({
    utterance: "看反应时、正确率，以及性别、年龄和学历",
    session,
  });
  const rt = slots.dependents.find((entry) => entry.key === "rt");
  const acc = slots.dependents.find((entry) => entry.key === "acc");
  const gender = slots.demographics.find((entry) => entry.key === "gender");
  const age = slots.demographics.find((entry) => entry.key === "age");
  const education = slots.demographics.find((entry) => entry.key === "education");
  assert.deepEqual(rt.columns, ["rt"]);
  assert.equal(rt.status, "unique");
  assert.deepEqual(acc.columns, ["acc"]);
  assert.deepEqual(gender.columns, ["gender"]);
  assert.deepEqual(age.columns, ["age"]);
  assert.deepEqual(education.columns, ["education"]);
  assert.equal(slots.questions.length, 0);
});

test("人口学识别覆盖性别和学历，并可作为建议槽位", () => {
  assert.equal(isDemographicName("gender"), true);
  assert.equal(isDemographicName("education"), true);
  assert.equal(isDemographicName("学历"), true);
  assert.equal(looksLikeDemographic({ name: "edu", label: "学历" }), true);
  assert.equal(wantsDemographicComparisons("考察了性别年龄和学历这三项人口学变量"), true);
  assert.equal(wantsDemographicComparisons("还记了性别、年龄和学历"), false);
});

test("别名对应到多列且不是同一组内因子时，要提问而不是偷偷选定", () => {
  const csv = `id,rt,reaction_time,acc
1,520,530,0.9
2,540,550,0.8
`;
  const { session } = sessionFromCsv(csv, "ambiguous", { rt: "scale", reaction_time: "scale", acc: "scale" });
  const slots = matchSlots({ utterance: "请分析反应时和正确率", session });
  const rt = slots.dependents.find((entry) => entry.key === "rt");
  assert.equal(rt.status, "ambiguous");
  assert.ok(rt.columns.includes("rt") && rt.columns.includes("reaction_time"));
  assert.ok(slots.questions.some((question) => question.includes("反应时") && question.includes("请说明")));
  const plan = buildPlan({ session, utterance: "请分析反应时" });
  assert.ok(plan.questions.some((question) => question.includes("反应时")));
  assert.notEqual(plan.variables?.repeatedMeasuresCells?.sort()?.join(), "reaction_time,rt");
});

test("只描述实验情景、不说方法名时，给出可确认的建议而不是报错", () => {
  const { session } = stroopWideSession();
  assert.doesNotThrow(() => buildPlan({ session, utterance: STROOP_UTTERANCE }));
  const { primary, related } = buildPlanPackage({ session, utterance: STROOP_UTTERANCE });
  assert.ok(primary);
  assert.ok(["rm_anova", "descriptives"].includes(primary.analysis));
  const all = [primary, ...related];
  assert.ok(all.some((plan) => plan.analysis === "descriptives"));
  const rmPlans = all.filter((plan) => plan.analysis === "rm_anova");
  assert.ok(rmPlans.length >= 2);
  assert.ok(
    rmPlans.some((plan) => plan.variables.repeatedMeasuresCells?.join() === "rt_cong,rt_incong")
  );
  assert.ok(
    rmPlans.some((plan) => plan.variables.repeatedMeasuresCells?.join() === "acc_cong,acc_incong")
  );
  assert.ok(primary.recommendation?.sequence?.length >= 2);
  const markdown = planMarkdown(primary);
  assert.match(markdown, /方法建议/);
  assert.match(markdown, /推荐分析步骤/);
  assert.match(markdown, /组内/);
  assert.equal(primary.status === "proposed" || primary.status === "needs_input", true);
});

test("声称组内但表格更像组间时给出提醒；缺少学历列时也要提醒", () => {
  const csv = `id,gender,age,rt,acc
1,男,21,520,0.95
2,女,22,540,0.90
3,男,20,500,0.97
4,女,23,530,0.88
`;
  const { session } = sessionFromCsv(csv, "mismatch", { rt: "scale", acc: "scale", age: "scale" });
  const plan = buildPlan({ session, utterance: STROOP_UTTERANCE });
  const text = `${(plan.warnings || []).join("\n")}\n${planMarkdown(plan)}`;
  assert.match(text, /组内/);
  assert.match(text, /组间/);
  assert.match(text, /学历/);
  assert.ok(plan.recommendation?.design?.mismatch);
});

test("两个组内水平建议重复测量或配对 t，并提醒不要用独立样本 t", () => {
  const csv = `id,gender,rt_cong,rt_incong
1,男,520,610
2,女,540,640
3,男,500,590
4,女,530,660
`;
  const { session } = sessionFromCsv(csv, "two_level", { rt_cong: "scale", rt_incong: "scale" });
  const { primary, related } = buildPlanPackage({
    session,
    utterance: "这是组内实验，请看反应时在不同条件下的差异",
  });
  const all = [primary, ...related];
  const infer = all.find((plan) => plan.analysis === "rm_anova") || primary;
  assert.equal(infer.analysis, "rm_anova");
  assert.deepEqual(infer.variables.repeatedMeasuresCells, ["rt_cong", "rt_incong"]);
  const recText = `${(infer.recommendation?.alternatives || []).join("\n")}\n${planMarkdown(infer)}`;
  assert.match(recText, /配对/);
  assert.match(recText, /独立样本/);
});

test("标签为反应时时，即使列名不是 rt 也能唯一匹配", () => {
  const csv = `id,x1,acc
1,520,0.9
2,540,0.8
`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-advise-label-"));
  const data = ingestText(csv, {
    outDir,
    name: "labeled",
    types: { x1: "scale", acc: "scale" },
  });
  data.variables.find((variable) => variable.name === "x1").label = "反应时";
  const session = { id: "s_labeled", data };
  const slots = matchSlots({ utterance: "请分析反应时", session });
  const rt = slots.dependents.find((entry) => entry.key === "rt");
  assert.deepEqual(rt.columns, ["x1"]);
  assert.equal(rt.status, "unique");
});
