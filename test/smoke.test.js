import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ingestText, profileMarkdown } from "../src/data/ingest.js";
import { buildPlan, patchPlan, planMarkdown } from "../src/plan/planner.js";
import { DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD } from "../src/plan/recipes.js";
import { buildRequest, buildTemplate } from "../src/plan/spec.js";

const CSV = `id,gender,edu,age,sat1,sat2,sat3,perf
1,男,本科,30,4,5,4,90
2,女,硕士,28,5,4,5,88
3,男,博士,35,3,4,4,85
4,女,本科,32,4,4,5,87
5,男,硕士,40,5,5,4,92
6,女,博士,29,4,3,4,80
7,男,本科,45,3,4,3,78
8,女,硕士,38,5,4,5,89
`;

function fixture() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-test-"));
  const data = ingestText(CSV, {
    outDir,
    name: "demo",
    types: { age: "scale", perf: "scale", sat1: "ordinal", sat2: "ordinal", sat3: "ordinal" },
  });
  return { outDir, session: { id: "s_test", data } };
}

function mixedFixture() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-mixed-"));
  const rows = [];
  for (let subject = 1; subject <= 6; subject += 1) {
    for (let wave = 1; wave <= 3; wave += 1) {
      const condition = subject % 2 === 0 ? "B" : "A";
      rows.push(`S0${subject},W${wave},${condition},${20 + subject + wave}`);
    }
  }
  const csv = `subject,wave,condition,score\n${rows.join("\n")}\n`;
  const data = ingestText(csv, {
    outDir,
    name: "mixed",
    types: { score: "scale" },
  });
  return { outDir, session: { id: "s_mixed", data } };
}

test("ingest: 变量类型、缺失与描述统计", () => {
  const { session } = fixture();
  const data = session.data;
  assert.equal(data.n, 8);
  assert.deepEqual(data.columns, ["id", "gender", "edu", "age", "sat1", "sat2", "sat3", "perf"]);
  assert.equal(data.variables.find((v) => v.name === "gender").type, "nominal");
  assert.equal(data.variables.find((v) => v.name === "age").type, "scale");
  assert.equal(data.variables.find((v) => v.name === "perf").mean, 86.125);
  assert.equal(data.variables.find((v) => v.name === "edu").levels.length, 3);
  assert.match(profileMarkdown(data), /样本量/);
  assert.ok(fs.existsSync(data.path));
});

test("planner: 描述统计计划与请求生成", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "对年龄和绩效做描述统计",
    analysis: "descriptives",
    variables: { variables: ["age", "perf"] },
  });
  assert.equal(plan.analysis, "descriptives");
  assert.equal(plan.jasp.analysis, "Descriptives");
  assert.equal(plan.status, "proposed");
  assert.deepEqual(plan.options.variables, ["age", "perf"]);
  assert.equal(plan.options.shapiroWilkTest, false);
  assert.equal(plan.options.matrixPlot, false);
  assert.equal(plan.warnings.some((warning) => warning.includes("Shapiro-Wilk") || warning.includes("matrixPlot")), false);

  const request = buildRequest(plan);
  assert.equal(request.name, "Descriptives");
  assert.deepEqual(request.options.variables, ["age", "perf"]);
  assert.equal(request.options.shapiroWilkTest, false);
  assert.equal(request.options.matrixPlot, false);
  assert.equal(request.seed, 1);

  const template = buildTemplate(plan);
  assert.equal(template.schema, "jasp-bridge/template@1");
  assert.equal(template.analyses[0].name, "Descriptives");
});

function wideDescriptivesFixture(variableCount) {
  const names = Array.from({ length: variableCount }, (_, index) => `item${index + 1}`);
  const header = ["id", ...names].join(",");
  const rows = [];
  for (let row = 1; row <= 8; row += 1) {
    rows.push([row, ...names.map((_, index) => ((row + index) % 5) + 1)].join(","));
  }
  const csv = `${header}\n${rows.join("\n")}\n`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-wide-"));
  const types = Object.fromEntries(names.map((name) => [name, "ordinal"]));
  const data = ingestText(csv, { outDir, name: "wide", types });
  return { outDir, session: { id: "s_wide", data }, names };
}

