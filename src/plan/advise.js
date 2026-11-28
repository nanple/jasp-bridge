/**
 * 方法顾问：用已加载的表格核实用户原话里的因变量、设计和人口学变量，
 * 再推荐现有 22 类方法里真正能跑的、可确认的分析计划。
 *
 * 宿主大模型负责听懂自然语言。本模块不是第二套完整的关键词 NLP，
 * 只做保守的设计同义词、列名/标签/别名匹配，以及和数据对不上时的提醒。
 */

import { looksLikeId } from "../data/ingest.js";
import {
  groupByPrefix,
  isCompositeName,
  looksLikeDemographic,
  suggestScaleMembership,
} from "./suggest.js";

const WITHIN_RE = /组内|被试内|重复测量|within[-\s]?subjects?/i;
const BETWEEN_RE = /组间|被试间|between[-\s]?subjects?/i;
const MIXED_RE = /混合设计|mixed\s*design/i;
const MATERIALS_RE = /素材|材料|刺激材料|刺激|stimuli|stimulus/i;

const ALIAS_GROUPS = [
  {
    key: "rt",
    role: "dependent",
    terms: ["反应时", "反应时间", "reaction time", "reaction_time", "reactiontime", "response time", "response_time"],
    tokens: ["rt", "rtime", "rtimes", "reactiontime", "reaction_time", "responsetime", "responsetimes"],
  },
  {
    key: "acc",
    role: "dependent",
    terms: ["正确率", "准确率", "正确比", "accuracy"],
    tokens: ["acc", "accuracy", "accur", "correctrate", "pctcorrect", "pct_correct", "accuracyrate"],
  },
  {
    key: "error",
    role: "dependent",
    terms: ["错误率", "误差率", "error rate", "error_rate"],
    tokens: ["err", "error", "errorrate"],
  },
  {
    key: "perf",
    role: "dependent",
    terms: ["绩效", "表现", "performance"],
    tokens: ["perf", "performance"],
  },
  {
    key: "score",
    role: "dependent",
    terms: ["得分", "分数", "成绩"],
    tokens: ["score", "scores"],
  },
  {
    key: "gender",
    role: "demographic",
    terms: ["性别"],
    tokens: ["gender", "sex"],
  },
  {
    key: "age",
    role: "demographic",
    terms: ["年龄"],
    tokens: ["age", "ages"],
  },
  {
    key: "education",
    role: "demographic",
    terms: ["学历", "教育程度", "文化程度"],
    tokens: ["education", "edu", "educ", "edulevel", "edu_level"],
  },
  {
    key: "income",
    role: "demographic",
    terms: ["收入"],
    tokens: ["income"],
  },
  {
    key: "grade",
    role: "demographic",
    terms: ["年级"],
    tokens: ["grade", "grades"],
  },
];

