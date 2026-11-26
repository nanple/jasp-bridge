import { newId, nowIso } from "../config.js";
import {
  getRecipe,
  detectContrast,
  detectRecipe,
  isSupportedProcessModel,
  listRecipes,
  resolveProcessModel,
} from "./recipes.js";
import { suggestStructure, suggestionWarning } from "./suggest.js";

function toArray(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function normalizeVariables(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const list = toArray(value).filter(Boolean);
    if (list.length > 0) result[key] = list;
  }
  return result;
}

function variableIndex(session) {
  const map = new Map();
  for (const variable of session?.data?.variables || []) {
    map.set(variable.name.toLowerCase(), variable);
    if (variable.label) map.set(String(variable.label).toLowerCase(), variable);
  }
  return map;
}

function autoDetectVariables(utterance, session) {
  const text = String(utterance || "").toLowerCase();
  const variables = session?.data?.variables || [];
  const found = new Set();

  for (const variable of variables) {
    const name = variable.name.toLowerCase();
    if (name.length >= 2 && text.includes(name)) found.add(variable.name);
  }

  // 支持 sat1-sat5 / q1 到 q5 这类区间写法，避免只抓到首尾两列
  const rangePattern =
    /([a-z_][a-z0-9_]*?)(\d+)\s*(?:-|–|—|~|到|至)\s*([a-z_][a-z0-9_]*?)(\d+)/gi;
  let match;
  while ((match = rangePattern.exec(text))) {
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
      if (index >= start && index <= end) found.add(variable.name);
    }
  }

  return variables.filter((variable) => found.has(variable.name)).map((variable) => variable.name);
}

function compatible(variable, kinds) {
  if (!variable) return false;
  if (!kinds || kinds.length === 0) return true;
  return kinds.includes(variable.type);
}

// JASP 变量选项需要并行的 <role>.types，供 jaspTools 编码列名与类型。
function attachTypeOptions(options, variables, session) {
  const index = new Map((session?.data?.variables || []).map((v) => [v.name, v.type]));
  const next = { ...options };
  for (const [role, names] of Object.entries(variables)) {
    if (!(role in options)) continue;
    const list = Array.isArray(names) ? names : [names];
    const types = list.map((name) => {
      const type = index.get(String(name));
      if (type === "nominal") return "nominal";
      if (type === "ordinal") return "ordinal";
      return "scale";
    });
    const value = options[role];
    if (typeof value === "string") {
      next[`${role}.types`] = types[0];
    } else if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string")
    ) {
      next[`${role}.types`] = types;
    }
  }
  return next;
}