test("planner: 描述统计显式打开 Shapiro 与矩阵图时仍然生效", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "对年龄和绩效做描述统计",
    analysis: "descriptives",
    variables: { variables: ["age", "perf"] },
    options: { shapiroWilkTest: true, matrixPlot: true },
  });
  assert.equal(plan.options.shapiroWilkTest, true);
  assert.equal(plan.options.matrixPlot, true);
  assert.equal(plan.warnings.some((warning) => warning.includes("可能")), false);

  const request = buildRequest(plan);
  assert.equal(request.options.shapiroWilkTest, true);
  assert.equal(request.options.matrixPlot, true);
});

test("planner: 对话明确要求正态检验或矩阵散点图时打开对应选项", () => {
  const { session } = fixture();
  const shapiroPlan = buildPlan({
    session,
    utterance: "对年龄和绩效做描述统计，并看正态性",
    analysis: "descriptives",
    variables: { variables: ["age", "perf"] },
  });
  assert.equal(shapiroPlan.options.shapiroWilkTest, true);
  assert.equal(shapiroPlan.options.matrixPlot, false);

  const plotPlan = buildPlan({
    session,
    utterance: "对年龄和绩效做描述统计，画矩阵散点图",
    analysis: "descriptives",
    variables: { variables: ["age", "perf"] },
  });
  assert.equal(plotPlan.options.shapiroWilkTest, false);
  assert.equal(plotPlan.options.matrixPlot, true);
});

test("planner: 变量达到 15 个且显式打开耗时选项时保留选择并提醒", () => {
  assert.equal(DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD, 15);
  const { session, names } = wideDescriptivesFixture(DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD);
  const plan = buildPlan({
    session,
    utterance: "对这些题项做描述统计",
    analysis: "descriptives",
    variables: { variables: names },
    options: { shapiroWilkTest: true, matrixPlot: true },
  });
  assert.equal(plan.options.shapiroWilkTest, true);
  assert.equal(plan.options.matrixPlot, true);
  assert.equal(plan.options.variables.length, 15);
  assert.ok(plan.warnings.some((warning) => warning.includes("Shapiro-Wilk") && warning.includes("15")));
  assert.ok(plan.warnings.some((warning) => warning.includes("matrixPlot") && warning.includes("15")));

  const markdown = planMarkdown(plan);
  assert.match(markdown, /Shapiro-Wilk/);
  assert.match(markdown, /matrixPlot/);

  const request = buildRequest(plan);
  assert.equal(request.options.shapiroWilkTest, true);
  assert.equal(request.options.matrixPlot, true);
  assert.deepEqual(request.options.variables, names);
});

test("planner: 变量少于 15 个时即使打开耗时选项也不提醒", () => {
  const { session, names } = wideDescriptivesFixture(DESCRIPTIVES_HEAVY_VARIABLE_THRESHOLD - 1);
  const plan = buildPlan({
    session,
    utterance: "对这些题项做描述统计",
    analysis: "descriptives",
    variables: { variables: names },
    options: { shapiroWilkTest: true, matrixPlot: true },
  });
  assert.equal(names.length, 14);
  assert.equal(plan.options.shapiroWilkTest, true);
  assert.equal(plan.options.matrixPlot, true);
  assert.equal(plan.warnings.some((warning) => warning.includes("Shapiro-Wilk") || warning.includes("matrixPlot")), false);
});

