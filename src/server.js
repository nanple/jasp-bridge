#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  HOME_DIR,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  RUN_TIMEOUT_MS,
  ensureDir,
  exportsDir,
  nowIso,
  runsDir,
} from "./config.js";
import {
  createSession,
  loadSession,
  requireSession,
  saveSession,
} from "./session.js";
import { ingestFile, ingestText, profileMarkdown } from "./data/ingest.js";
import { listRecipes } from "./plan/recipes.js";
import { buildSnapshot, renderMarkdown } from "./progress/snapshot.js";
import { buildPlan, patchPlan, planMarkdown } from "./plan/planner.js";
import { booleanArg, optionsArg, variableRolesArg } from "./plan/toolArgs.js";
import { buildRequest, buildTemplate, requestMarkdown } from "./plan/spec.js";
import {
  capabilitiesMarkdown,
  getCapabilities,
} from "./jasp/detect.js";
import {
  getRunStatus,
  readResult,
  readStatus,
  startRun,
} from "./jasp/rRunner.js";
import { runTemplate } from "./jasp/cliRunner.js";
import { logTail, resultMarkdown, statusMarkdown } from "./jasp/parse.js";
import { ensureWorker } from "./jasp/worker.js";
import { exportTablesToCsv } from "./export/csv.js";
import { buildJaspBundle } from "./export/jaspBundle.js";
import { buildJaspFile, collectJaspRunArtifacts } from "./export/jaspExport.js";
import {
  compareVersions,
  downloadUpdate,
  fetchManifest,
  updateCommand,
} from "./update/checker.js";

const server = new McpServer({ name: PLUGIN_NAME, version: PLUGIN_VERSION });

function ok(text) {
  return { content: [{ type: "text", text }] };
}

function fail(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function sessionOrFail(sessionId) {
  try {
    return { session: requireSession(sessionId) };
  } catch (error) {
    return { error: fail(`❌ ${error.message}`) };
  }
}

function runDirOf(session, runId) {
  const record = session.runs?.[runId];
  if (record?.dir && fs.existsSync(record.dir)) return record.dir;
  return path.join(runsDir(session.id), runId);
}

function recordPlan(session, plan) {
  session.plans = session.plans || {};
  session.plans[plan.id] = plan;
  saveSession(session);
  return plan;
}

function recordRun(session, status) {
  session.runs = session.runs || {};
  session.runs[status.run_id] = {
    run_id: status.run_id,
    plan_id: status.plan_id,
    analysis: status.analysis,
    dir: status.dir,
    started_at: status.started_at,
    status: status.status,
  };
  saveSession(session);
  return status;
}

function isSuccessfulRunStatus(status) {
  return status === "done" || status === "ok" || status === "partial" || status === "complete";
}

function latestSuccessfulRun(session, planId) {
  const candidates = [];
  const seen = new Set();

  const consider = (dir, fallbackId, fallbackAt) => {
    if (!dir || !fs.existsSync(dir) || seen.has(dir)) return;
    const status = getRunStatus(dir) || readStatus(dir);
    if (!status || status.plan_id !== planId) return;
    if (!isSuccessfulRunStatus(status.status)) return;
    if (!readResult(dir)) return;
    seen.add(dir);
    candidates.push({
      dir,
      run_id: status.run_id || fallbackId,
      at: status.finished_at || status.started_at || fallbackAt || "",
    });
  };

  for (const record of Object.values(session.runs || {})) {
    if (record.plan_id !== planId) continue;
    const dir =
      record.dir && fs.existsSync(record.dir)
        ? record.dir
        : path.join(runsDir(session.id), record.run_id);
    consider(dir, record.run_id, record.started_at);
  }

  const root = runsDir(session.id);
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      consider(dir, name, "");
    }
  }

  candidates.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return candidates[0] || null;
}

// ---------------------------------------------------------------------------
// 1. 环境自检
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_status",
  {
    title: "JASP 环境自检",
    description:
      "检查本机 JASP、Rscript、jaspTools 是否可用，返回可用后端（无头 R / CLI 模板重放 / dry-run）。开始任何分析前先调用。",
    inputSchema: {
      refresh: booleanArg("是否强制重新探测（默认使用 60 秒缓存）"),
    },
  },
  async ({ refresh }) => {
    const caps = getCapabilities({ refresh: Boolean(refresh) });
    return ok(capabilitiesMarkdown(caps));
  }
);

// ---------------------------------------------------------------------------
// 1.5 项目进度快照
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_progress",
  {
    title: "项目进度快照",
    description:
      "返回 jasp-bridge 当前进度：阶段、已完成、下一步、已知问题、分析类型清单与最近改动文件。用于交接，或让另一个助手接手继续开发。",
    inputSchema: {
      days: z.number().optional().describe("最近改动文件回溯天数（默认 7）"),
      format: z.enum(["markdown", "json"]).optional().describe("返回格式（默认 markdown）"),
    },
  },
  async ({ days, format }) => {
    const snapshot = buildSnapshot({ days: days || 7 });
    if (format === "json") return ok(JSON.stringify(snapshot, null, 2));
    return ok(renderMarkdown(snapshot));
  }
);

