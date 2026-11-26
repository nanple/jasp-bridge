import fs from "node:fs";
import { mdTable, truncate } from "../format.js";

export function tableToRows(table) {
  const data = table?.data;
  if (Array.isArray(data)) {
    if (data.length === 0) return { headers: [], rows: [] };
    if (Array.isArray(data[0])) {
      return { headers: data[0].map(String), rows: data.slice(1) };
    }
    const headers = Object.keys(data[0]);
    return { headers, rows: data.map((row) => headers.map((header) => row[header])) };
  }
  if (data && typeof data === "object") {
    const headers = Object.keys(data);
    if (headers.length === 0) return { headers: [], rows: [] };
    const lengths = headers.map((header) => (Array.isArray(data[header]) ? data[header].length : 1));
    const rowCount = Math.max(...lengths);
    const rows = Array.from({ length: rowCount }, (_, index) =>
      headers.map((header) => (Array.isArray(data[header]) ? data[header][index] : data[header]))
    );
    return { headers, rows };
  }
  return { headers: [], rows: [] };
}

export function tablesToMarkdown(tables, options = {}) {
  const maxTables = options.maxTables ?? 12;
  const maxRows = options.maxRows ?? 30;
  const maxColumns = options.maxColumns ?? 14;
  if (!tables || typeof tables !== "object") return "";

  const entries = Object.entries(tables).filter(([, table]) => {
    const { rows } = tableToRows(table);
    return rows.length > 0;
  });
  if (entries.length === 0) return "_JASP 未返回可解析的表格（可能只生成了图）。_";

  const blocks = [];
  for (const [name, table] of entries.slice(0, maxTables)) {
    const { headers, rows } = tableToRows(table);
    const useHeaders = headers.slice(0, maxColumns);
    const useRows = rows.slice(0, maxRows).map((row) => row.slice(0, maxColumns));
    blocks.push(
      [
        `#### ${table.title || name || "结果表"}`,
        mdTable(useHeaders, useRows),
        rows.length > maxRows ? `_（仅显示前 ${maxRows} 行，共 ${rows.length} 行）_` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  if (entries.length > maxTables) {
    blocks.push(`_（另有 ${entries.length - maxTables} 张表未显示，可在 result.json 中查看）_`);
  }
  return blocks.join("\n\n");
}

export function resultMarkdown(result, context = {}) {
  const { run = {}, plan = null } = context;
  if (!result) {
    return [
      "### JASP 结果尚未生成",
      "",
      `- 运行：\`${run.run_id || "unknown"}\``,
      `- 状态：**${run.status || "unknown"}**`,
      run.error ? `- 错误：${run.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (result.status === "partial") {
    return [
      "### JASP 分析完成（部分输出）",
      "",
      `- 分析：\`${result.analysis || run.analysis || "unknown"}\``,
      `- JASP 状态：${result.jasp_status || "unknown"}`,
      result.error_message ? `- 警告：${result.error_message}` : "",
      run.dir ? `- 工件目录：\`${run.dir}\`` : "",
      "",
      tablesToMarkdown(result.tables),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (result.status !== "ok") {
    return [
      "### JASP 运行失败",
      "",
      `- 分析：\`${result.analysis || run.analysis || "unknown"}\``,
      `- JASP 状态：${result.jasp_status || "unknown"}`,
      `- 错误：${result.message || result.error_message || "未知错误"}`,
      result.call ? `- 调用：\`${result.call}\`` : "",
      "",
      "**建议**：先用 `jasp_status` 检查运行时；若提示选项不存在，可导出请求 JSON 后在 JASP GUI 中核对选项名。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const lines = [
    "### JASP 分析结果",
    "",
    `- 分析：\`${result.analysis}\``,
    `- 状态：**完成**`,
    `- 随机种子：${result.seed ?? 1}`,
    `- 环境：${result.versions?.R || "R"} / jaspTools ${result.versions?.jaspTools || "?"}`,
    plan ? `- 计划：\`${plan.id}\`（${plan.label}）` : "",
    run.dir ? `- 工件目录：\`${run.dir}\`` : "",
    "",
    tablesToMarkdown(result.tables),
    ...(Array.isArray(result.plots) && result.plots.length > 0
      ? [
          "",
          "**图**",
          ...result.plots.map(
            (plot) => `- ${plot.title || "图"}：\`${plot.file || ""}\``
          ),
        ]
      : []),
  ];
  return lines.filter(Boolean).join("\n");
}

export function statusMarkdown(status) {
  if (!status) return "找不到该运行记录。";
  const lines = [
    `- 运行：\`${status.run_id}\``,
    `- 分析：\`${status.analysis}\``,
    `- 状态：**${status.status}**`,
    `- 开始：${status.started_at}`,
    status.finished_at ? `- 结束：${status.finished_at}` : "",
    status.error ? `- 错误：${status.error}` : "",
    status.dir ? `- 目录：\`${status.dir}\`` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function logTail(filePath, maxChars = 2000) {
  try {
    return truncate(fs.readFileSync(filePath, "utf8"), maxChars);
  } catch {
    return "";
  }
}