test("planner: 变量很多但未显式打开耗时选项时保持默认关闭且不提醒", () => {
  const { session, names } = wideDescriptivesFixture(20);
  const plan = buildPlan({
    session,
    utterance: "对这些题项做描述统计",
    analysis: "descriptives",
    variables: { variables: names },
  });
  assert.equal(plan.options.shapiroWilkTest, false);
  assert.equal(plan.options.matrixPlot, false);
  assert.equal(plan.warnings.some((warning) => warning.includes("Shapiro-Wilk") || warning.includes("matrixPlot")), false);

  const request = buildRequest(plan);
  assert.equal(request.options.shapiroWilkTest, false);
  assert.equal(request.options.matrixPlot, false);
});

test("planner: t 检验缺分组变量时追问", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "性别在绩效上有没有差异",
    analysis: "ttest_independent",
    variables: { dependent: ["perf"] },
  });
  assert.equal(plan.status, "needs_input");
  assert.ok(plan.questions.some((q) => q.includes("分组变量")));
});

test("planner: 补全分组变量后通过", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "性别在绩效上有没有差异",
    analysis: "ttest_independent",
    variables: { dependent: ["perf"], group: ["gender"] },
  });
  assert.equal(plan.status, "proposed");
  assert.equal(plan.jasp.analysis, "TTestIndependentSamples");
  assert.equal(plan.options.dependent, "perf");
  assert.equal(plan.options.group, "gender");
  assert.equal(plan.options.welch, true);
});

test("planner: 三水平分组应提示改用 ANOVA", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "学历差异",
    analysis: "ttest_independent",
    variables: { dependent: ["perf"], group: ["edu"] },
  });
  assert.equal(plan.status, "needs_input");
  assert.ok(plan.questions.some((q) => q.includes("ANOVA")));
});

test("planner: 配对 t 检验计划", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "前后测差异",
    analysis: "paired_ttest",
    variables: { pairs: ["age", "perf"] },
  });
  assert.equal(plan.jasp.analysis, "TTestPairedSamples");
  assert.deepEqual(plan.options.pairs, [["age", "perf"]]);
  assert.equal(plan.status, "proposed");
});

test("planner: ANCOVA 计划", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "控制年龄后比较不同学历的绩效",
    analysis: "ancova",
    variables: {
      dependent: ["perf"],
      fixedFactors: ["edu"],
      covariates: ["age"],
    },
  });
  assert.equal(plan.jasp.analysis, "Ancova");
  assert.deepEqual(plan.options.modelTerms, [
    { components: ["edu", "age"] },
  ]);
  assert.equal(plan.status, "proposed");
});

test("planner: 相关分析与 Spearman 切换", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "用 Spearman 看看年龄、绩效和满意度的相关",
    analysis: "correlation",
    variables: { variables: ["age", "perf", "sat1"] },
  });
  assert.equal(plan.jasp.analysis, "Correlation");
  assert.equal(plan.options.pearson, false);
  assert.equal(plan.options.spearman, true);
});

test("planner: 单因素 ANOVA 与 modelTerms", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "不同学历的绩效差异",
    analysis: "anova",
    variables: { dependent: ["perf"], fixedFactors: ["edu"] },
  });
  assert.equal(plan.analysis, "anova");
  assert.equal(plan.jasp.analysis, "Anova");
  assert.deepEqual(plan.options.modelTerms, [{ components: ["edu"] }]);
  assert.equal(plan.status, "proposed");
});

test("planner: 单因素 ANOVA 自动追加事后比较", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "不同学历的绩效差异",
    analysis: "anova",
    variables: { dependent: ["perf"], fixedFactors: ["edu"] },
  });
  assert.deepEqual(plan.options.postHocTerms, [{ components: ["edu"] }]);
  assert.equal(plan.options.postHocTypeStandard, true);
  assert.equal(plan.options.postHocCorrectionTukey, true);
  assert.equal(plan.options.homogeneityTests, true);
});