// ---------------------------------------------------------------------------
// 2. 检查更新
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_check_update",
  {
    title: "检查插件更新",
    description:
      "读取 latest.json 更新清单，比较版本并返回更新说明。只检查，不下载。更新源可通过 JASP_BRIDGE_UPDATE_URL 或 url 参数指定。",
    inputSchema: {
      url: z.string().optional().describe("latest.json 地址；不传则读 JASP_BRIDGE_UPDATE_URL"),
      timeout_ms: z.number().int().optional().describe("网络超时毫秒，默认 15000"),
    },
  },
  async ({ url, timeout_ms }) => {
    const manifestUrl = url || process.env.JASP_BRIDGE_UPDATE_URL || "";
    if (!manifestUrl) {
      return fail(
        [
          "❌ 未配置更新源。",
          "",
          "在 WorkBuddy 的 MCP 环境变量里设置：",
          "",
          "```json",
          '"JASP_BRIDGE_UPDATE_URL": "https://github.com/nanple/jasp-bridge/releases/latest/download/latest.json"',
          "```",
          "",
          "也可以调用时直接传 `url` 参数。",
        ].join("\n")
      );
    }

    try {
      const manifest = await fetchManifest(manifestUrl, {
        timeoutMs: timeout_ms ?? 15000,
      });
      const current = PLUGIN_VERSION;
      const comparison = compareVersions(manifest.version, current);

      if (comparison <= 0) {
        return ok(
          `### 已是最新版本\n\n- 当前：\`${current}\`\n- 清单：\`${manifest.version}\``
        );
      }

      const minOk =
        !manifest.min_plugin_version ||
        compareVersions(current, manifest.min_plugin_version) >= 0;

      return ok(
        [
          "### 发现新版本",
          "",
          `- 当前：\`${current}\``,
          `- 最新：\`${manifest.version}\``,
          `- 需要重建运行时：${manifest.runtime_required ? "是" : "否"}`,
          manifest.notes ? `- 说明：${manifest.notes}` : "",
          "",
          minOk
            ? "下一步：调用 `jasp_download_update` 下载并校验更新包。"
            : `当前版本低于最低要求 \`${manifest.min_plugin_version}\`，请按发布说明手动升级。`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      return fail(`❌ 检查更新失败：${error.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 3. 下载更新
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_download_update",
  {
    title: "下载并校验更新包",
    description:
      "按 latest.json 下载更新 zip，校验 SHA256，解压到 updates/<version>/，返回 update.ps1 安装命令。不会自动替换正在运行的文件。",
    inputSchema: {
      url: z.string().optional().describe("latest.json 地址；不传则读 JASP_BRIDGE_UPDATE_URL"),
      install_dir: z.string().optional().describe("插件安装目录，默认 JASP_BRIDGE_HOME"),
      timeout_ms: z.number().int().optional().describe("下载超时毫秒，默认 180000"),
    },
  },
  async ({ url, install_dir, timeout_ms }) => {
    const manifestUrl = url || process.env.JASP_BRIDGE_UPDATE_URL || "";
    if (!manifestUrl) {
      return fail("❌ 未配置更新源，请设置 JASP_BRIDGE_UPDATE_URL 或传入 url。");
    }

    const installDir = install_dir ? path.resolve(install_dir) : HOME_DIR;

    try {
      const manifest = await fetchManifest(manifestUrl);
      if (compareVersions(manifest.version, PLUGIN_VERSION) <= 0) {
        return ok(`已是最新版本（当前 ${PLUGIN_VERSION}，清单 ${manifest.version}）。`);
      }

      const downloaded = await downloadUpdate(manifest, { installDir });
      const command = updateCommand(downloaded.packageRoot, installDir);

      return ok(
        [
          "### 更新包已下载并通过校验",
          "",
          `- 版本：\`${manifest.version}\``,
          `- 包大小：${(downloaded.bytes / 1024 / 1024).toFixed(1)} MB`,
          `- SHA256：\`${downloaded.sha256}\``,
          `- 解压位置：\`${downloaded.packageRoot}\``,
          manifest.notes ? `- 说明：${manifest.notes}` : "",
          manifest.runtime_required
            ? "- 注意：本次更新要求重建运行时，安装后还需运行 `scripts/setup_runtime.ps1 -Force`。"
            : "",
          "",
          "**安装步骤**",
          "",
          "1. 关闭 WorkBuddy；",
          "2. 在 PowerShell 运行：",
          "",
          "```powershell",
          command,
          "```",
          "",
          "3. 重启 WorkBuddy，并调用 `jasp_status` 验证。",
          "",
          "> `update.ps1` 会备份当前代码，保留 `runtime/`、`sessions/` 和 `mcp.json`。",
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      return fail(`❌ 下载更新失败：${error.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 4. 加载数据文件
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_load_data",
  {
    title: "加载数据文件",
    description:
      "从本地路径加载 CSV/TSV/JSON 数据，建立变量字典与会话。返回 session_id，后续工具都要带上它。",
    inputSchema: {
      path: z.string().describe("数据文件绝对路径（支持 .csv/.tsv/.json；.sav 需先转 CSV）"),
      session_id: z.string().optional().describe("复用已有会话；不传则新建"),
      name: z.string().optional().describe("数据快照名，默认取文件名"),
      types: z
        .record(z.enum(["scale", "ordinal", "nominal"]))
        .optional()
        .describe("手动覆盖变量类型，例如 {\"gender\":\"nominal\"}"),
    },
  },
  async ({ path: filePath, session_id, name, types }) => {
    try {
      const absolute = path.resolve(filePath);
      const session = session_id ? requireSession(session_id) : createSession();
      const profile = ingestFile(absolute, {
        outDir: ensureDir(path.join(runsDir(session.id), "data")),
        name: name || path.basename(absolute, path.extname(absolute)),
        types: types || {},
      });

      session.data = {
        ...profile,
        source_path: absolute,
        loaded_at: nowIso(),
      };
      saveSession(session);

      return ok(
        [
          `✅ 已加载数据：\`${absolute}\``,
          "",
          profileMarkdown(session.data),
          "",
          `**session_id**：\`${session.id}\`（后续调用请带上）`,
          "",
          "下一步：用自然语言描述研究问题调用 `jasp_plan_analysis`，或先 `jasp_describe_data` 核对变量。",
        ].join("\n")
      );
    } catch (error) {
      return fail(`❌ 加载失败：${error.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 3. 从对话内容建数据
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_ingest_data",
  {
    title: "从对话内容建数据",
    description:
      "把对话中粘贴的表格（CSV/TSV）或 JSON 数组写成数据集并建立会话，适合没有本地文件的小样本。",
    inputSchema: {
      content: z.string().describe("CSV/TSV 文本或 JSON 对象数组"),
      format: z.enum(["csv", "tsv", "json"]).optional().describe("默认 csv"),
      name: z.string().optional().describe("数据集名，默认 data"),
      session_id: z.string().optional().describe("复用已有会话"),
      types: z
        .record(z.enum(["scale", "ordinal", "nominal"]))
        .optional()
        .describe("手动覆盖变量类型"),
    },
  },
  async ({ content, format, name, session_id, types }) => {
    try {
      const session = session_id ? requireSession(session_id) : createSession();
      const profile = ingestText(content, {
        outDir: ensureDir(path.join(runsDir(session.id), "data")),
        format: format || "csv",
        name: name || "data",
        types: types || {},
      });
      session.data = { ...profile, source_path: null, loaded_at: nowIso() };
      saveSession(session);

      return ok(
        [
          "✅ 已从对话内容建立数据集",
          "",
          profileMarkdown(session.data),
          "",
          `**session_id**：\`${session.id}\``,
        ].join("\n")
      );
    } catch (error) {
      return fail(`❌ 建数据失败：${error.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 4. 数据字典
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_describe_data",
  {
    title: "查看数据字典",
    description: "返回会话数据的样本量、变量类型、缺失、水平与描述统计，用于规划分析前核对变量。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
    },
  },
  async ({ session_id }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    if (!session.data) return fail("❌ 该会话还没有数据，请先 `jasp_load_data`。");

    return ok(
      [
        `### 数据概况（${session.data.n} 行 × ${session.data.columns.length} 列）`,
        "",
        profileMarkdown(session.data),
        "",
        `数据路径：\`${session.data.path}\``,
      ].join("\n")
    );
  }
);

