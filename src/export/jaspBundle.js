import fs from "node:fs";
import path from "node:path";

import { PLUGIN_NAME, PLUGIN_VERSION, nowIso } from "../config.js";
import { createZip } from "./zip.js";

function readIfExists(file) {
  try {
    if (file && fs.existsSync(file)) return fs.readFileSync(file);
  } catch {
    // ignore
  }
  return null;
}

function bundleReadme({ plan, request, runId }) {
  const analysis = request?.name || plan?.jasp?.analysis || "JASP analysis";
  const module = request?.module || plan?.jasp?.module || "";
  const options = JSON.stringify(request?.options || {}, null, 2);

  return `# JASP 复现包（jasp-bridge）

本包由 **${PLUGIN_NAME} v${PLUGIN_VERSION}** 于 ${nowIso()} 生成，包含一次分析的全部可复现信息。

## 为什么不是 .jasp 文件

JASP 的 \`.jasp\` 是 **ZIP 归档**，内部包含 \`internal.sqlite\`（数据与列元数据）与
\`resources/N/jaspResults.json\`（结果）。目前：

- \`jaspTools\` 只提供**读取/重跑**能力，没有公开的写盘 API；
- JASP CLI 的 \`--report\` 只能导出**模板里已有**的结果，不能用新数据重算；
- \`internal.sqlite\` 的表结构未公开，插件不伪造二进制归档（生成的 .jasp 可能打不开）。

因此这里导出的是**可复现包**：同样的数据 + 同样的分析选项 + 同样的 R 脚本。

## 目录

| 文件 | 说明 |
| --- | --- |
| \`data.csv\` | 本次分析使用的数据快照（UTF-8） |
| \`analyses.json\` | JASP 风格的分析登记（name / module / options） |
| \`request.json\` | JASP 引擎层请求（jaspTools 直接消费） |
| \`run_analysis.R\` | 可独立运行的 R 脚本（无头执行同一分析） |
| \`result.json\` | 本次运行的结果表（若有） |
| \`meta.json\` | 包元信息 |

## 在 JASP GUI 里复现

1. 打开 JASP → **Open** → 导入 \`data.csv\`；
2. 按 \`analyses.json\` 里的 \`options\` 设置同一个分析（模块：${module || "?"}，分析：${analysis}）；
3. 核对变量类型（与 \`request.json\` 中的 \`*.types\` 一致）；
4. **File → Save as** 即可得到真正的 \`.jasp\` 文件。

## 直接用 R 重跑

\`\`\`powershell
Rscript run_analysis.R request.json data.csv result.json
\`\`\`

${runId ? `对应运行 ID：\`${runId}\`\n` : ""}
## 关键选项

\`\`\`json
${options}
\`\`\`
`;
}

/**
 * Build a zip bundle that lets the user reproduce the analysis in JASP.
 */
export function buildJaspBundle({ plan, request, runDir, dataPath, runId }) {
  const files = [];

  const data = readIfExists(runDir ? path.join(runDir, "data.csv") : null) ||
    readIfExists(dataPath);
  if (data) files.push({ name: "data.csv", data });

  const requestFile = readIfExists(runDir ? path.join(runDir, "request.json") : null);
  const requestText = requestFile
    ? requestFile.toString("utf8")
    : `${JSON.stringify(request, null, 2)}\n`;
  files.push({ name: "request.json", data: requestText });

  const analyses = [
    {
      id: plan?.id || runId || "analysis-1",
      name: request?.name || plan?.jasp?.analysis,
      title: plan?.label || request?.name,
      module: request?.module || plan?.jasp?.module,
      version: PLUGIN_VERSION,
      status: "proposed",
      options: request?.options || {},
    },
  ];
  files.push({ name: "analyses.json", data: `${JSON.stringify(analyses, null, 2)}\n` });

  const script = readIfExists(runDir ? path.join(runDir, "run_analysis.R") : null);
  if (script) files.push({ name: "run_analysis.R", data: script });

  const result = readIfExists(runDir ? path.join(runDir, "result.json") : null);
  if (result) files.push({ name: "result.json", data: result });

  files.push({
    name: "meta.json",
    data: `${JSON.stringify(
      {
        schema: "jasp-bridge/jasp-bundle@1",
        plugin: PLUGIN_NAME,
        plugin_version: PLUGIN_VERSION,
        created_at: nowIso(),
        analysis: request?.name || plan?.jasp?.analysis,
        module: request?.module || plan?.jasp?.module,
        plan_id: plan?.id || null,
        run_id: runId || null,
        note: "JASP 复现包；不是 .jasp 文件，详见 README.md。",
      },
      null,
      2
    )}\n`,
  });

  files.push({
    name: "README.md",
    data: bundleReadme({ plan, request, runId }),
  });

  return { buffer: createZip(files), files: files.map((file) => file.name) };
}