test("planner: 重复测量 ANOVA 识别区间变量与默认事后比较", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做重复测量方差分析，事后比较用 Holm",
  });
  assert.equal(plan.analysis, "rm_anova");
  assert.equal(plan.jasp.analysis, "AnovaRepeatedMeasures");
  assert.deepEqual(plan.variables.repeatedMeasuresCells, ["sat1", "sat2", "sat3"]);
  assert.deepEqual(plan.options.repeatedMeasuresCells, ["sat1", "sat2", "sat3"]);
  assert.deepEqual(plan.options.repeatedMeasuresFactors, [
    { name: "测量", levels: ["sat1", "sat2", "sat3"] },
  ]);
  assert.deepEqual(plan.options.withinModelTerms, [{ components: ["测量"] }]);
  assert.deepEqual(plan.options.postHocTerms, [{ components: ["测量"] }]);
  assert.equal(plan.options.postHocCorrectionHolm, true);
  assert.equal(plan.options.postHocCorrectionTukey, false);
  assert.equal(plan.status, "proposed");
});

test("planner: 重复测量列与组间因子不能重复", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "重复测量方差分析",
    analysis: "rm_anova",
    variables: {
      repeatedMeasuresCells: ["sat1", "sat2"],
      betweenSubjectFactors: ["sat1"],
    },
  });
  assert.equal(plan.status, "needs_input");
  assert.ok(plan.questions.some((q) => q.includes("不能同时")));
});

test("planner: 两因素 ANOVA 简单效应与 Helmert 对比", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "在男女各水平上比较不同学历的 perf 简单效应，用 Helmert 对比",
    variables: {
      dependent: ["perf"],
      fixedFactors: ["gender", "edu"],
      simpleEffectFactor: ["edu"],
      simpleEffectModerator: ["gender"],
    },
  });
  assert.equal(plan.status, "proposed");
  assert.equal(plan.options.simpleMainEffectFactor, "edu");
  assert.equal(plan.options.simpleMainEffectModeratorFactorOne, "gender");
  assert.deepEqual(plan.options.contrasts, [
    { variable: "gender", contrast: "Helmert" },
    { variable: "edu", contrast: "Helmert" },
  ]);
  assert.ok(plan.options.modelTerms.some((term) => term.components.length === 2));
  assert.equal(plan.options.simpleEffectSizeCiLevel, 0.95);
});

test("planner: 简单效应缺调节因子时追问", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "做学历的简单效应",
    variables: {
      dependent: ["perf"],
      fixedFactors: ["gender", "edu"],
      simpleEffectFactor: ["edu"],
    },
  });
  assert.equal(plan.status, "needs_input");
  assert.ok(plan.questions.some((q) => q.includes("同时指定")));
});

test("planner: 重复测量简单效应与重复对比", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做重复测量方差分析，按 gender 看时间简单效应，用重复对比",
    variables: {
      repeatedMeasuresCells: ["sat1", "sat2", "sat3"],
      betweenSubjectFactors: ["gender"],
    },
  });
  assert.equal(plan.analysis, "rm_anova");
  assert.equal(plan.options.simpleMainEffectFactor, "时间");
  assert.equal(plan.options.simpleMainEffectModeratorFactorOne, "gender");
  assert.deepEqual(plan.options.contrasts, [{ variable: "时间", contrast: "repeated" }]);
});

test("planner: 探索性因子分析与主成分分析", () => {
  const { session } = fixture();
  const efa = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做探索性因子分析，提取 2 个因子",
    variables: { variables: ["sat1", "sat2", "sat3"] },
  });
  assert.equal(efa.analysis, "efa");
  assert.equal(efa.jasp.analysis, "exploratoryFactorAnalysis");
  assert.equal(efa.options.manualNumberOfFactors, 2);
  assert.equal(efa.options.rotationMethod, "oblique");
  assert.equal(efa.options.factorCountMethod, "manual");
  assert.equal(efa.options.screePlot, true);
  assert.equal(efa.status, "proposed");

  const pca = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做主成分分析",
    variables: { variables: ["sat1", "sat2", "sat3"] },
  });
  assert.equal(pca.analysis, "pca");
  assert.equal(pca.jasp.analysis, "principalComponentAnalysis");
  assert.equal(pca.options.manualNumberOfComponents, 2);
  assert.equal(pca.status, "proposed");
});