// ---------------------------------------------------------------------------
// 5. 方法清单
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_list_methods",
  {
    title: "列出可用统计方法",
    description: "列出已封装的 JASP 分析、所需变量角色与 JASP 分析名，可用于把自然语言映射到方法。",
    inputSchema: {},
  },
  async () => {
    const rows = listRecipes().map((recipe) => [
      `\`${recipe.key}\``,
      recipe.label,
      `\`${recipe.jasp.analysis}\``,
      Object.entries(recipe.roles)
        .map(([role, spec]) => `${role}${spec.required ? "*" : ""}(${spec.kinds.join("/")})`)
        .join("、"),
      recipe.beta ? "beta" : "stable",
    ]);
    const header = "| 方法 | 名称 | JASP 分析 | 变量角色 | 状态 |\n| --- | --- | --- | --- | --- |";
    const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
    return ok(
      [
        "### 已封装的方法",
        "",
        header,
        body,
        "",
        "`*` 表示必填角色。当前 22 类均已可用：描述统计、信度（α 与 ω）、相关、独立与配对 t 检验、方差分析、协方差分析、重复测量方差分析、回归、Process 与贝叶斯 Process、线性/广义线性混合模型及贝叶斯混合模型、EFA/PCA/CFA、SEM、PLS-SEM、MIMIC、潜变量增长曲线。EFA/PCA 至少需要 3 个观测变量；若用户未指定题项或因子结构，`jasp_plan_analysis` 会根据列名、前缀和类型给出建议方案（明确标为建议，须经 `jasp_confirm_plan` 确认后才执行，也可用 `jasp_update_plan` 修改）。CFA 也可先给建议因子结构，SEM/PLS-SEM 可先给建议测量模型语法；用户仍可显式传入 options.factors / options.models。测量等值、元分析与功效分析尚未封装。",
      ].join("\n")
    );
  }
);