function validateVariables(session, recipe, variables, utterance = "") {
  const warnings = [];
  const questions = [];
  const index = variableIndex(session);
  const resolved = {};

  for (const [role, spec] of Object.entries(recipe.roles)) {
    const values = variables[role] || [];
    const existing = [];
    for (const value of values) {
      const variable = index.get(String(value).toLowerCase());
      if (!variable) {
        questions.push(`变量「${value}」不在当前数据集中，请确认变量名。`);
        continue;
      }
      if (!compatible(variable, spec.kinds)) {
        warnings.push(
          `变量「${variable.name}」的类型是 ${variable.type}，与「${spec.label}」建议的 ${spec.kinds.join(
            "/"
          )} 不完全匹配，JASP 可能会报类型错误。`
        );
      }
      existing.push(variable.name);
    }

    const min = spec.required ? spec.min || 1 : 0;
    const max = spec.max || Infinity;

    if (existing.length < min) {
      // 尝试自动补全唯一候选
      const candidates = (session?.data?.variables || []).filter(
        (variable) => compatible(variable, spec.kinds) && !Object.values(resolved).flat().includes(variable.name)
      );
      if (existing.length === 0 && candidates.length === 1 && min === 1) {
        existing.push(candidates[0].name);
        warnings.push(`未显式指定「${spec.label}」，已按唯一候选自动选为 ${candidates[0].name}。`);
      } else if (existing.length === 0) {
        questions.push(
          `请指定「${spec.label}」${spec.min > 1 ? `（至少 ${spec.min} 个）` : ""}${
            candidates.length > 0
              ? `，候选：${candidates.map((c) => c.name).join("、")}`
              : ""
          }。`
        );
      } else {
        questions.push(`「${spec.label}」至少需要 ${min} 个变量，当前只有 ${existing.length} 个。`);
      }
    }

    if (existing.length > max) {
      questions.push(`「${spec.label}」最多允许 ${max} 个变量，当前为 ${existing.length} 个。`);
    }

    if (existing.length > 0) resolved[role] = existing;
  }

  // 分析特定检查
  if (recipe.key === "ttest_independent" && resolved.group) {
    const group = index.get(resolved.group[0].toLowerCase());
    const levels = group?.levels?.length || group?.unique || 0;
    if (levels > 2) {
      questions.push(
        `分组变量「${resolved.group[0]}」有 ${levels} 个水平，独立样本 t 检验只适用 2 组；可改用单因素 ANOVA。`
      );
    }
    if (levels > 0 && levels < 2) {
      questions.push(`分组变量「${resolved.group[0]}」只有 1 个水平，无法做组间比较。`);
    }
  }

  if (recipe.key === "anova" && resolved.fixedFactors) {
    for (const factor of resolved.fixedFactors) {
      const variable = index.get(factor.toLowerCase());
      const levels = variable?.levels?.length || variable?.unique || 0;
      if (levels < 2) questions.push(`固定因子「${factor}」少于 2 个水平，无法做 ANOVA。`);
    }

    const simpleFactor = resolved.simpleEffectFactor?.[0];
    const simpleModerator = resolved.simpleEffectModerator?.[0];
    const simpleModeratorTwo = resolved.simpleEffectModeratorTwo?.[0];

    if (Boolean(simpleFactor) !== Boolean(simpleModerator)) {
      questions.push("简单效应需要同时指定「简单效应因子」和「调节因子」。");
    }
    if (simpleModeratorTwo && !simpleFactor) {
      questions.push("「简单效应第二个调节因子」需要同时指定「简单效应因子」和「调节因子」。");
    }
    if (simpleFactor && simpleModerator) {
      for (const [role, name] of [
        ["简单效应因子", simpleFactor],
        ["简单效应调节因子", simpleModerator],
      ]) {
        if (!resolved.fixedFactors.includes(name)) {
          questions.push(`${role}「${name}」必须同时放进 fixedFactors。`);
        }
      }
      if (simpleModeratorTwo && !resolved.fixedFactors.includes(simpleModeratorTwo)) {
        questions.push(`简单效应第二个调节因子「${simpleModeratorTwo}」必须同时放进 fixedFactors。`);
      }
      if (simpleFactor === simpleModerator || simpleFactor === simpleModeratorTwo) {
        questions.push("简单效应因子与调节因子不能是同一个变量。");
      }
      const needed = simpleModeratorTwo ? 3 : 2;
      if (resolved.fixedFactors.length < needed) {
        questions.push(
          `简单效应需要至少 ${needed} 个固定因子（一个因子在另外${needed - 1}个因子的各水平上比较）。`
        );
      }
    }

    if (resolved.fixedFactors.length > 1) {
      const cells = resolved.fixedFactors.reduce((total, factor) => {
        const variable = index.get(factor.toLowerCase());
        const levels = variable?.levels?.length || variable?.unique || 1;
        return total * Math.max(1, levels);
      }, 1);
      const n = session?.data?.n || 0;
      if (n > 0 && cells > n) {
        warnings.push(
          `固定因子共有 ${cells} 种组合，但样本量只有 ${n}，必然存在空格子；JASP 无法为这些格子估计简单效应，建议平衡设计或减少因子。`
        );
      }
    }

    if (detectContrast(utterance) && resolved.fixedFactors.length > 1) {
      warnings.push(
        "检测到对比（contrast）关键词，已对每个固定因子应用同一对比类型；如需只对某一因子做对比，请在 options.contrasts 中显式指定。"
      );
    }
  }

  if (recipe.key === "rm_anova") {
    const cells = resolved.repeatedMeasuresCells || [];
    const between = resolved.betweenSubjectFactors || [];

    if (cells.length >= 2) {
      warnings.push(
        `重复测量 ANOVA 使用宽格式数据；单元格顺序即水平顺序：${cells.join(" → ")}。如需改顺序，用 \`jasp_update_plan\` 重排变量。`
      );
    }

    for (const factor of between) {
      const variable = index.get(factor.toLowerCase());
      const levels = variable?.levels?.length || variable?.unique || 0;
      if (levels > 0 && levels < 2) {
        questions.push(`组间因子「${factor}」只有 1 个水平，无法做组间比较。`);
      }
    }

    const overlap = cells.filter((name) => between.includes(name));
    if (overlap.length > 0) {
      questions.push(`变量「${overlap.join("、")}」不能同时作为重复测量列和组间因子。`);
    }

    const missing = cells.filter((name) => {
      const variable = index.get(name.toLowerCase());
      return Number(variable?.missing || 0) > 0;
    });
    if (missing.length > 0) {
      warnings.push(
        `以下重复测量列有缺失值：${missing.join("、")}。JASP 默认按 listwise 删除整行，样本量会减少。`
      );
    }

    if (/简单效应/.test(utterance)) {
      if (between.length === 0) {
        warnings.push("简单效应需要组间因子；只有被试内因子时请改用事后比较。");
      } else if (between.length > 1) {
        warnings.push(
          `检测到多个组间因子，简单效应默认用「${between[0]}」作为调节变量；如需换方向，请在 options 中指定 simpleMainEffectFactor。`
        );
      }
    }
  }

  if (recipe.key === "process" || recipe.key === "process_bayesian") {
    const modelNumber = resolveProcessModel(resolved, utterance);
    const mediators = resolved.mediators || [];
    const moderatorW = resolved.moderatorW || [];
    const moderatorZ = resolved.moderatorZ || [];

    if (!modelNumber) {
      questions.push(
        "请说明要检验的 Process 模型：中介（Model 4）、链式中介（Model 6）、调节（Model 1）或有调节的中介（Model 7/8/14/15），也可以直接说“模型 4”。"
      );
    } else if (!isSupportedProcessModel(modelNumber)) {
      questions.push(
        `当前支持 Process Model 1 / 4 / 6 / 7 / 8 / 14 / 15，暂不支持 Model ${modelNumber}。`
      );
    } else {
      const moderatorCount = moderatorW.length + moderatorZ.length;
      const needs = {
        1: { mediators: 0, moderators: 1, label: "调节模型" },
        4: { mediators: 1, moderators: 0, label: "简单中介" },
        6: { mediators: 2, moderators: 0, label: "链式中介" },
        7: { mediators: 1, moderators: 1, label: "第一阶段有调节的中介" },
        8: { mediators: 1, moderators: 1, label: "第二阶段有调节的中介" },
        14: { mediators: 2, moderators: 1, label: "第一阶段有调节的链式中介" },
        15: { mediators: 2, moderators: 1, label: "第二阶段有调节的链式中介" },
      }[modelNumber];

      if (mediators.length !== needs.mediators) {
        questions.push(
          `Model ${modelNumber}（${needs.label}）需要 ${needs.mediators} 个中介变量，当前为 ${mediators.length} 个。`
        );
      }
      if (moderatorCount !== needs.moderators) {
        questions.push(
          `Model ${modelNumber}（${needs.label}）需要 ${needs.moderators} 个调节变量，当前为 ${moderatorCount} 个。`
        );
      }
      if (moderatorZ.length > 0) {
        questions.push("暂不支持双调节模型（两个调节变量），请只指定 moderatorW。");
      }
      if ([4, 6, 7, 8, 14, 15].includes(modelNumber)) {
        warnings.push(
          recipe.key === "process_bayesian"
            ? "贝叶斯 Process 使用 MCMC（默认 3 条链、500 次 burn-in、1000 次抽样），首次运行可能需要几分钟。"
            : "中介模型使用 1000 次 bootstrap 估计间接效应 CI，单次运行约 30–90 秒。"
        );
      }
      if ([7, 8, 14, 15].includes(modelNumber) && recipe.key === "process") {
        warnings.push(
          "有调节的中介会额外输出调节中介指数（index of moderated mediation），报告时需说明其 CI 是否包含 0。"
        );
      }
    }

    if (resolved.independent?.[0]) {
      const x = index.get(resolved.independent[0].toLowerCase());
      if (x?.type === "nominal") {
        warnings.push(`自变量「${x.name}」是分类变量，JASP 会自动生成哑变量；解释路径系数时注意参照组。`);
      }
    }

    for (const mediator of mediators) {
      const variable = index.get(mediator.toLowerCase());
      if (variable?.type === "nominal") {
        questions.push(`中介变量「${mediator}」必须是连续变量。`);
      }
    }

    const missing = [...new Set([...mediators, ...(resolved.independent || [])])].filter((name) => {
      const variable = index.get(name.toLowerCase());
      return Number(variable?.missing || 0) > 0;
    });
    if (missing.length > 0) {
      warnings.push(
        `以下变量有缺失值：${missing.join("、")}。JASP 默认按 listwise 删除整行（可用 FIML，但目前未开放）。`
      );
    }
  }

  if (recipe.key === "reliability" && resolved.variables) {
    const nonNumeric = resolved.variables.filter((name) => {
      const variable = index.get(name.toLowerCase());
      return variable && !["scale", "ordinal"].includes(variable.type);
    });
    if (nonNumeric.length > 0) {
      questions.push(`信度分析的题项应为数值型，以下变量不是：${nonNumeric.join("、")}。`);
    }
  }

  if (recipe.key === "regression" && resolved.covariates) {
    const predictors = resolved.covariates.length + (resolved.factors?.length || 0);
    const n = session?.data?.n || 0;
    if (n > 0 && n < 10 * (predictors + 1)) {
      warnings.push(
        `样本量 ${n} 相对 ${predictors} 个预测变量偏小（建议至少 ${10 * (predictors + 1)}），估计可能不稳定。`
      );
    }
  }

  return { variables: resolved, warnings, questions };
}