test("planner: CFA 需要因子结构", () => {
  const { session } = fixture();
  const missing = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做验证性因子分析",
    variables: { variables: ["sat1", "sat2", "sat3"] },
  });
  // Only one prefix group can be suggested; CFA still requires at least two factors.
  assert.equal(missing.status, "needs_input");
  assert.ok(missing.questions.some((q) => q.includes("至少需要 2 个潜变量") || q.includes("options.factors")));
  assert.equal(missing.options.factors?.[0]?.name, "sat");

  const planned = buildPlan({
    session,
    utterance: "对 sat1 到 sat3 做验证性因子分析",
    variables: { variables: ["sat1", "sat2", "sat3"] },
    options: {
      factors: [
        { name: "F1", title: "因子 1", indicators: ["sat1", "sat2"] },
        { name: "F2", title: "因子 2", indicators: ["sat3"] },
      ],
    },
  });
  assert.equal(planned.status, "needs_input");
  assert.ok(planned.questions.some((q) => q.includes("指标")));
});

test("planner: SEM 需要 lavaan 语法并自动转换", () => {
  const { session } = fixture();
  const suggested = buildPlan({ session, utterance: "用 lavaan 拟合结构方程模型" });
  assert.equal(suggested.status, "proposed");
  assert.ok(suggested.suggestions?.pending);
  assert.match(suggested.options.models[0].syntax.model, /sat =~ sat1 \+ sat2 \+ sat3/);

  const planned = buildPlan({
    session,
    utterance: "用 lavaan 拟合结构方程模型",
    options: { models: [{ name: "Model 1", syntax: "F1 =~ sat1 + sat2 + sat3" }] },
  });
  assert.equal(planned.analysis, "sem");
  assert.equal(planned.jasp.analysis, "SEM");
  assert.equal(planned.options.models[0].syntax.model, "F1 =~ sat1 + sat2 + sat3");
  assert.equal(planned.status, "proposed");
});

test("planner: 线性混合模型的角色映射", () => {
  const { session } = mixedFixture();
  const plan = buildPlan({
    session,
    utterance: "以 score 为因变量，把 wave 和 condition 作为固定效应，按 subject 做随机截距",
    variables: {
      dependent: ["score"],
      fixedEffects: ["wave", "condition"],
      randomFactors: ["subject"],
    },
  });
  assert.equal(plan.analysis, "mixed_lmm");
  assert.equal(plan.jasp.analysis, "MixedModelsLMM");
  assert.deepEqual(plan.options.fixedEffects, [
    { components: ["wave"] },
    { components: ["condition"] },
  ]);
  assert.equal(plan.options.randomEffects[0].value, "subject");
  assert.equal(plan.options.randomEffects[0].randomComponents[0].value[0], "Intercept");
  assert.equal(plan.options.dependent, "score");
  assert.equal(plan.status, "proposed");
});

test("planner: 广义线性混合模型与 PLS-SEM", () => {
  const { session } = mixedFixture();
  const glmm = buildPlan({
    session,
    utterance: "二项广义线性混合模型，以 score 为因变量，固定效应 wave，随机分组 subject",
    variables: {
      dependent: ["score"],
      fixedEffects: ["wave"],
      randomFactors: ["subject"],
    },
  });
  assert.equal(glmm.analysis, "mixed_glmm");
  assert.equal(glmm.jasp.analysis, "MixedModelsGLMM");
  assert.equal(glmm.options.family, "bernoulli");
  assert.equal(glmm.options.link, "logit");
  assert.equal(glmm.options.randomEffects[0].value, "subject");
  assert.equal(glmm.status, "proposed");

  const { session: factorSession } = fixture();
  const pls = buildPlan({
    session: factorSession,
    utterance: "用 PLS-SEM 拟合模型",
    options: { models: [{ name: "Model", syntax: "F1 -> sat1 + sat2 + sat3" }] },
  });
  assert.equal(pls.analysis, "plssem");
  assert.equal(pls.jasp.analysis, "PLSSEM");
  assert.equal(pls.options.models[0].syntax.model, "F1 -> sat1 + sat2 + sat3");
  assert.equal(pls.options.bootstrapSamples, 1000);
  assert.equal(pls.status, "proposed");
});

