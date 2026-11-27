import { looksCategorical, looksLikeId } from "../data/ingest.js";

const ITEM_SUFFIX = /^(.*?)[_-]?(\d+)$/u;
const COMPOSITE_NAME =
  /(均分|总分|得分|合成|平均分|量表分)$|(^|[_-])(mean|avg|total|sum|score|composite)([_-]|$)/i;
const DEMOGRAPHIC_NAME =
  /^(age|ages|年龄|岁|gender|sex|性别|edu|educ|education|学历|教育程度|教育|income|收入|year|年份|grade|年级|major|专业|occupation|job|职业|ethnicity|ethnic|民族|race|种族|marital|婚姻|婚姻状况)$/i;

export function isCompositeName(name) {
  return COMPOSITE_NAME.test(String(name));
}

export function isDemographicName(name) {
  return DEMOGRAPHIC_NAME.test(String(name).trim());
}

function nameTokens(value) {
  const raw = String(value || "");
  const tokens = new Set();
  for (const part of raw.split(/[^A-Za-z0-9\u4e00-\u9fff]+/)) {
    if (!part) continue;
    tokens.add(part);
    const camel = part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    for (const piece of camel) if (piece) tokens.add(piece);
  }
  return [...tokens];
}

export function looksLikeDemographic(variable) {
  const name = String(variable?.name || "").trim();
  const label = String(variable?.label || "").trim();
  if (isDemographicName(name) || (label && isDemographicName(label))) return true;
  return nameTokens(`${name} ${label}`).some((token) => isDemographicName(token));
}

export function itemCandidates(session) {
  return (session?.data?.variables || []).filter((variable) => {
    if (!["scale", "ordinal"].includes(variable.type)) return false;
    if (looksLikeId(variable.name) || looksCategorical(variable.name)) return false;
    if (looksLikeDemographic(variable) || isCompositeName(variable.name)) return false;
    return true;
  });
}

function factorName(prefix, index) {
  const trimmed = String(prefix || "").replace(/[_-]+$/g, "");
  if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(trimmed)) return trimmed;
  return `F${index + 1}`;
}

export function groupByPrefix(variables) {
  const buckets = new Map();
  const leftovers = [];

  for (const variable of variables) {
    const name = variable.name;
    const match = ITEM_SUFFIX.exec(name);
    if (!match || !match[1] || match[1].replace(/[_-]+$/g, "") === "") {
      leftovers.push(name);
      continue;
    }
    const prefix = match[1].replace(/[_-]+$/g, "");
    const key = prefix.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, { prefix, items: [] });
    buckets.get(key).items.push({ name, index: Number(match[2]) });
  }

  const scales = [];
  for (const bucket of buckets.values()) {
    if (bucket.items.length >= 2) {
      bucket.items.sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));
      scales.push({
        prefix: bucket.prefix,
        items: bucket.items.map((item) => item.name),
      });
    } else {
      leftovers.push(bucket.items[0].name);
    }
  }

  const order = new Map(variables.map((variable, index) => [variable.name, index]));
  scales.sort((a, b) => (order.get(a.items[0]) ?? 0) - (order.get(b.items[0]) ?? 0));
  return { scales, ungrouped: leftovers };
}

function factorEntries(scales) {
  return scales.map((scale, index) => ({
    name: factorName(scale.prefix, index),
    title: `建议因子「${scale.prefix}」`,
    indicators: scale.items,
    prefix: scale.prefix,
  }));
}

function measurementSyntax(factors, arrow) {
  return factors.map((factor) => `${factor.name} ${arrow} ${factor.indicators.join(" + ")}`).join("\n");
}

/**
 * When the user has not named items or a factor structure, inspect column
 * names, prefixes and types and return a clearly labeled suggestion.
 * Never treat the result as already confirmed.
 */