// ---------------------------------------------------------------------------
// 6. 生成分析计划
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_plan_analysis",
  {
    title: "生成分析计划",
    description:
      "由插件根据已加载数据生成可确认的分析计划（建议题项、因子结构、方法与关键选项）。这是分析方案的权威来源：宿主只需把计划展示给用户，不要自行计算、下结论或改用 Python 做旁路分析。用户未指定题项或因子时，插件会检查变量名、前缀和类型并给出建议；建议必须标明为建议，不是已确认的事实。状态为 proposed 时请展示计划并等待用户确认，不要自动执行。确认请用 jasp_confirm_plan，修改请用 jasp_update_plan。本工具不执行分析。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      utterance: z.string().describe("用户原话，例如「比较男女在抑郁得分上的差异」"),
      analysis: z
        .enum([
          "descriptives",
          "reliability",
          "correlation",
          "ttest_independent",
          "paired_ttest",
          "ancova",
          "anova",
          "rm_anova",
          "process",
          "process_bayesian",
          "efa",
          "pca",
          "cfa",
          "sem",
          "plssem",
          "mimic",
          "latent_growth",
          "mixed_glmm",
          "mixed_lmm",
          "mixed_blmm",
          "mixed_bglmm",
          "regression",
        ])
        .optional()
        .describe("显式指定方法；不传则按关键词自动识别"),
      variables: variableRolesArg.optional().describe('变量角色映射，例如 {"dependent":["perf"],"group":["gender"]}'),
      options: optionsArg.optional().describe("覆盖默认 JASP 选项（高级用法）"),
    },
  },
  async ({ session_id, utterance, analysis, variables, options }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    try {
      const plan = buildPlan({
        session,
        utterance,
        analysis,
        variables: variables || {},
        options: options || {},
      });
      recordPlan(session, plan);
      return ok(
        [
          planMarkdown(plan),
          "",
          plan.questions.length > 0
            ? "请把上面的问题补全后调用 `jasp_update_plan`，或确认无误后调用 `jasp_confirm_plan`。"
            : "请确认计划后调用 `jasp_confirm_plan`，再调用 `jasp_run` 执行。",
        ].join("\n")
      );
    } catch (err) {
      return fail(`❌ 生成计划失败：${err.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 7. 确认计划
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_confirm_plan",
  {
    title: "确认分析计划",
    description:
      "在用户核对插件提出的计划（含建议题项与因子结构）之后锁定该计划，随后才能调用 jasp_run。未解决的问题需要先 jasp_update_plan 补全，或在用户明确同意时使用 allow_incomplete=true。不要在用户确认前执行。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      plan_id: z.string().describe("计划 ID"),
      allow_incomplete: booleanArg("计划仍有问题时是否强制确认"),
    },
  },
  async ({ session_id, plan_id, allow_incomplete }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    const plan = session.plans?.[plan_id];
    if (!plan) return fail(`❌ 找不到计划 ${plan_id}。`);
    if (plan.questions?.length > 0 && !allow_incomplete) {
      const questionLines = plan.questions.map((question) => `- ${question}`).join("\n");
      return fail(
        `❌ 计划还有未解决的问题：\n${questionLines}\n请先 \`jasp_update_plan\` 补全。`
      );
    }
    plan.status = "confirmed";
    plan.confirmed_at = nowIso();
    saveSession(session);
    return ok(`✅ 已确认计划 \`${plan.id}\`（${plan.label}）。可以调用 \`jasp_run\`。`);
  }
);