test("planner: Process Model 4 简单中介", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "age 通过 sat1 影响 perf 的中介效应，用 bootstrap",
    variables: { dependent: ["perf"], independent: ["age"], mediators: ["sat1"] },
  });
  assert.equal(plan.analysis, "process");
  assert.equal(plan.jasp.analysis, "ClassicProcess");
  assert.equal(plan.options.processModels[0].modelNumber, 4);
  assert.equal(plan.options.processModels[0].modelNumberIndependent, "age");
  assert.deepEqual(plan.options.processModels[0].modelNumberMediators, ["sat1"]);
  assert.deepEqual(plan.options.processModels[0].processRelationships, []);
  assert.equal(plan.options.errorCalculationMethod, "bootstrap");
  assert.equal(plan.options.bootstrapSamples, 1000);
  assert.ok(plan.options.covariates.includes("age"));
  assert.ok(plan.options.covariates.includes("sat1"));
  assert.equal(plan.status, "proposed");
});

test("planner: Process Model 1 调节由调节变量推断", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "age 对 perf 的调节作用，调节变量是 sat1",
    variables: { dependent: ["perf"], independent: ["age"], moderatorW: ["sat1"] },
  });
  assert.equal(plan.analysis, "process");
  assert.equal(plan.options.processModels[0].modelNumber, 1);
  assert.equal(plan.options.processModels[0].modelNumberModeratorW, "sat1");
  assert.equal(plan.options.errorCalculationMethod, "standard");
  assert.equal(plan.options.moderationProbes.length, 3);
  assert.equal(plan.status, "proposed");
});

test("planner: Process 链式中介与不支持模型", () => {
  const { session } = fixture();
  const serial = buildPlan({
    session,
    utterance: "模型 6 链式中介",
    variables: {
      dependent: ["perf"],
      independent: ["age"],
      mediators: ["sat1", "sat2"],
    },
  });
  assert.equal(serial.options.processModels[0].modelNumber, 6);
  assert.deepEqual(serial.options.processModels[0].modelNumberMediators, ["sat1", "sat2"]);

  const unsupported = buildPlan({
    session,
    utterance: "模型 5 中介",
    variables: {
      dependent: ["perf"],
      independent: ["age"],
      mediators: ["sat1"],
    },
  });
  assert.equal(unsupported.status, "needs_input");
  assert.ok(unsupported.questions.some((q) => q.includes("暂不支持 Model 5")));
});

test("planner: 有调节的中介（Model 7）与 FIML", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "检验 sat2 是否调节 age 到 sat1 的路径，再看 sat1 对 perf 的中介，缺失值用 FIML",
    variables: {
      dependent: ["perf"],
      independent: ["age"],
      mediators: ["sat1"],
      moderatorW: ["sat2"],
    },
  });
  assert.equal(plan.analysis, "process");
  assert.equal(plan.options.processModels[0].modelNumber, 7);
  assert.equal(plan.options.processModels[0].modelNumberModeratorW, "sat2");
  assert.equal(plan.options.moderatedMediationIndex, true);
  assert.equal(plan.options.naAction, "fiml");
  assert.ok(plan.options.covariates.includes("sat2"));
  assert.equal(plan.status, "proposed");
});

test("planner: 三因素 ANOVA 的双调节因子简单效应", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "在性别和学历各水平上比较题项的简单效应",
    variables: {
      dependent: ["perf"],
      fixedFactors: ["gender", "edu", "sat1"],
      simpleEffectFactor: ["sat1"],
      simpleEffectModerator: ["gender"],
      simpleEffectModeratorTwo: ["edu"],
    },
  });
  assert.equal(plan.options.simpleMainEffectFactor, "sat1");
  assert.equal(plan.options.simpleMainEffectModeratorFactorOne, "gender");
  assert.equal(plan.options.simpleMainEffectModeratorFactorTwo, "edu");
  assert.ok(
    plan.options.modelTerms.some(
      (term) => term.components.length === 3 && term.components.includes("edu")
    )
  );
  assert.equal(plan.status, "proposed");
});