export function buildPlan({ session, utterance = "", analysis, variables = {}, options = {} }) {
  if (!session?.data) {
    throw new Error("当前会话还没有数据，请先调用 jasp_load_data 或 jasp_ingest_data。");
  }

  const recipeKey = analysis || detectRecipe(utterance);
  const recipe = getRecipe(recipeKey);
  if (!recipe) {
    throw new Error(
      `无法识别分析类型。可用方法：${listRecipes()
        .map((item) => `${item.key}（${item.label}）`)
        .join("、")}。`
    );
  }

  const explicit = normalizeVariables(variables);
  const detected = autoDetectVariables(utterance, session);

  // 若调用方只给了变量列表而没有角色，按 recipe 的第一个必填角色落入
  const merged = { ...explicit };
  if (Object.keys(merged).length === 0 && detected.length > 0) {
    const firstRole = Object.entries(recipe.roles).find(([, spec]) => spec.required)?.[0];
    if (firstRole) merged[firstRole] = detected;
  } else {
    for (const [role, spec] of Object.entries(recipe.roles)) {
      if (merged[role]) continue;
      const candidates = detected.filter((name) => {
        const variable = session.data.variables.find((item) => item.name === name);
        return compatible(variable, spec.kinds);
      });
      if (candidates.length > 0 && !Object.values(merged).flat().includes(candidates[0])) {
        merged[role] = [candidates[0]];
      }
    }
  }

  const suggestion = suggestStructure({
    session,
    recipe,
    variables: merged,
    options,
    utterance,
  });
  if (suggestion.applied) {
    for (const [role, names] of Object.entries(suggestion.variables || {})) {
      if (!merged[role] || merged[role].length === 0) merged[role] = names;
    }
  }

  const validation = validateVariables(session, recipe, merged, utterance);
  const planOptions = attachTypeOptions(
    {
      ...recipe.buildOptions(validation.variables, { utterance, session }),
      ...(suggestion.applied ? suggestion.options : {}),
      ...options,
    },
    validation.variables,
    session
  );

  const questions = [...validation.questions];
  if (typeof recipe.normalizeOptions === "function") {
    Object.assign(
      planOptions,
      recipe.normalizeOptions(planOptions, {
        session,
        utterance,
        variables: validation.variables,
      })
    );
  }
  if (typeof recipe.validateOptions === "function") {
    questions.push(
      ...recipe.validateOptions(planOptions, {
        session,
        utterance,
        variables: validation.variables,
      })
    );
  }
  const plan = {
    schema: "jasp-bridge/plan@1",
    id: newId("p"),
    revision: 1,
    session_id: session.id,
    created_at: nowIso(),
    updated_at: nowIso(),
    analysis: recipe.key,
    label: recipe.label,
    jasp: recipe.jasp,
    status: questions.length > 0 ? "needs_input" : "proposed",
    data_ref: session.data.path,
    n: session.data.n,
    variables: validation.variables,
    options: planOptions,
    questions,
    warnings: [
      ...validation.warnings,
      ...(suggestion.applied ? suggestionWarning(suggestion) : []),
      ...(recipe.beta
        ? [`「${recipe.label}」在 P0 标记为 beta：若 JASP 报选项错误，请用 jasp_export 导出模板后在 JASP 中固定一次。`]
        : []),
    ],
    apa_hint: recipe.apaHint,
    utterance,
    suggestions: suggestion.applied
      ? {
          pending: true,
          label: "建议（尚未确认）",
          items: suggestion.items,
          factors: suggestion.factors,
          models: suggestion.models,
          factorCount: suggestion.factorCount,
          notes: suggestion.notes,
        }
      : undefined,
  };

  return plan;
}

