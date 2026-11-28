# Changelog

## Unreleased

### 方法顾问

- 用户只有数据、尚未说明实验设计（例如只说「帮我分析」或「我只有数据，不清楚实验设计」）时，只要已经加载表格，就不再报「无法识别分析类型」。插件会先对合适的测量列给出描述统计（排除明显的编号列；能从列名识别的人口学变量也可纳入），再根据表格形态列出几种说得通的候选方法，全部需要确认后才执行。
- 宽格式、看起来像组内时，建议重复测量方差分析，两个水平可同时说明配对 t 作为备选；看起来像组间时，两组用独立样本 t，多于两组用方差分析；看起来像长格式组内时，说明当前重复测量方差分析不能直接跑长格式，可考虑混合模型或先整理成宽格式（只建议，不会自动改数据）；形态不清时仍给出描述统计，并请用户确认设计和因变量。
- 题项看起来像同一量表时，会询问是否先做信度或再合成均分，不会自动计分或反向计分。不会为了能跑而建议把名义人口学变量改成连续变量。
- 措辞保持保守，只说「表格看起来像……」，不把推断说成已经确定的实验设计。用户已经说明设计或变量时，仍按 0.3.4 的顾问逻辑核实、提醒不匹配，以及说明多因素组内目前不能跑。

## 0.3.4 - 2026-11-27

提高对实验描述和数据列的可识别度，并在未点名方法时给出可确认的方法建议。分析类型仍为 **22 类**，MCP 工具仍为 **16 个**，版本号是 **0.3.4**，不是 3.0.0。这不是新方法包。

### 方法顾问

- 插件会对照已加载的表格核实用户原话里的因变量、实验设计（组内 / 组间等）和人口学变量，再推荐当前 22 类方法里真正能跑的、可确认的分析计划。
- 「组内」与「被试内」「重复测量」「within-subjects」视为同一类组内设计；「组间 / 被试间」同理。不必每次都先说出方法名：描述实验情景后，插件会给出建议步骤（通常先描述统计，再比较不同条件），仍须确认后才执行。
- 口语别名在唯一对应时能对上表格列名或变量标签，例如「反应时」对上 `rt`、「正确率」对上 `acc`、「学历」对上 `education`。对不上或多列冲突时会提问，不会偷偷选定。提到的实验素材或刺激通常不是数据列，不会当作变量。
- 计划会说明为什么用这个方法、还有哪些备选，以及和表格对不上时的提醒（例如声称组内但数据更像组间，或提到的人口学变量在表里没有）。两个组内水平时，会说明也可以用配对 t 检验，并提醒不要用独立样本 t 检验。
- 前缀相近的题项会提示「看起来可能属于同一量表，是否先算总分或均分」。这只是建议，插件不会自动计算总分，也不会自行反向计分。
- 已知限制：多因素组内设计（如 2×3）目前不能跑；重复测量方差分析需要宽格式，且只支持一个组内因子，可叠加最多 2 个组间因子。

### 文档与发布

- GitHub Release `v0.3.4` 提供含 Windows `node.exe` 的便携 zip 与 `latest.json`（不含 JASP 运行时）。

## 0.3.3 - 2026-11-27

修复生成的 `.jasp` 里结果表把变量名写成 `jaspColumnN` 的问题，并补上变量标题与 SPSS 值标签。分析类型仍为 **22 类**，版本号是 **0.3.3**，不是 3.0.0。

### `.jasp` 变量名

- 分析引擎内部仍会把列名临时编码为 `jaspColumn1` 这类名字。此前只有对话里的结果表和 CSV 会还原，写入 `.jasp` 的查看器结果（`analyses.json`）和 `jaspResults.json` 仍是编码名，用 JASP 打开时表标题和单元格会显示 `jaspColumn1`，而不是原始变量名（例如 `bdi`、`gender`）。
- 现已在导出时把这些结果还原为原始变量名；内部对象 id（如 `..._jaspColumn21`）保持不变，以免把 `jaspColumn2` 误替换进 `jaspColumn21`。
- 同时把数据字典中的变量标签写成列的 `title`，并把 SPSS 值标签写入 Labels 表（例如 0/1 显示为 Male/Female）。若变量标签其实是值编码（如错误地写成 `"0"`），则仍使用列名作为标题。
- 已经画进 PNG 的图轴文字无法事后改掉；新导出的表和图标题会使用原始变量名。若图里仍看到编码名，在 JASP 中 Refresh 即可按原始列名重算。