export function suggestStructure({
  session,
  recipe,
  variables = {},
  options = {},
  utterance = "",
} = {}) {
  const empty = {
    applied: false,
    items: [],
    factors: [],
    factorCount: undefined,
    models: null,
    notes: [],
    variables: {},
    options: {},
  };
  if (!recipe?.key) return empty;

  const supported = new Set(["efa", "pca", "cfa", "sem", "plssem", "reliability"]);
  if (!supported.has(recipe.key)) return empty;

  const candidates = itemCandidates(session);
  const { scales } = groupByPrefix(candidates);
  const prefixedItems = scales.flatMap((scale) => scale.items);
  const pool = prefixedItems.length >= 3 ? prefixedItems : candidates.map((variable) => variable.name);

  const result = { ...empty, kind: recipe.key };

  if (["efa", "pca", "reliability"].includes(recipe.key)) {
    const min = recipe.roles?.variables?.min || (recipe.key === "reliability" ? 2 : 3);
    const have = variables.variables || [];
    if (have.length < min && pool.length >= min) {
      result.variables = { variables: pool };
      result.items = pool;
      result.applied = true;
      if (["efa", "pca"].includes(recipe.key) && scales.length >= 2) {
        result.factorCount = scales.length;
        result.factors = factorEntries(scales);
        const stated = /(\d+)\s*(个|种|维度|factors?|components?|维度数)/i.test(String(utterance || ""));
        if (!stated) {
          result.options =
            recipe.key === "pca"
              ? { componentCountMethod: "manual", manualNumberOfComponents: scales.length }
              : { factorCountMethod: "manual", manualNumberOfFactors: scales.length };
        }
      }
      result.notes.push(
        "题项是根据变量名前缀和类型提出的建议，不是已确认的事实。请核对后确认，或用 jasp_update_plan 修改。"
      );
    }
  }

  if (recipe.key === "cfa") {
    const existing = options.factors;
    if (!Array.isArray(existing) || existing.length === 0) {
      const specified = variables.variables || [];
      let sourceScales = scales;
      if (specified.length > 0) {
        const specifiedSet = new Set(specified);
        const scoped = groupByPrefix(candidates.filter((variable) => specifiedSet.has(variable.name))).scales;
        sourceScales =
          scoped.length > 0
            ? scoped
            : specified.length >= 2
              ? [{ prefix: "F1", items: specified }]
              : [];
      }
      if (sourceScales.length > 0) {
        const factors = factorEntries(sourceScales);
        result.factors = factors;
        result.items = factors.flatMap((factor) => factor.indicators);
        result.options = {
          factors: factors.map(({ name, title, indicators }) => ({ name, title, indicators })),
        };
        if (!variables.variables) result.variables = { variables: result.items };
        result.applied = true;
        result.notes.push(
          "因子结构是根据变量名前缀提出的建议，不是已确认的事实。请核对题项归属后确认，或用 jasp_update_plan 修改。"
        );
      }
    }
  }

  if (recipe.key === "sem" || recipe.key === "plssem") {
    const existing = options.models;
    if ((!Array.isArray(existing) || existing.length === 0) && scales.length > 0) {
      const factors = factorEntries(scales);
      const arrow = recipe.key === "plssem" ? "->" : "=~";
      const syntax = measurementSyntax(factors, arrow);
      result.factors = factors;
      result.items = factors.flatMap((factor) => factor.indicators);
      result.models = syntax;
      result.options = {
        models: [{ name: "建议测量模型", syntax }],
      };
      result.applied = true;
      result.notes.push(
        recipe.key === "plssem"
          ? "这是根据题项前缀生成的建议 PLS 测量模型，不是已确认的结构模型。如需补充路径，请用 jasp_update_plan 修改后再确认。"
          : "这是根据题项前缀生成的建议测量模型（lavaan），不是已确认的结构模型。如需补充回归路径，请用 jasp_update_plan 修改后再确认。"
      );
    }
  }

  return result;
}

export function suggestionWarning(suggestion) {
  if (!suggestion?.applied) return [];
  const lines = ["【建议，待确认】插件根据数据列名、前缀和类型提出了分析方案，这不是已经确认的事实，确认前不会执行。"];
  if (suggestion.items?.length) lines.push(`建议题项：${suggestion.items.join("、")}`);
  if (suggestion.factors?.length) {
    lines.push(
      `建议因子结构：${suggestion.factors
        .map((factor) => `${factor.name}（${factor.indicators.join("、")}）`)
        .join("；")}`
    );
  }
  if (suggestion.models) {
    lines.push(`建议模型语法：\n${suggestion.models}`);
  }
  lines.push(...(suggestion.notes || []));
  return lines;
}

/**
 * General scale-membership suggestions for any analysis.
 * Never auto-compute totals or reverse-score; never claim reverse items as certain.
 */
export function suggestScaleMembership(session) {
  const candidates = itemCandidates(session);
  const { scales } = groupByPrefix(candidates);
  const variables = session?.data?.variables || [];
  const suggestions = [];

  for (const scale of scales) {
    const hasComposite = variables.some(
      (variable) =>
        isCompositeName(variable.name) &&
        String(variable.name).toLowerCase().includes(String(scale.prefix).toLowerCase())
    );
    suggestions.push({
      prefix: scale.prefix,
      items: scale.items,
      hasComposite,
      note: hasComposite
        ? `「${scale.items.join("、")}」列名前缀相同，看起来可能属于同一个量表；表里似乎已有合成列，请核对是否就是该量表的总分或均分。`
        : `「${scale.items.join("、")}」列名前缀相同，看起来可能属于同一个量表。如需以总分或均分做后续分析，请先确认是否计算（插件不会自动计算，也不会自行反向计分）。`,
    });
  }

  const reverseGuess = candidates.filter((variable) => {
    const name = String(variable.name || "");
    const label = String(variable.label || "");
    return /(?:^|_|-)(r|rev|reverse|反向)(?:[_-]|\d|$)/i.test(name) || /反向/.test(label);
  });
  if (reverseGuess.length > 0) {
    suggestions.push({
      prefix: null,
      items: reverseGuess.map((variable) => variable.name),
      tentativeReverse: true,
      note: `以下题项的名称或标签可能表示反向题，这只是根据命名的猜测，不能当作确定结论：${reverseGuess
        .map((variable) => variable.name)
        .join("、")}。请人工核对后再决定是否反向计分。`,
    });
  }

  return suggestions;
}