test("planner: 重复测量简单效应的反向（组间因子在各时间点）", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "各时间点上的性别差异，做重复测量方差分析的简单效应",
    variables: {
      repeatedMeasuresCells: ["sat1", "sat2", "sat3"],
      betweenSubjectFactors: ["gender"],
    },
  });
  assert.equal(plan.options.simpleMainEffectFactor, "gender");
  assert.equal(plan.options.simpleMainEffectModeratorFactorOne, "时间");
});

test("planner: 修改计划递增 revision 并保留 id", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "回归",
    analysis: "regression",
    variables: { dependent: ["perf"], covariates: ["age"] },
  });
  const next = patchPlan({
    session,
    plan,
    patch: { variables: { covariates: ["age", "sat1"] } },
  });
  assert.equal(next.id, plan.id);
  assert.equal(next.revision, 2);
  assert.deepEqual(next.variables.covariates, ["age", "sat1"]);
});

test("planner: 未知变量给出可读问题", () => {
  const { session } = fixture();
  const plan = buildPlan({
    session,
    utterance: "描述统计",
    analysis: "descriptives",
    variables: { variables: ["不存在"] },
  });
  assert.equal(plan.status, "needs_input");
  assert.ok(plan.questions.some((q) => q.includes("不在当前数据集")));
});

test("planner: 贝叶斯 Process 与贝叶斯线性混合模型", () => {
  const { session } = fixture();
  const processPlan = buildPlan({
    session,
    utterance: "贝叶斯中介：age 通过 sat1 影响 perf",
    variables: { dependent: ["perf"], independent: ["age"], mediators: ["sat1"] },
  });
  assert.equal(processPlan.analysis, "process_bayesian");
  assert.equal(processPlan.jasp.analysis, "BayesianProcess");
  assert.equal(processPlan.options.processModels[0].modelNumber, 4);
  assert.equal(processPlan.options.processModels[0].modelNumberIndependent, "age");
  assert.equal(processPlan.options.mcmcBurnin, 500);
  assert.equal(processPlan.options.mcmcSamples, 1000);
  assert.equal(processPlan.options.mcmcChains, 3);
  assert.equal(processPlan.options.betaPriorMu, "0");
  assert.equal(processPlan.options.betaPriorSigma, "10");
  assert.equal(processPlan.status, "proposed");

  const frequentist = buildPlan({
    session,
    utterance: "age 通过 sat1 影响 perf 的中介效应，用 bootstrap",
    variables: { dependent: ["perf"], independent: ["age"], mediators: ["sat1"] },
  });
  assert.equal(frequentist.analysis, "process");
  assert.equal(frequentist.jasp.analysis, "ClassicProcess");

  const { session: mixedSession } = mixedFixture();
  const blmm = buildPlan({
    session: mixedSession,
    utterance: "贝叶斯线性混合模型，以 score 为因变量，把 wave 和 condition 作为固定效应，按 subject 做随机截距",
    variables: {
      dependent: ["score"],
      fixedEffects: ["wave", "condition"],
      randomFactors: ["subject"],
    },
  });
  assert.equal(blmm.analysis, "mixed_blmm");
  assert.equal(blmm.jasp.analysis, "MixedModelsBLMM");
  assert.deepEqual(blmm.options.fixedEffects, [
    { components: ["wave"] },
    { components: ["condition"] },
  ]);
  assert.equal(blmm.options.randomEffects[0].value, "subject");
  assert.equal(blmm.options.mcmcChains, 3);
  assert.equal(blmm.status, "proposed");
});