// ---------------------------------------------------------------------------
// 8. 修改计划
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_update_plan",
  {
    title: "修改分析计划",
    description:
      "对插件已提出的计划做增量修改（题项、因子结构、方法、选项）。适用于用户不接受某条建议、或要补全模型路径的情况。修改后默认仍为待确认；加上 confirm=true 且没有未解问题时可直接确认。不要跳过确认去执行，也不要在宿主侧自行改算。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      plan_id: z.string().describe("计划 ID"),
      analysis: z
        .enum([
          "descriptives",
          "reliability",
          "correlation",
          "ttest_independent",
          "paired_ttest",
          "ancova",
          "anova",
          "rm_anova",
          "process",
          "process_bayesian",
          "efa",
          "pca",
          "cfa",
          "sem",
          "plssem",
          "mimic",
          "latent_growth",
          "mixed_glmm",
          "mixed_lmm",
          "mixed_blmm",
          "mixed_bglmm",
          "regression",
        ])
        .optional(),
      variables: variableRolesArg.optional().describe("要覆盖的角色映射"),
      options: optionsArg.optional().describe("要覆盖的 JASP 选项"),
      utterance: z.string().optional().describe("更新用户原话，用于重新识别相关类型等"),
      confirm: booleanArg("修改后是否直接确认"),
    },
  },
  async ({ session_id, plan_id, analysis, variables, options, utterance, confirm }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    const existing = session.plans?.[plan_id];
    if (!existing) return fail(`❌ 找不到计划 ${plan_id}。`);
    try {
      const next = patchPlan({
        session,
        plan: existing,
        patch: {
          analysis,
          variables: variables || {},
          options: options || {},
          utterance,
          keepConfirmed: false,
        },
      });
      if (confirm && next.questions.length === 0) {
        next.status = "confirmed";
        next.confirmed_at = nowIso();
      }
      recordPlan(session, next);
      return ok(
        [
          planMarkdown(next),
          "",
          next.status === "confirmed"
            ? "✅ 已确认，可以调用 `jasp_run`。"
            : next.questions.length > 0
            ? "请继续补全问题，或加 `confirm=true` 强制确认。"
            : "请确认后调用 `jasp_confirm_plan`。",
        ].join("\n")
      );
    } catch (err) {
      return fail(`❌ 修改计划失败：${err.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 9. 执行
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_run",
  {
    title: "执行分析",
    description:
      "按已确认的计划调用本机 JASP 引擎执行分析，这是得出统计数字、表格、图和 .jasp 的唯一途径。宿主应展示本工具链返回的结果，不要自行计算或编造数值，也不要改用 Python 做旁路分析。返回 run_id，用 jasp_run_status 轮询，用 jasp_get_results 取结果。计划未确认时不要调用（除非用户明确要求 force=true）。若本机无 R/jaspTools，会进入 dry-run 并生成可复现请求，不会产生统计数字。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      plan_id: z.string().describe("计划 ID"),
      seed: z.number().int().optional().describe("随机种子，默认 1"),
      timeout_ms: z.number().int().optional().describe("超时毫秒，默认 300000"),
      force: booleanArg("计划未确认时是否强制运行"),
    },
  },
  async ({ session_id, plan_id, seed, timeout_ms, force }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    const plan = session.plans?.[plan_id];
    if (!plan) return fail(`❌ 找不到计划 ${plan_id}。`);
    if (plan.status !== "confirmed" && !force) {
      return fail("❌ 计划尚未确认。请先 `jasp_confirm_plan`，或传 force=true。");
    }
    if (!session.data?.path || !fs.existsSync(session.data.path)) {
      return fail("❌ 会话数据文件不存在，请重新加载数据。");
    }

    try {
      const { status, dryRun } = startRun({
        session,
        plan,
        sessionRunsDir: runsDir(session.id),
        seed: seed ?? 1,
        timeoutMs: timeout_ms ?? RUN_TIMEOUT_MS,
      });
      recordRun(session, status);

      if (dryRun) {
        return ok(
          [
            "### 已生成 dry-run 工件（未执行统计）",
            "",
            `- run_id：\`${status.run_id}\``,
            `- 原因：${status.reason}`,
            `- 目录：\`${status.dir}\``,
            "",
            "**可复现文件**",
            `- \`${path.join(status.dir, "request.json")}\`：JASP 引擎分析请求`,
            `- \`${path.join(status.dir, "data.csv")}\`：数据快照`,
            `- \`${path.join(status.dir, "run_analysis.R")}\`：无头执行脚本`,
            "",
            "安装 R + jaspTools 后重跑本工具即可出数；也可用 `jasp_export` 导出模板，在 JASP GUI 中打开核对。",
          ].join("\n")
        );
      }

      return ok(
        [
          "### 已提交 JASP 分析",
          "",
          `- run_id：\`${status.run_id}\``,
          `- 分析：\`${status.analysis}\``,
          `- 状态：**running**`,
          "",
          `下一步：调用 \`jasp_run_status\`（session_id=\`${session.id}\`, run_id=\`${status.run_id}\`）轮询。`,
        ].join("\n")
      );
    } catch (err) {
      return fail(`❌ 提交失败：${err.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 10. 运行状态
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_run_status",
  {
    title: "查询运行状态",
    description: "查询 jasp_run 的执行状态（running/done/error/timeout/interrupted），并返回日志尾部。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      run_id: z.string().describe("运行 ID"),
    },
  },
  async ({ session_id, run_id }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    const dir = runDirOf(session, run_id);
    const status = getRunStatus(dir) || readStatus(dir);
    if (!status) return fail(`❌ 找不到运行 ${run_id}。`);

    const stderrTail = status.status === "error" ? logTail(path.join(dir, "stderr.log"), 1500) : "";
    return ok(
      [
        statusMarkdown(status),
        stderrTail ? `\n**stderr 尾部**\n\`\`\`\n${stderrTail}\n\`\`\`` : "",
        status.status === "done"
          ? `\n下一步：调用 \`jasp_get_results\`（session_id=\`${session_id}\`, run_id=\`${run_id}\`）。`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
);

// ---------------------------------------------------------------------------
// 11. 取结果
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_get_results",
  {
    title: "获取分析结果",
    description:
      "读取已完成的 JASP 结果，返回由 JASP 引擎生成的 Markdown 表格、图片、工件路径，并可配合 jasp_export 得到 .jasp。宿主应原样展示这些结果，不要改写数字、不要自行计算或下结论，也不要改用 Python 再算一遍。format=json 时返回原始 result.json 内容。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      run_id: z.string().describe("运行 ID"),
      format: z.enum(["markdown", "json"]).optional().describe("默认 markdown"),
    },
  },
  async ({ session_id, run_id, format }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    const dir = runDirOf(session, run_id);
    const status = getRunStatus(dir) || readStatus(dir);
    if (!status) return fail(`❌ 找不到运行 ${run_id}。`);

    const result = readResult(dir);
    const plan = status.plan_id ? session.plans?.[status.plan_id] : null;

    if (format === "json") {
      if (!result) return fail(`❌ 结果尚未生成（当前状态：${status.status}）。`);
      return ok(`\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
    }

    if (status.status === "running") {
      return fail(`⏳ 分析仍在运行。请稍后再次调用 \`jasp_run_status\`。`);
    }
    if (status.status === "dry_run") {
      return ok(
        [
          "### dry-run：未执行统计",
          "",
          `- 目录：\`${dir}\``,
          `- 请求：\`${path.join(dir, "request.json")}\``,
          `- 脚本：\`${path.join(dir, "run_analysis.R")}\``,
        ].join("\n")
      );
    }

    const text = resultMarkdown(result, { run: status, plan });
    const imageContent = [];
    for (const plot of (result.plots || []).slice(0, 6)) {
      if (!plot.file || !fs.existsSync(plot.file)) continue;
      try {
        if (fs.statSync(plot.file).size > 8 * 1024 * 1024) continue;
        imageContent.push({
          type: "image",
          data: fs.readFileSync(plot.file).toString("base64"),
          mimeType: plot.mime || "image/png",
        });
      } catch {
        // ignore unreadable plot
      }
    }

    if (imageContent.length > 0) {
      return { content: [{ type: "text", text }, ...imageContent] };
    }
    return ok(text);
  }
);