### 文档与发布

- GitHub Release `v0.3.3` 提供含 Windows `node.exe` 的便携 zip 与 `latest.json`（不含 JASP 运行时）。

## 0.3.2 - 2026-11-27

把描述统计的耗时选项改为与官方 JASP 一致的默认关闭，加快题项较多时在 WorkBuddy 里的运行速度。分析类型仍为 **22 类**，版本号是 **0.3.2**，不是 3.0.0。

### 描述统计速度

- 描述统计的 Shapiro-Wilk 正态检验（`shapiroWilkTest`）和矩阵散点图（`matrixPlot`）改为默认关闭，与官方 JASP 一致。此前默认打开时，一次放入较多题项（例如 40 道题）可能拖到数分钟。
- 用户或计划里显式打开，或在对话中明确要求正态检验 / 矩阵散点图时，这两项仍会打开并写入 JASP 请求。
- 当分析变量达到或超过 **15** 个，并且仍打开这两项时，计划会提醒可能较慢，但不会悄悄取消用户的明确要求。15 的依据：矩阵散点图会生成 p(p-1)/2 张成对图，15 个变量即 105 张；心理量表单个分量表也常见不超过 15 题。
- 需要这两项时，可在计划选项中打开，或直接说“做 Shapiro-Wilk / 看正态性”“画矩阵散点图”。变量很多时建议按分量表分开跑。

### 文档与发布

- GitHub Release `v0.3.2` 提供含 Windows `node.exe` 的便携 zip 与 `latest.json`（不含 JASP 运行时）。

## 0.3.1 - 2026-11-27

把已在 main 上的两项改动做成正式发布：MCP 宿主参数类型强制修复，以及 Excel / SPSS 数据文件直接读取。分析类型仍为 **22 类**，版本号是 **0.3.1**，不是 3.0.0。

### 数据读入

- 可以直接加载 Excel（`.xlsx` / `.xls` / `.xlsm`）和 SPSS（`.sav`）数据文件，与原有 CSV / TSV / JSON 走同一套变量字典、类型推断、计划和分析流程。
- 多工作表 Excel 默认读取第一张表；`jasp_load_data` 增加 `sheet` 参数，可按表名或从 1 开始的序号指定。找不到表、第一张表为空时，会列出可用工作表。
- `.sav` 会保留变量标签、值标签和 measure 类型（`nominal` / `ordinal` / `scale`）；写入内部 CSV 快照时仍使用原始编码值，标签显示在数据字典中。显式 `types` 覆盖仍然优先。
- 密码保护或加密的 Excel 工作簿、损坏文件会给出明确中文报错；`.xlsm` 只读单元格数据，不执行宏。
- 实现取舍：若本机 JASP/R 运行时已安装 `haven` / `readxl`，优先用它们读取（更贴近 JASP）；否则（以及测试环境）使用 Node 库 `@irbisadm/statfmt`（MIT，ReadStat 移植，与 haven 同源）和 `@e965/xlsx`（Apache-2.0，SheetJS 社区版的安全修补分发）。可用环境变量 `JASP_BRIDGE_TABULAR=node|r|auto` 强制选择。

### 修复

- 部分 MCP 宿主会把字符串数组改写成 `{"0":"a","1":"b"}` 这类对象，并把布尔值传成 `"true"` / `"false"` 字符串。`jasp_plan_analysis` / `jasp_update_plan` 的变量参数会因此在校验阶段报 “expected array”，而选项里的 `"false"` 会原样进入 JASP，触发 `!optionToCheck: invalid argument type` 致命错误。现已在参数校验前和写入引擎请求前把这两类值还原。

### 文档与发布

- GitHub Release `v0.3.1` 提供含 Windows `node.exe` 的便携 zip 与 `latest.json`（不含 JASP 运行时）。


## 0.3.0 - 2026-11-26