const MEASURE_TOKENS = new Set(
  ALIAS_GROUPS.filter((group) => group.role === "dependent").flatMap((group) =>
    group.tokens.map((token) => token.toLowerCase())
  )
);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textHasTerm(text, term) {
  const raw = String(term || "").trim();
  if (!raw) return false;
  if (/[\u4e00-\u9fff]/.test(raw)) return String(text || "").includes(raw);
  if (/[\s_]/.test(raw)) return String(text || "").toLowerCase().includes(raw.toLowerCase());
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(raw)}(?:[^A-Za-z0-9_]|$)`, "i").test(
    String(text || "")
  );
}

function tokenize(value) {
  const raw = String(value || "");
  const tokens = new Set();
  if (raw) tokens.add(raw.toLowerCase());
  for (const part of raw.split(/[^A-Za-z0-9\u4e00-\u9fff]+/)) {
    if (!part) continue;
    tokens.add(part.toLowerCase());
    const camel = part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    for (const piece of camel) if (piece) tokens.add(piece.toLowerCase());
    const numbered = /^([A-Za-z]+)(\d+)$/.exec(part);
    if (numbered) tokens.add(numbered[1].toLowerCase());
  }
  return [...tokens];
}

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function variableByName(session, name) {
  return (session?.data?.variables || []).find(
    (variable) => String(variable.name).toLowerCase() === String(name).toLowerCase()
  );
}

function columnOrder(session, names) {
  const order = new Map((session?.data?.variables || []).map((variable, index) => [variable.name, index]));
  return [...names].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function levelCount(variable) {
  if (!variable) return 0;
  if (Array.isArray(variable.levels)) return variable.levels.length;
  if (typeof variable.unique === "number") return variable.unique;
  return 0;
}

export function detectDesign(utterance) {
  const text = String(utterance || "");
  const within = WITHIN_RE.test(text);
  const between = BETWEEN_RE.test(text);
  if (MIXED_RE.test(text) || (within && between)) return "mixed";
  if (within) return "within";
  if (between) return "between";
  return null;
}

export function wantsDemographicComparisons(utterance) {
  const text = String(utterance || "");
  if (/人口学|人口统计学|demographics?/i.test(text)) return true;
  if (/(考察|探究|比较|分析|检验|看看?).{0,24}(性别|年龄|学历|教育|人口)/.test(text)) return true;
  if (/(性别|年龄|学历|教育).{0,16}(差异|影响|作用|效应)/.test(text)) return true;
  if (/(gender|age|education).{0,16}(difference|effect|compar)/i.test(text)) return true;
  return false;
}

function columnMatchesGroup(variable, group) {
  const name = String(variable?.name || "");
  const label = String(variable?.label || "");
  for (const haystack of [name, label].filter(Boolean)) {
    for (const term of group.terms) {
      if (/[\u4e00-\u9fff]/.test(term)) {
        if (haystack.includes(term)) return true;
      } else if (textHasTerm(haystack, term)) {
        return true;
      }
    }
  }
  const tokens = new Set([...tokenize(name), ...(label && label !== name ? tokenize(label) : [])]);
  return group.tokens.some((token) => tokens.has(token.toLowerCase()));
}

function findExactMentions(text, variables) {
  const found = [];
  const lower = String(text || "").toLowerCase();
  for (const variable of variables) {
    const name = String(variable.name || "");
    if (name.length >= 2 && lower.includes(name.toLowerCase())) found.push(variable.name);
    const label = String(variable.label || "");
    if (label && label !== name && label.length >= 2 && lower.includes(label.toLowerCase())) {
      found.push(variable.name);
    }
  }
  return uniqueNames(found);
}

function findRangeMentions(text, variables) {
  const found = [];
  const rangePattern =
    /([a-z_][a-z0-9_]*?)(\d+)\s*(?:-|–|—|~|到|至)\s*([a-z_][a-z0-9_]*?)(\d+)/gi;
  let match;
  while ((match = rangePattern.exec(String(text || "")))) {
    const [, prefixA, startText, prefixB, endText] = match;
    if (prefixA.toLowerCase() !== prefixB.toLowerCase()) continue;
    const start = Number(startText);
    const end = Number(endText);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    for (const variable of variables) {
      const parts = /^([a-z_][a-z0-9_]*?)(\d+)$/i.exec(variable.name);
      if (!parts) continue;
      if (parts[1].toLowerCase() !== prefixA.toLowerCase()) continue;
      const index = Number(parts[2]);
      if (index >= start && index <= end) found.push(variable.name);
    }
  }
  return uniqueNames(found);
}

function measureFamiliesFrom(variables, session) {
  const { scales } = groupByPrefix(variables);
  const used = new Set();
  const families = [];
  for (const scale of scales) {
    families.push({
      key: scale.prefix,
      items: columnOrder(session, scale.items),
      kind: "prefix",
    });
    scale.items.forEach((name) => used.add(name));
  }

  const rest = variables.filter((variable) => !used.has(variable.name));
  const byToken = new Map();
  for (const variable of rest) {
    const tokens = tokenize(variable.name);
    const measure = [...MEASURE_TOKENS].find((token) => tokens.includes(token));
    if (!measure) continue;
    if (!byToken.has(measure)) byToken.set(measure, []);
    byToken.get(measure).push(variable.name);
  }
  for (const [token, names] of byToken.entries()) {
    if (names.length < 2) continue;
    families.push({ key: token, items: columnOrder(session, names), kind: "measure" });
    names.forEach((name) => used.add(name));
  }

  for (const variable of variables) {
    if (used.has(variable.name)) continue;
    families.push({ key: variable.name, items: [variable.name], kind: "single" });
  }
  return families;
}


function isConditionPrefix(prefix) {
  return /^(time|wave|session|block|cond|condition|trial|t|w|pre|post|prepost|时点|时间|条件|试次)$/i.test(
    String(prefix || "")
  );
}

function isRepeatedMeasureFamily(family) {
  if (!family || !Array.isArray(family.items) || family.items.length < 2) return false;
  if (family.kind === "prefix") return isConditionPrefix(family.key);
  return family.kind !== "prefix";
}

function leftoverFactorTokens(name) {
  return tokenize(name).filter((token) => !MEASURE_TOKENS.has(token) && !/^\d+$/.test(token) && token !== String(name).toLowerCase());
}

export function detectMultiFactorWithin(names) {
  const list = uniqueNames(names || []);
  if (list.length < 4) return null;
  const rows = list.map((name) => leftoverFactorTokens(name)).filter((tokens) => tokens.length >= 2);
  if (rows.length !== list.length) return null;
  const dim1 = new Set(rows.map((tokens) => tokens[0]));
  const dim2 = new Set(rows.map((tokens) => tokens[1]));
  if (dim1.size >= 2 && dim2.size >= 2 && dim1.size * dim2.size === list.length) {
    return { factors: [dim1.size, dim2.size], names: list };
  }
  return null;
}

export function inspectDataShape(session) {
  const variables = session?.data?.variables || [];
  const n = session?.data?.n || 0;
  const idLike = variables.filter((variable) => looksLikeId(variable.name));
  const repeated = variables.filter((variable) => {
    const unique = levelCount(variable);
    return unique >= 2 && n > 0 && unique < n && n / unique >= 1.5;
  });
  const subject =
    idLike[0] ||
    repeated.find((variable) => /subject|participant|被试|编号|id/i.test(variable.name)) ||
    (repeated.length === 1 ? repeated[0] : null);

  const conditionCols = variables.filter((variable) => {
    const name = String(variable.name || "");
    const label = String(variable.label || "");
    return /^(condition|cond|trial|time|wave|session|block|条件|情境|处理|时点|时间|试次)$/i.test(name) ||
      /条件|情境|处理|时点/.test(label);
  });

  const measureVars = variables.filter(
    (variable) =>
      ["scale", "ordinal"].includes(variable.type) &&
      !looksLikeId(variable.name) &&
      !looksLikeDemographic(variable) &&
      !isCompositeName(variable.name)
  );
  const families = measureFamiliesFrom(measureVars, session);
  const longRepeats = subject && n > 0 && levelCount(subject) < n && n / Math.max(1, levelCount(subject)) >= 1.5;
  const format = longRepeats && (conditionCols.length > 0 || families.every((family) => family.items.length === 1))
    ? "long"
    : "wide";

  let looksLike = "unclear";
  if (format === "long") {
    looksLike = "within";
  } else if (families.some((family) => family.items.length >= 2)) {
    looksLike = "within";
  } else {
    const grouping = variables.filter((variable) => isUsefulGrouping(variable, n));
    if (measureVars.length >= 1 && grouping.length >= 1) looksLike = "between";
  }

  return {
    format,
    looksLike,
    subject: subject?.name || null,
    conditionCols: conditionCols.map((variable) => variable.name),
    families,
    n,
  };
}

export function matchSlots({ utterance, session } = {}) {
  const text = String(utterance || "");
  const variables = session?.data?.variables || [];
  const questions = [];
  const unmatched = [];
  const dependents = [];
  const demographics = [];
  const exact = findExactMentions(text, variables);
  const ranged = findRangeMentions(text, variables);
  const families = measureFamiliesFrom(
    variables.filter(
      (variable) =>
        ["scale", "ordinal"].includes(variable.type) &&
        !looksLikeId(variable.name) &&
        !looksLikeDemographic(variable)
    ),
    session
  );

  const assign = (entry) => {
    if (entry.role === "demographic") demographics.push(entry);
    else dependents.push(entry);
  };

  const mentionedKeys = new Set();
  for (const group of ALIAS_GROUPS) {
    const mentioned =
      group.terms.some((term) => textHasTerm(text, term)) ||
      group.tokens.some((token) => textHasTerm(text, token));
    if (!mentioned) continue;
    mentionedKeys.add(group.key);
    const matches = uniqueNames(
      variables.filter((variable) => columnMatchesGroup(variable, group)).map((variable) => variable.name)
    );
    const term = group.terms[0];
    if (matches.length === 0) {
      unmatched.push({ term, key: group.key, role: group.role });
      continue;
    }
    if (matches.length === 1) {
      assign({ term, key: group.key, role: group.role, columns: matches, status: "unique" });
      continue;
    }
    const family = families.find(
      (item) => item.items.length === matches.length && matches.every((name) => item.items.includes(name))
    );
    if (family && group.role === "dependent") {
      assign({
        term,
        key: group.key,
        role: group.role,
        columns: family.items,
        status: "family",
      });
      continue;
    }
    questions.push(`「${term}」能对应到 ${matches.join("、")}，请说明要用哪一列，不要默认替你选定。`);
    assign({ term, key: group.key, role: group.role, columns: matches, status: "ambiguous" });
  }

  if (/人口学|人口统计学|demographics?/i.test(text)) {
    for (const variable of variables.filter((item) => looksLikeDemographic(item))) {
      if (demographics.some((entry) => entry.columns.includes(variable.name))) continue;
      demographics.push({
        term: variable.label && variable.label !== variable.name ? variable.label : variable.name,
        key: "demographic",
        role: "demographic",
        columns: [variable.name],
        status: "suggested",
      });
    }
  }

  const materialsNoted = MATERIALS_RE.test(text);

  return {
    dependents,
    demographics,
    exact,
    ranged,
    unmatched,
    questions,
    materialsNoted,
  };
}

function groundedColumns(entries) {
  return uniqueNames(
    (entries || [])
      .filter((entry) => entry.status === "unique" || entry.status === "family" || entry.status === "suggested")
      .flatMap((entry) => entry.columns)
  );
}

export function listSafeMentionedColumns(utterance, session) {
  const slots = matchSlots({ utterance, session });
  return uniqueNames([
    ...slots.exact,
    ...slots.ranged,
    ...groundedColumns(slots.dependents),
    ...groundedColumns(slots.demographics.filter((entry) => entry.status !== "suggested")),
  ]);
}

function nominalDemographics(session, names) {
  return names.filter((name) => {
    const variable = variableByName(session, name);
    return variable && variable.type === "nominal" && levelCount(variable) >= 2;
  });
}

function scaleLike(session, names) {
  return names.filter((name) => {
    const variable = variableByName(session, name);
    return variable && ["scale", "ordinal"].includes(variable.type);
  });
}

function familyForColumns(columns, session) {
  const vars = (session?.data?.variables || []).filter((variable) => columns.includes(variable.name));
  const families = measureFamiliesFrom(vars, session);
  if (families.length === 1) return families[0];
  return { key: columns[0], items: columnOrder(session, columns), kind: "group" };
}

function observedShapeText(observed, format) {
  if (observed === "within" && format === "long") return "长格式的组内数据（同一被试多行）";
  if (observed === "within") return "宽格式的组内数据（同一被试一行，条件分列）";
  if (observed === "between") return "组间数据（每个条件或分组各是不同的人）";
  return "还不能从表格明确判断是组内还是组间";
}

function describeDesign(claimed, observed, format) {
  const labels = { within: "组内", between: "组间", mixed: "混合", unclear: "尚不明确" };
  const observedText = observedShapeText(observed, format);
  if (!claimed) {
    if (observed === "unclear") {
      return "你还没有说明实验设计，表格也还不能明确判断是组内还是组间。下面先给出描述统计；请再确认设计（组内或组间）以及因变量是哪些。";
    }
    return `你还没有说明实验设计。表格看起来像${observedText}。这只是根据列结构的判断，请确认后再选方法。`;
  }
  const claimedText = labels[claimed] || claimed;
  return `你提到的设计是${claimedText}；对照表格，看起来更像${observedText}。`;
}

function whyFor(spec, { tentative = false } = {}) {
  if (spec.analysis === "descriptives") {
    return tentative
      ? "你还没有指定方法。先根据表格里的测量列做描述统计，了解分布和样本量，再确认后面的分析方法。"
      : "先看因变量（以及已识别的人口学变量）的分布和样本量，再做推断统计。";
  }
  if (spec.analysis === "rm_anova") {
    const n = (spec.variables.repeatedMeasuresCells || []).length;
    if (tentative) {
      return n === 2
        ? "表格看起来像同一被试在两个条件下的测量，可以考虑用重复测量方差分析比较这些列；两个水平时也可以用配对 t 检验。请先确认这确实是组内设计。"
        : "表格看起来像同一被试在多个条件下的测量，可以考虑用重复测量方差分析比较这些列。请先确认这确实是组内设计。";
    }
    return n === 2
      ? "这是组内设计，同一被试在不同条件下重复测量；两个水平时可用重复测量方差分析比较条件差异。"
      : "这是组内设计，同一被试在多个条件下重复测量，适合用重复测量方差分析比较条件差异。";
  }
  if (spec.analysis === "paired_ttest") {
    return tentative
      ? "表格看起来只有两个条件列，如果确认是组内设计，也可以用配对 t 检验直接比较这两列。"
      : "组内设计且只有两个水平时，配对 t 检验可以直接比较这两列。";
  }
  if (spec.analysis === "ttest_independent") {
    return tentative
      ? "表格看起来像不同的人分在两个组，可以考虑用独立样本 t 检验做组间比较。请先确认这是组间设计，以及要用哪一列做因变量、哪一列分组。"
      : "这是组间、两水平的比较，独立样本 t 检验适用于不同的人分在两个组。";
  }
  if (spec.analysis === "anova") {
    return tentative
      ? "表格看起来像不同的人分在两个以上的组，可以考虑用方差分析做组间比较。请先确认这是组间设计，以及要用哪一列做因变量、哪一列分组。"
      : "组间因子有两个以上水平时，用方差分析比较各组均值。";
  }
  if (spec.analysis === "mixed_lmm") {
    return tentative
      ? "表格看起来是长格式（同一被试多行）。当前重复测量方差分析需要宽格式，不能直接按长格式去跑；如果确认是组内设计，可以考虑用线性混合模型，或先把数据整理成每个条件一列（插件不会自动改数据）。"
      : "数据是长格式的组内测量（同一被试多行）。当前重复测量方差分析需要宽格式，线性混合模型可以直接在长格式上估计条件差异。";
  }
  return "";
}

function alternativesFor(spec) {
  const items = [];
  if (spec.analysis === "rm_anova") {
    const n = (spec.variables.repeatedMeasuresCells || []).length;
    if (n === 2 && !(spec.variables.betweenSubjectFactors || []).length) {
      items.push("只有两个水平时，也可以用配对 t 检验，结果通常一致。");
    }
    items.push("不要用独立样本 t 检验：那是组间方法，会把同一被试的多次测量当成不同的人。");
  }
  if (spec.analysis === "paired_ttest") {
    items.push("也可以用重复测量方差分析，两个水平时与配对 t 通常一致。");
    items.push("不要用独立样本 t 检验：那是组间方法，不适合组内设计。");
  }
  if (spec.analysis === "mixed_lmm") {
    items.push("如果先把数据整理成宽格式（每个条件一列），也可以用重复测量方差分析。");
  }
  return uniqueNames(items);
}



function slotPhrase(entry) {
  const columns = (entry.columns || []).join("、");
  if (entry.term && !entry.columns.includes(entry.term)) return `「${entry.term}」→ ${columns}`;
  return columns;
}

function summarizeSlots(slots) {
  const parts = [];
  const dvs = (slots.dependents || []).filter((entry) => entry.status === "unique" || entry.status === "family");
  if (dvs.length) parts.push(`因变量：${dvs.map(slotPhrase).join("；")}`);
  const demos = (slots.demographics || []).filter((entry) => entry.status !== "ambiguous");
  if (demos.length) parts.push(`人口学变量：${demos.map(slotPhrase).join("；")}`);
  return parts.join("。");
}

function tableMeasureColumns(session) {
  return (session?.data?.variables || [])
    .filter(
      (variable) =>
        ["scale", "ordinal"].includes(variable.type) && !looksLikeId(variable.name)
    )
    .map((variable) => variable.name);
}

function tableDemographicColumns(session) {
  return (session?.data?.variables || [])
    .filter((variable) => looksLikeDemographic(variable) && !looksLikeId(variable.name))
    .map((variable) => variable.name);
}

function scaleItemNames(session) {
  return new Set(
    suggestScaleMembership(session)
      .filter((item) => Array.isArray(item.items) && item.items.length >= 2 && !item.tentativeReverse)
      .flatMap((item) => item.items)
  );
}

function standaloneMeasureColumns(session) {
  const items = scaleItemNames(session);
  return tableMeasureColumns(session).filter((name) => {
    if (items.has(name)) return false;
    return true;
  });
}

function isUsefulGrouping(variable, n) {
  if (!variable || variable.type !== "nominal") return false;
  if (looksLikeId(variable.name)) return false;
  const levels = levelCount(variable);
  if (levels < 2) return false;
  const size = Number(n) || 0;
  if (size > 0 && (levels >= size || size / levels < 1.5)) return false;
  return true;
}

function tableGroupingColumns(session) {
  const n = session?.data?.n || 0;
  return (session?.data?.variables || [])
    .filter((variable) => isUsefulGrouping(variable, n))
    .map((variable) => variable.name);
}

function betweenDependentColumns(session) {
  const preferred = standaloneMeasureColumns(session).filter((name) => {
    const variable = variableByName(session, name);
    return variable && !looksLikeDemographic(variable);
  });
  if (preferred.length > 0) return preferred;
  return standaloneMeasureColumns(session);
}

export function buildAdvice({ session, utterance = "", analysis, variables } = {}) {

  const claimed = detectDesign(utterance);
  const shape = inspectDataShape(session);
  const slots = matchSlots({ utterance, session });
  const questions = [...slots.questions];
  const warnings = [];
  const examineDemographics = wantsDemographicComparisons(utterance);
  const scales = suggestScaleMembership(session).filter((item) => !item.tentativeReverse || item.items?.length);
  const scaleNotes = scales.map((item) => item.note);

  if (slots.materialsNoted) {
    warnings.push("提到的实验素材或刺激通常不是数据列，不会当作变量。");
  }

  for (const miss of slots.unmatched) {
    if (miss.role === "demographic") {
      warnings.push(`你提到了「${miss.term}」，但当前表里没有能对应到它的列。`);
    } else {
      warnings.push(`你提到了「${miss.term}」，但当前表里没有能唯一对应到它的列。`);
    }
  }

  const mismatch =
    (claimed === "within" && shape.looksLike === "between") ||
    (claimed === "between" && shape.looksLike === "within") ||
    (claimed === "mixed" && shape.looksLike === "between" && shape.format !== "long");

  if (claimed === "within" && shape.looksLike === "between") {
    warnings.push(
      "你提到这是组内设计，但表格更像组间数据：每个被试一行，因变量各只有一列，没有看到对应的条件/水平列。当前无法按重复测量来比较不同条件。"
    );
  } else if (claimed === "between" && shape.looksLike === "within") {
    warnings.push(
      "你提到这是组间设计，但表格看起来更像组内数据（同一被试有多个条件列，或同一被试占多行）。请核对设计后再选方法。"
    );
  }

  const safeDependents = slots.dependents.filter((entry) => entry.status === "unique" || entry.status === "family");
  const safeDemos = slots.demographics.filter(
    (entry) => entry.status === "unique" || entry.status === "family" || entry.status === "suggested"
  );
  const demoNames = uniqueNames(safeDemos.flatMap((entry) => entry.columns));
  const nominalDemos = nominalDemographics(session, demoNames);
  const specs = [];
  const hasTable = (session?.data?.variables || []).length > 0;
  const tentative = !claimed && !analysis;
  const rmFamilies = (shape.families || []).filter((family) => isRepeatedMeasureFamily(family));
  let observedForAdvice = shape.looksLike;
  if (tentative && shape.looksLike === "within" && shape.format !== "long" && rmFamilies.length === 0) {
    const grouping = tableGroupingColumns(session);
    const standalone = betweenDependentColumns(session);
    observedForAdvice = grouping.length > 0 && standalone.length > 0 ? "between" : "unclear";
  }
  const designForMethod =
    claimed ||
    (observedForAdvice === "within" || observedForAdvice === "between" ? observedForAdvice : null);
  const canGround = safeDependents.length > 0 || slots.exact.length > 0 || slots.ranged.length > 0 || Boolean(claimed);

  const descVars = uniqueNames([
    ...safeDependents.flatMap((entry) => entry.columns),
    ...scaleLike(session, demoNames),
    ...scaleLike(session, [...slots.exact, ...slots.ranged]).filter((name) => !looksLikeDemographic(variableByName(session, name) || { name })),
  ]);
  if (descVars.length === 0 && !analysis) {
    descVars.push(...tableMeasureColumns(session));
  }

  if (descVars.length > 0 && !analysis) {
    specs.push({
      analysis: "descriptives",
      role: "descriptives",
      variables: { variables: descVars },
      summary: `描述统计：${descVars.join("、")}`,
    });
  }

  if (tentative && hasTable) {
    warnings.push(
      "你还没有说明实验设计或要分析的变量。下面先根据表格给出描述统计，并列出几种说得通的候选方法，都需要你确认后才执行。表格形态只是看起来像某种设计，不能当成已经确定的实验设计。"
    );
    const foundDemos = tableDemographicColumns(session);
    if (foundDemos.length > 0) {
      warnings.push(
        `从表头识别到可能的人口学变量：${foundDemos.join("、")}。如需做组间比较，请确认用哪一列分组；连续变量不宜直接当作分组，分类变量应保持原来的测量类型。`
      );
    }
  }

  const considerWithin =
    designForMethod === "within" || designForMethod === "mixed" || (claimed === "within" && shape.looksLike === "within");

  if (considerWithin && shape.format === "long") {
    warnings.push(
      "数据看起来是长格式（同一被试多行）。当前重复测量方差分析需要宽格式（每个条件一列），不能直接按长格式去跑。"
    );
  }

  if (considerWithin && shape.looksLike === "within" && shape.format === "wide") {
    const families = safeDependents.length
      ? safeDependents.map((entry) => ({
          key: entry.key,
          items: entry.columns,
          term: entry.term,
          grid: detectMultiFactorWithin(entry.columns),
        }))
      : shape.families
          .filter((family) => family.items.length >= 2)
          .filter((family) => !tentative || isRepeatedMeasureFamily(family))
          .map((family) => ({
            key: family.key,
            items: family.items,
            term: family.key,
            grid: detectMultiFactorWithin(family.items),
          }));

    for (const family of families) {
      if (family.grid) {
        warnings.push(
          `「${family.term || family.key}」看起来是 ${family.grid.factors[0]}×${family.grid.factors[1]} 的多因素组内设计。当前重复测量方差分析只支持一个组内因子，不能按多因素组内设计来跑，请先整理成单因子，或改用其他方案。`
        );
        continue;
      }
      if (family.items.length < 2) continue;
      specs.push({
        analysis: "rm_anova",
        role: "inferential",
        variables: { repeatedMeasuresCells: family.items },
        summary:
          family.items.length === 2
            ? `重复测量方差分析（也可改用配对 t 检验）：${family.items.join("、")}`
            : `重复测量方差分析：${family.items.join("、")}`,
      });
    }
  } else if (considerWithin && shape.format === "long") {
    let dvCols = uniqueNames(safeDependents.filter((entry) => entry.columns.length === 1).flatMap((entry) => entry.columns));
    if (dvCols.length === 0) {
      dvCols = uniqueNames(
        (shape.families || [])
          .filter((family) => family.items.length === 1)
          .flatMap((family) => family.items)
      );
    }
    const condition = shape.conditionCols[0];
    if (dvCols.length > 0 && condition && shape.subject) {
      for (const dv of dvCols) {
        specs.push({
          analysis: "mixed_lmm",
          role: "inferential",
          variables: {
            dependent: [dv],
            fixedEffects: [condition],
            randomFactors: [shape.subject],
          },
          summary: tentative
            ? `候选：线性混合模型（长格式，待确认）：${dv} ~ ${condition}，随机效应为 ${shape.subject}`
            : `线性混合模型（长格式）：${dv} ~ ${condition}，随机效应为 ${shape.subject}`,
        });
      }
    } else if (tentative) {
      questions.push(
        "表格看起来是长格式（同一被试多行）。当前重复测量方差分析需要宽格式，不能直接按长格式去跑。请确认被试编号、条件列和因变量；如需改用重复测量方差分析，请先把数据整理成每个条件一列（插件不会自动改数据）。"
      );
    }
  }

  if (examineDemographics && (designForMethod === "within" || designForMethod === "mixed") && shape.looksLike === "within") {
    const demoLabels = uniqueNames(
      safeDemos.map((entry) => {
        const name = entry.columns[0];
        const spoken = entry.term && entry.term !== name ? entry.term : "";
        return spoken ? `${spoken}（${name}）` : name;
      })
    );
    if (demoLabels.length > 0) {
      warnings.push(
        `你还提到要考察${demoLabels.join("、")}。如需把分类变量纳入条件比较，可用 jasp_update_plan 加入最多 2 个组间因子（例如性别）；连续变量不宜直接作为组间因子，当前重复测量方差分析也不能加协变量。`
      );
    }
  }

  if (examineDemographics && (designForMethod === "between" || shape.looksLike === "between" || (claimed === "within" && shape.looksLike === "between"))) {
    const dvs = uniqueNames(
      safeDependents.filter((entry) => entry.columns.length === 1).flatMap((entry) => entry.columns)
    );
    for (const dv of dvs) {
      for (const demo of nominalDemos) {
        const levels = levelCount(variableByName(session, demo));
        if (levels === 2) {
          specs.push({
            analysis: "ttest_independent",
            role: "demographic",
            variables: { dependent: [dv], group: [demo] },
            summary: `独立样本 t 检验：按 ${demo} 比较 ${dv}`,
          });
        } else if (levels > 2) {
          specs.push({
            analysis: "anova",
            role: "demographic",
            variables: { dependent: [dv], fixedFactors: [demo] },
            summary: `方差分析：按 ${demo} 比较 ${dv}`,
          });
        }
      }
    }
  }

  const hasBetweenSpecs = specs.some(
    (spec) => spec.analysis === "ttest_independent" || spec.analysis === "anova"
  );
  if ((tentative ? observedForAdvice : shape.looksLike) === "between" && claimed !== "within" && !hasBetweenSpecs && !analysis) {
    const dvs = betweenDependentColumns(session);
    const groups = tableGroupingColumns(session);
    if (dvs.length === 0 && scaleItemNames(session).size >= 2) {
      questions.push(
        "题项看起来可能属于同一个量表。是否先做信度，或确认后再合成均分，再比较组别？插件不会自动计分，也不会自行反向计分。"
      );
    }
    for (const dv of dvs) {
      for (const group of groups) {
        const levels = levelCount(variableByName(session, group));
        if (levels === 2) {
          specs.push({
            analysis: "ttest_independent",
            role: "inferential",
            variables: { dependent: [dv], group: [group] },
            summary: tentative
              ? `候选：独立样本 t 检验（待确认）：按 ${group} 比较 ${dv}`
              : `独立样本 t 检验：按 ${group} 比较 ${dv}`,
          });
        } else if (levels > 2) {
          specs.push({
            analysis: "anova",
            role: "inferential",
            variables: { dependent: [dv], fixedFactors: [group] },
            summary: tentative
              ? `候选：方差分析（待确认）：按 ${group} 比较 ${dv}`
              : `方差分析：按 ${group} 比较 ${dv}`,
          });
        }
      }
    }
  }

  if (tentative && observedForAdvice === "unclear") {
    questions.push(
      "从表里还不能确定这是组内还是组间设计。请确认实验设计，以及因变量是哪些列。"
    );
  }

  if (tentative && scales.some((item) => Array.isArray(item.items) && item.items.length >= 2 && !item.tentativeReverse)) {
    if (!questions.some((question) => question.includes("同一个量表"))) {
      questions.push(
        "有些列名前缀相同，看起来可能属于同一个量表。是否先做信度，或确认后再合成均分？插件不会自动计分，也不会自行反向计分。"
      );
    }
  }

  if (tentative) {
    for (const spec of specs.filter((item) => item.analysis === "rm_anova")) {
      const n = (spec.variables.repeatedMeasuresCells || []).length;
      if (n === 2) {
        spec.summary = `候选：重复测量方差分析（待确认，也可改用配对 t 检验）：${spec.variables.repeatedMeasuresCells.join("、")}`;
      } else {
        spec.summary = `候选：重复测量方差分析（待确认）：${spec.variables.repeatedMeasuresCells.join("、")}`;
      }
    }
  }

  const inferentialLimit = 6;
  const inferentialNow = specs.filter((spec) => spec.role !== "descriptives");
  if (inferentialNow.length > inferentialLimit) {
    const kept = new Set(inferentialNow.slice(0, inferentialLimit));
    const removed = inferentialNow.slice(inferentialLimit);
    for (const spec of specs.slice()) {
      if (spec.role !== "descriptives" && !kept.has(spec)) {
        const index = specs.indexOf(spec);
        if (index >= 0) specs.splice(index, 1);
      }
    }
    questions.push(
      `根据表格可以列出多种候选方法，这里先给出 ${inferentialLimit} 种。其余未展开：${removed
        .map((spec) => spec.summary)
        .join("；")}。请确认要用哪一种，或用 jasp_update_plan 补充。`
    );
  }

  for (const spec of specs) {
    spec.why = whyFor(spec, { tentative });
    spec.alternatives = alternativesFor(spec);
  }

  if (
    specs.length === 0 &&
    (questions.length > 0 || slots.unmatched.length > 0 || slots.dependents.length > 0 || (tentative && hasTable))
  ) {
    specs.push({
      analysis: "descriptives",
      role: "descriptives",
      variables: descVars.length ? { variables: descVars } : {},
      summary: "描述统计（请先确认变量对应关系）",
    });
  }

  if (tentative && hasTable && specs.length === 0) {
    questions.push("从表里还不能确定因变量。请说明要分析哪些列，以及这是组内还是组间设计。");
    specs.push({
      analysis: "descriptives",
      role: "descriptives",
      variables: {},
      summary: "描述统计（请先确认要分析的变量）",
    });
  }

  const inferential = specs.find((spec) => spec.role === "inferential") || specs.find((spec) => spec.role !== "descriptives");
  const primarySpec = inferential || specs[0] || null;
  const canAdvise =
    Boolean(primarySpec) &&
    (canGround || questions.length > 0 || slots.unmatched.length > 0 || (tentative && hasTable && specs.length > 0));

  const why = primarySpec?.why || "";
  const alternatives = uniqueNames(specs.flatMap((spec) => spec.alternatives || []));

  let slotSummary = summarizeSlots(slots);
  if (!slotSummary && descVars.length) {
    slotSummary = `未在话里指定变量；已根据表格选出测量列（已排除编号列）：${descVars.join("、")}`;
  }
  return {
    design: {
      claimed,
      observed: tentative ? observedForAdvice : shape.looksLike,
      format: shape.format,
      mismatch,
      summary: describeDesign(claimed, tentative ? observedForAdvice : shape.looksLike, shape.format),
    },
    slotSummary,
    slots,
    shape,
    questions,
    warnings,
    why,
    alternatives,
    scales: scaleNotes,
    examineDemographics,
    tentative,
    specs,
    primarySpec,
    canAdvise,
  };
}

export function roleAssignments(recipeKey, advice, session) {
  if (!advice) return {};
  const spec = (advice.specs || []).find((item) => item.analysis === recipeKey) || advice.primarySpec;
  if (spec?.analysis === recipeKey && spec.variables) return { ...spec.variables };
  const slots = advice.slots;
  if (!slots) return {};
  if (recipeKey === "descriptives") {
    const names = uniqueNames([
      ...groundedColumns(slots.dependents),
      ...scaleLike(session, groundedColumns(slots.demographics)),
    ]);
    return names.length ? { variables: names } : {};
  }
  if (recipeKey === "rm_anova") {
    const family = (slots.dependents || []).find(
      (entry) => (entry.status === "family" || entry.status === "unique") && entry.columns.length >= 2
    );
    if (!family) return {};
    return { repeatedMeasuresCells: family.columns };
  }
  if (recipeKey === "paired_ttest") {
    const family = (slots.dependents || []).find(
      (entry) => (entry.status === "family" || entry.status === "unique") && entry.columns.length === 2
    );
    if (!family) return {};
    return { pairs: family.columns };
  }
  return {};
}
