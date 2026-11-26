import { nowIso } from "../config.js";

export function buildRequest(plan, options = {}) {
  if (!plan?.jasp?.analysis) throw new Error("计划缺少 JASP 分析名。");
  if (!plan?.options || typeof plan.options !== "object") {
    throw new Error("计划缺少 JASP 选项对象。");
  }
  return {
    schema: "jasp-bridge/request@1",
    name: plan.jasp.analysis,
    module: plan.jasp.module,
    options: plan.options,
    seed: options.seed ?? 1,
    meta: {
      plugin: "jasp-bridge",
      plugin_version: "0.2.0",
      plan_id: plan.id,
      plan_revision: plan.revision,
      session_id: plan.session_id,
      recipe: plan.analysis,
      created_at: nowIso(),
    },
  };
}

export function buildTemplate(plan) {
  return {
    schema: "jasp-bridge/template@1",
    note:
      "这是 JASP 引擎层的分析模板（analysis request），不是 .jasp 归档文件。.jasp 归档由 JASP 自身生成或重放。",
    analyses: [
      {
        name: plan.jasp.analysis,
        module: plan.jasp.module,
        options: plan.options,
      },
    ],
    data_requirements: Object.entries(plan.variables).map(([role, names]) => ({
      role,
      variables: names,
    })),
    report_hint: plan.apa_hint,
  };
}

export function requestMarkdown(request) {
  return [
    "### JASP 分析请求",
    "",
    `- 分析：\`${request.name}\``,
    `- 模块：\`${request.module}\``,
    `- 随机种子：${request.seed}`,
    "",
    "```json",
    JSON.stringify(request.options, null, 2),
    "```",
  ].join("\n");
}