按 3.0 方向做了两件核心改动：更稳妥的变量类型推断，以及由插件给出可确认的分析方案。本版本号是 **0.3.0**，不是 3.0.0。

### 类型推断

- 不再仅凭唯一值数量把数值列判成有序变量。
- 带小数的量表均分、总分等连续分数，即使唯一值不超过 10 个，也推断为 `scale`（源文本里的 `4.0` 同样视为连续）。
- 1–5、1–7、0–10 等整数题项仍为 `ordinal`；小样本只出现部分水平（例如只出现 4 和 5）时也保持有序。
- 年龄、测验总分等取值较少、但范围明显不是量表题的整数列，推断为 `scale`。
- 0/1、1/2 这类典型二分编码仍为 `nominal`。显式 `types` 覆盖仍然优先。

### 可确认的分析方案

- 用户要做 EFA / PCA / CFA / SEM（以及 PLS-SEM、信度）但未指定题项或因子结构时，插件会根据列名、前缀和类型提出建议题项、因子结构和关键选项。
- 建议在计划中明确标为「建议，待确认」，不是已确认的事实；状态为 `proposed`，须经 `jasp_confirm_plan` 确认后才执行，也可用 `jasp_update_plan` 修改。
- 宿主提示词与工具说明已加强：统计数字、表、图和 `.jasp` 只能来自插件调用的 JASP 引擎；宿主只负责转发和展示，不要自行计算或改用 Python 做旁路分析。

### 文档与发布

- 方法列表文案此前已更正（不再把已封装方法写成「暂未封装」）；本版本文档已按新的类型推断和计划建议同步。
- GitHub Release `v0.3.0` 提供含 Windows `node.exe` 的便携 zip 与 `latest.json`（不含 JASP 运行时）。

尚未纳入本版本（仍属后续 3.0 工作）：测量等值、元分析、功效分析、更接近 APA 的表格、图中使用可读变量名（而非编码后的 `jaspColumnN`）、以及更稳定地打开 `.jasp` 文件。

## 0.2.0 - 2026-11-25

分析类型从 8 类扩到 **22 类**，并补齐事后比较、简单效应、对比，以及真正的 `.jasp` 结果写入。

### 频率派扩展（8 → 17）

- 新增 `rm_anova`（重复测量方差分析）：宽格式单元格、单被试内因子、可选组间因子（混合设计）、球形检验、Greenhouse-Geisser 校正、偏 eta²、事后比较；
- 新增 `process`（JASP ClassicProcess）：Model 1 调节、4 简单中介、6 链式中介、7/8/14/15 有调节的中介，含 bootstrap 间接效应 CI、简单斜率、调节中介指数、R² 与概念路径图；对话中提到缺失或 FIML 时可用 FIML；
- 新增 `efa` / `pca` / `cfa`（jaspFactor）：探索性因子分析、主成分分析、验证性因子分析（EFA/PCA 至少 3 个观测变量；CFA 需 `options.factors`）；
- 新增 `sem` / `plssem`（jaspSem）：结构方程与偏最小二乘结构方程，`options.models` 传 lavaan / PLS 语法，插件自动转换成 JASP 的语法表结构；
- 新增 `mixed_lmm` / `mixed_glmm`（jaspMixedModels）：线性与广义线性混合模型，随机截距，可选随机斜率。

### 贝叶斯、MIMIC 与增长曲线（17 → 22）

- 新增 `process_bayesian`（JASP BayesianProcess，Hayes 模型与频率派 Process 相同）、`mixed_blmm`（MixedModelsBLMM / rstanarm）、`mimic`（jaspSem::MIMIC）、`latent_growth`（LatentGrowthCurve）。均已用本机 JASP 运行时实测：MIMIC/LGC 拟合指数与路径表完整；BLMM 与贝叶斯 Process 完成 MCMC 并写出后验估计、可信区间与 R̂。
- 新增 `mixed_bglmm`（JASP MixedModelsBGLMM / rstanarm），分析类型从 21 扩到 **22**。支持 Bernoulli、Poisson、高斯等分布族；计划器把“贝叶斯广义/二项混合”优先于普通贝叶斯线性混合模型。
- 计划器优先识别「贝叶斯中介/调节」「贝叶斯混合」「MIMIC」「潜变量增长曲线」；频率派 Process / LMM / SEM 原有路径不变。BayesianProcess 写入 jaspProcess 默认先验（beta/nu/psi/rho），避免 blavaan 语法翻译失败。