test("planner: MIMIC 与潜变量增长曲线", () => {
  const { session } = fixture();
  const mimicPlan = buildPlan({
    session,
    utterance: "做 MIMIC 模型，用 sat1 到 sat3 作为指标，age 作为预测变量",
    variables: { indicators: ["sat1", "sat2", "sat3"], predictors: ["age"] },
  });
  assert.equal(mimicPlan.analysis, "mimic");
  assert.equal(mimicPlan.jasp.analysis, "MIMIC");
  assert.deepEqual(mimicPlan.options.indicators, ["sat1", "sat2", "sat3"]);
  assert.deepEqual(mimicPlan.options.predictors, ["age"]);
  assert.equal(mimicPlan.options.additionalFitMeasures, true);
  assert.equal(mimicPlan.status, "proposed");

  const badPredictor = buildPlan({
    session,
    utterance: "MIMIC 模型",
    variables: { indicators: ["sat1", "sat2", "sat3"], predictors: ["edu"] },
  });
  assert.equal(badPredictor.status, "needs_input");
  assert.ok(badPredictor.questions.some((q) => q.includes("edu") && q.includes("水平")));

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-lgc-"));
  const lgcCsv = `id,t1,t2,t3,t4,group
1,2.1,2.4,2.8,3.1,A
2,1.8,2.0,2.3,2.9,B
3,2.5,2.7,3.0,3.4,A
4,1.5,1.9,2.2,2.6,B
5,2.0,2.6,3.1,3.5,A
6,1.7,2.1,2.4,2.8,B
`;
  const lgcData = ingestText(lgcCsv, {
    outDir,
    name: "lgc",
    types: { t1: "scale", t2: "scale", t3: "scale", t4: "scale" },
  });
  const lgcSession = { id: "s_lgc", data: lgcData };
  const lgc = buildPlan({
    session: lgcSession,
    utterance: "拟合潜变量增长曲线，变量是 t1 到 t4",
    variables: { variables: ["t1", "t2", "t3", "t4"] },
  });
  assert.equal(lgc.analysis, "latent_growth");
  assert.equal(lgc.jasp.analysis, "LatentGrowthCurve");
  assert.deepEqual(lgc.options.variables, ["t1", "t2", "t3", "t4"]);
  assert.deepEqual(
    lgc.options.timings.map((row) => [row.variable, row.timing]),
    [
      ["t1", 0],
      ["t2", 1],
      ["t3", 2],
      ["t4", 3],
    ]
  );
  assert.equal(lgc.options.intercept, true);
  assert.equal(lgc.options.linear, true);
  assert.equal(lgc.options.quadratic, false);
  assert.equal(lgc.status, "proposed");
});

test("planner: 贝叶斯广义线性混合模型", () => {
  const { session } = mixedFixture();
  const bglmm = buildPlan({
    session,
    utterance: "贝叶斯广义线性混合模型，二项，以 score 为因变量，固定效应 wave，随机分组 subject",
    variables: {
      dependent: ["score"],
      fixedEffects: ["wave"],
      randomFactors: ["subject"],
    },
  });
  assert.equal(bglmm.analysis, "mixed_bglmm");
  assert.equal(bglmm.jasp.analysis, "MixedModelsBGLMM");
  assert.equal(bglmm.options.family, "bernoulli");
  assert.equal(bglmm.options.link, "logit");
  assert.equal(bglmm.options.randomEffects[0].value, "subject");
  assert.equal(bglmm.options.mcmcChains, 3);
  assert.equal(bglmm.status, "proposed");

  const stillBlmm = buildPlan({
    session,
    utterance: "贝叶斯线性混合模型，以 score 为因变量，固定效应 wave，随机分组 subject",
    variables: {
      dependent: ["score"],
      fixedEffects: ["wave"],
      randomFactors: ["subject"],
    },
  });
  assert.equal(stillBlmm.analysis, "mixed_blmm");
  assert.equal(stillBlmm.jasp.analysis, "MixedModelsBLMM");
});