// ---------------------------------------------------------------------------
// 12. 导出
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_export",
  {
    title: "导出分析与工件",
    description:
      "导出 JASP 引擎请求（request.json）、分析模板（template.json）、R 执行脚本、Markdown 结果或结果表 CSV，便于复核与复用。",
    inputSchema: {
      session_id: z.string().describe("会话 ID"),
      plan_id: z.string().optional().describe("计划 ID（request/template/rscript 需要）"),
      run_id: z.string().optional().describe("运行 ID（markdown 需要）"),
      format: z
        .enum(["request", "template", "rscript", "markdown", "csv", "jasp", "bundle"])
        .describe(
          "导出格式；csv/markdown 需要 run_id；jasp 生成真正的 JASP 文件（含数据、选项，以及已有运行的结果）；bundle 生成复现包 zip"
        ),
    },
  },
  async ({ session_id, plan_id, run_id, format }) => {
    const { session, error } = sessionOrFail(session_id);
    if (error) return error;
    const outDir = exportsDir(session.id);

    try {
      if (format === "markdown") {
        if (!run_id) return fail("❌ format=markdown 需要 run_id。");
        const dir = runDirOf(session, run_id);
        const status = getRunStatus(dir) || readStatus(dir);
        const result = readResult(dir);
        const plan = status?.plan_id ? session.plans?.[status.plan_id] : null;
        const text = resultMarkdown(result, { run: status || {}, plan });
        const file = path.join(outDir, `${run_id}.md`);
        fs.writeFileSync(file, text, "utf8");
        return ok(`✅ 已导出：\`${file}\`\n\n${text}`);
      }

      if (format === "csv") {
        if (!run_id) return fail("❌ format=csv 需要 run_id。");
        const dir = runDirOf(session, run_id);
        const result = readResult(dir);
        if (!result) {
          const status = getRunStatus(dir) || readStatus(dir);
          return fail(
            `❌ 结果尚未生成（当前状态：${status?.status || "unknown"}）。请先完成 jasp_run。`
          );
        }

        const csvDir = path.join(exportsDir(session.id), `${run_id}-csv`);
        const files = exportTablesToCsv(result.tables, csvDir);
        if (files.length === 0) {
          return fail("❌ 结果里没有可导出的表格。");
        }

        return ok(
          [
            "### 已导出结果表 CSV",
            "",
            ...files.map(
              (file) =>
                `- \`${file.file}\`（${file.rows} 行 × ${file.columns} 列）`
            ),
            "",
            "> 文件带 UTF-8 BOM，Excel 直接打开中文不会乱码。",
          ].join("\n")
        );
      }

      if (!plan_id) return fail(`❌ format=${format} 需要 plan_id。`);
      const plan = session.plans?.[plan_id];
      if (!plan) return fail(`❌ 找不到计划 ${plan_id}。`);

      if (format === "request") {
        const request = buildRequest(plan);
        const file = path.join(outDir, `${plan_id}.request.json`);
        fs.writeFileSync(file, JSON.stringify(request, null, 2), "utf8");
        return ok(
          [
            `✅ 已导出 JASP 分析请求：\`${file}\``,
            "",
            requestMarkdown(request),
            "",
            "> 这是 JASP 引擎层的分析请求，不是 `.jasp` 归档。`.jasp` 归档请用 JASP 自身保存或重放。",
          ].join("\n")
        );
      }

      if (format === "jasp") {
        const request = buildRequest(plan);
        let resolvedRunId = run_id || null;
        let runDir = resolvedRunId ? runDirOf(session, resolvedRunId) : null;
        if (!runDir || !fs.existsSync(runDir)) {
          const latest = latestSuccessfulRun(session, plan_id);
          if (latest) {
            runDir = latest.dir;
            resolvedRunId = latest.run_id;
          } else {
            runDir = null;
          }
        }
        const dataPath =
          (runDir && fs.existsSync(path.join(runDir, "data.csv")))
            ? path.join(runDir, "data.csv")
            : plan.data_ref;
        if (!dataPath || !fs.existsSync(dataPath)) {
          return fail("❌ 找不到分析使用的数据文件（先执行 jasp_run 或加载数据）。");
        }
        const result = runDir ? readResult(runDir) : null;
        const artifacts = collectJaspRunArtifacts(result, runDir);
        const buffer = buildJaspFile({
          session,
          plan,
          request,
          dataPath,
          description: `由 jasp-bridge 生成：${plan.label || request.name}（数据集 ${session.data?.n ?? "?"} 行）`,
          results: artifacts.results,
          jaspResults: artifacts.jaspResults,
          resources: artifacts.resources,
        });
        const file = path.join(outDir, `${plan_id}${resolvedRunId ? `-${resolvedRunId}` : ""}.jasp`);
        fs.writeFileSync(file, buffer);
        const hasResults = Boolean(artifacts.results || artifacts.jaspResults);
        return ok(
          [
            `✅ 已导出 JASP 文件：\`${file}\``,
            "",
            "- 这是 JASP 0.99 归档格式（analyses.json + internal.sqlite），可直接用 JASP 打开。",
            hasResults
              ? "- 已写入分析结果（analyses.json 的 results + resources/0/jaspResults.json），打开即可查看。"
              : "- 未找到对应运行的结果，文件只包含数据与分析选项；JASP 打开时会尝试重新计算。",
            `- 数据：${dataPath}`,
          ].join("\n")
        );
      }

      if (format === "bundle") {
        const request = buildRequest(plan);
        const runDir = run_id ? runDirOf(session, run_id) : null;
        const { buffer, files } = buildJaspBundle({
          plan,
          request,
          runDir,
          dataPath: plan.data_ref,
          runId: run_id || null,
        });
        const file = path.join(outDir, `${plan_id}${run_id ? `-${run_id}` : ""}.jasp-bundle.zip`);
        fs.writeFileSync(file, buffer);
        return ok(
          [
            `✅ 已导出 JASP 复现包：\`${file}\``,
            "",
            `- 包内文件：${files.join("、")}`,
            "",
            "> 复现包包含数据快照、分析登记与 R 脚本；不需要 JASP 文件时用它做归档。",
          ].join("\n")
        );
      }

      if (format === "template") {
        const template = buildTemplate(plan);
        const file = path.join(outDir, `${plan_id}.template.json`);
        fs.writeFileSync(file, JSON.stringify(template, null, 2), "utf8");
        return ok(
          [
            `✅ 已导出分析模板：\`${file}\``,
            "",
            "模板包含分析名、选项与数据变量要求，可用于人工在 JASP 中复现，或作为 P1 `.jasp` 重放模板的蓝本。",
          ].join("\n")
        );
      }

      // rscript
      const scriptSrc = fileURLToPath(
        new URL("../scripts/run_analysis.R", import.meta.url)
      );
      const scriptFile = path.join(outDir, `${plan_id}.run_analysis.R`);
      fs.copyFileSync(scriptSrc, scriptFile);
      const request = buildRequest(plan);
      const requestFile = path.join(outDir, `${plan_id}.request.json`);
      fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), "utf8");
      const command = `Rscript --vanilla "${scriptFile}" "${requestFile}" "<data.csv>" "<result.json>"`;
      const commandFile = path.join(outDir, `${plan_id}.command.txt`);
      fs.writeFileSync(commandFile, `${command}\n`, "utf8");
      return ok(
        [
          "✅ 已导出可复现 R 工件",
          "",
          `- 脚本：\`${scriptFile}\``,
          `- 请求：\`${requestFile}\``,
          `- 命令：\`${commandFile}\``,
          "",
          "```bat",
          command,
          "```",
        ].join("\n")
      );
    } catch (err) {
      return fail(`❌ 导出失败：${err.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 13. JASP CLI 模板重放
// ---------------------------------------------------------------------------
server.registerTool(
  "jasp_run_template",
  {
    title: "用 JASP 模板生成报告",
    description:
      "用已有 .jasp 模板调用本机 JASP 的 --report 模式，导出 report.pdf、HTML dashboard 与结果 JSON。适合固定分析流程的复核与出报告。",
    inputSchema: {
      template_path: z.string().describe("已有 .jasp 模板路径"),
      output_dir: z.string().optional().describe("结果输出目录"),
      data_dir: z.string().optional().describe("兼容参数：JASP 0.99.x 的 CLI 尚不支持替换数据目录"),
      hide: booleanArg("是否传 --hide（0.99.10 上可能导致崩溃，默认 false）"),
      timeout_ms: z.number().int().optional().describe("超时毫秒，默认 600000"),
    },
  },
  async ({ template_path, output_dir, data_dir, hide, timeout_ms }) => {
    try {
      const outputDir =
        output_dir ||
        path.join(
          ensureDir(path.join(HOME_DIR, "template-runs")),
          `run_${Date.now().toString(36)}`
        );
      const result = await runTemplate({
        templatePath: path.resolve(template_path),
        dataDir: data_dir ? path.resolve(data_dir) : null,
        outputDir: path.resolve(outputDir),
        hide: Boolean(hide),
        timeoutMs: timeout_ms ?? 600000,
      });

      const lines = [
        "### JASP 报告生成",
        "",
        `- 退出码：${result.exit_code}${result.timed_out ? "（超时）" : ""}`,
        `- 完成标记：${result.completed ? "✅ report.complete" : "❌ 未生成 report.complete"}`,
        `- 命令：\`${result.command}\``,
        result.report_pdf ? `- PDF：\`${result.report_pdf}\`` : "",
        result.summary?.path
          ? `- 结果 JSON：\`${result.summary.path}\`（${result.summary.analyses.length} 个分析）`
          : "",
        "",
        "**输出文件**",
        ...(result.output_files.length
          ? result.output_files.map((file) => `- \`${file}\``)
          : ["- 未发现输出文件，请检查 JASP CLI 参数或查看 stderr。"]),
        result.summary?.analyses?.length
          ? `\n**报告中的分析**\n${result.summary.analyses
              .map((analysis) => `- ${analysis.name}（${analysis.module || "?"} ${analysis.module_version || ""}）`)
              .join("\n")}`
          : "",
        result.data_dir_ignored
          ? "\n> 注意：当前 JASP 0.99.x CLI 不支持 `--inputDataDir`，`data_dir` 未生效；模板会使用自身内嵌数据。"
          : "",
        result.stderr ? `\n**stderr**\n\`\`\`\n${result.stderr.slice(0, 1500)}\n\`\`\`` : "",
      ].filter(Boolean);

      if (result.exit_code !== 0 || !result.completed) {
        return fail(lines.join("\n"));
      }
      return ok(lines.join("\n"));
    } catch (error) {
      return fail(`❌ 模板重放失败：${error.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
process.on("uncaughtException", (error) => {
  console.error(`[jasp-bridge] uncaught: ${error.stack || error.message}`);
});
process.on("unhandledRejection", (error) => {
  console.error(`[jasp-bridge] unhandled: ${error?.stack || error}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[jasp-bridge] v${PLUGIN_VERSION} ready (stdio)`);

if (process.env.JASP_BRIDGE_PREWARM !== "0") {
  ensureWorker()
    .then(() => console.error("[jasp-bridge] R worker ready"))
    .catch((error) =>
      console.error(`[jasp-bridge] R worker prewarm skipped: ${error.message}`)
    );
}