### 事后比较与简单效应

- 单因素 `anova` 自动追加事后比较（水平数 > 2 或用户明确要求），支持 Tukey / Holm / Bonferroni / Scheffé / Šidák；重复测量另支持 FDR；
- 简单效应：支持一个因子在另一个因子的各水平上比较（含第二个调节因子），重复测量可反向（组间因子在各时间点上）；
- 对比（contrast）：支持 Helmert / 多项式 / 重复 / 差异 / 偏差 / 简单预设类型，并可通过 `options.contrasts` + `options.customContrasts` 传入任意系数矩阵；
- 两因素及以上 ANOVA 自动补齐主效应项与全部交互项。

### 工具、`.jasp` 写盘与文档

- `jasp_export(format="jasp")` 生成真正的 `.jasp` 归档：写入查看器结果（`analyses.json` 的 `results`，`status=complete`）和官方内部 `resources/N/jaspResults.json` 及完成标记；指定 `run_id`，否则用该计划最近一次成功运行。JASP 0.99.10 对 ANOVA 示例打开并 Refresh 可显示已写入的结果；
- 同时仍导出 JASP 复现包（zip，含 data.csv / analyses.json / request.json / run_analysis.R / result.json / README）；
- 结果表中的编码列名（`jaspColumnN`）自动还原为原始变量名，覆盖表标题、表头与 CSV 文件名；
- 新增进度接口：`npm run progress` 起一个只读 HTTP 端口，并新增 MCP 工具 `jasp_progress`；`PROGRESS.json` 作为进度事实来源；
- 重新生成 `docs/visual-guide.html` 与 `docs/visual-guide.pdf`（版本 0.2.0，覆盖全部 22 类分析、开口示例与安装路径）；
- 新增示例数据 `examples/factor-demo.csv`（两因子结构）与 `examples/mixed-demo.csv`（12 被试 × 4 时点）。
- 在 GitHub 公开发布：https://github.com/nanple/jasp-bridge ；Release `v0.2.0` 提供含 `node.exe` 的便携 zip 与 `latest.json`（不含 JASP 运行时）。

### 修复与运行时补丁

- 计划器支持 `sat1 到 sat5` 这类区间变量写法，并优先识别“重复测量 / 被试内 / 配对 / ANCOVA / 中介”等方法短语；
- 分析核心跳过 JASP 的结构化默认值（空的 `postHocTerms` / `marginalMeanTerms` 等），避免 JASP 把空项当成名为 `variable` 的因子而崩溃；
- `jaspBase::.checkVariance` 兼容 R ≥ 4.5（`var(factor)` 已废弃），混合模型的全列方差检查不再报错；
- 混合模型运行时 attach `lme4`（模块调用 lme4 内部函数不带命名空间前缀）；
- 修复 `run_analysis.R` 一次性回退在加载运行时前检查 `jsonlite` 导致误报的问题。

## 0.1.0 - 2026-11-24

首个可运行版本：

- WorkBuddy MCP 插件骨架，提供 15 个工具；
- 8 类 JASP 分析：描述统计、信度、相关、独立样本 t 检验、配对样本 t 检验、ANCOVA、单因素 ANOVA、线性回归；
- 结果表导出 CSV（UTF-8 BOM，Excel 可直接打开）；
- JASP 图片回传（PNG/SVG）与 `plots/` 工件；
- 分析计划确认与增量修改；
- 从本机 JASP 构建离线运行时（`setup_runtime.ps1`）；
- 常驻 R worker，首次加载后复用；
- 模板报告模式（JASP `--report`）；
- 便携 zip 安装（方案 B）；
- 更新检查与下载：`jasp_check_update`、`jasp_download_update`、`update.ps1`；
- 随包指南 `GUIDE.md` 与示例数据 `examples/demo.csv`；
- DeepSeek / 豆包支持方案与 `configs/` 配置模板。