export function patchPlan({ session, plan, patch = {} }) {
  if (!plan) throw new Error("找不到要修改的分析计划。");
  const mergedVariables = {
    ...plan.variables,
    ...normalizeVariables(patch.variables || {}),
  };
  const next = buildPlan({
    session,
    utterance: patch.utterance || plan.utterance,
    analysis: patch.analysis || plan.analysis,
    variables: mergedVariables,
    options: { ...plan.options, ...(patch.options || {}) },
  });
  next.id = plan.id;
  next.revision = (plan.revision || 1) + 1;
  next.created_at = plan.created_at;
  next.confirmed_at = plan.confirmed_at;
  next.status = next.questions.length > 0 ? "needs_input" : patch.keepConfirmed ? "confirmed" : "proposed";
  return next;
}

export function planMarkdown(plan) {
  const lines = [
    `### 分析计划 \`${plan.id}\`（修订 ${plan.revision}）`,
    "",
    `- 方法：**${plan.label}**（JASP: \`${plan.jasp.analysis}\` / ${plan.jasp.module}）`,
    `- 数据：${plan.n} 行`,
    `- 状态：**${plan.status}**`,
    "",
    "**变量映射**",
  ];

  for (const [role, names] of Object.entries(plan.variables)) {
    lines.push(`- ${role}: ${names.join("、")}`);
  }

  if (plan.suggestions?.pending) {
    lines.push("", "**建议（尚未确认，不是已确认的事实）**");
    if (plan.suggestions.items?.length) {
      lines.push(`- 建议题项：${plan.suggestions.items.join("、")}`);
    }
    if (plan.suggestions.factors?.length) {
      lines.push(
        `- 建议因子结构：${plan.suggestions.factors
          .map((factor) => `${factor.name}（${(factor.indicators || []).join("、")}）`)
          .join("；")}`
      );
    }
    if (plan.suggestions.models) {
      lines.push("- 建议模型语法：", "", "```", plan.suggestions.models, "```");
    }
    if (plan.suggestions.factorCount) {
      lines.push(`- 建议因子/成分数：${plan.suggestions.factorCount}`);
    }
    for (const note of plan.suggestions.notes || []) lines.push(`- ${note}`);
    lines.push("- 请核对后调用 `jasp_confirm_plan`，或用 `jasp_update_plan` 修改。确认前不会执行。");
  }

  if (plan.questions.length > 0) {
    lines.push("", "**需要你确认**");
    for (const question of plan.questions) lines.push(`- ${question}`);
  }

  if (plan.warnings.length > 0) {
    lines.push("", "**提醒**");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }

  lines.push("", `**报告提示**：${plan.apa_hint}`);
  return lines.join("\n");
}
