# JASP-Bridge 实用指南

版本：0.3.4（2026-11-27）  
适用：WorkBuddy + 本机 JASP（Windows 10/11 64 位）

> 图文版：浏览器打开 `docs/visual-guide.html`，或直接看 `docs/visual-guide.pdf`。
>
> **WorkBuddy 实际加载的是本机安装目录** `%USERPROFILE%\.workbuddy\jasp-bridge`，不是桌面上的 `JASP-Bridge` 文件夹。桌面这份是文档和便携安装包；只更新桌面文件，不会自动更新正在运行的插件。

---

## 1. 这是什么

JASP-Bridge 是一个 WorkBuddy 的 MCP 插件。它把自然语言请求整理成统计计划，再调用**本机 JASP 的 R 引擎**执行分析，最后把结果表返回对话。

它不是把 JASP 图形界面嵌进 WorkBuddy，也不是用 Python 重新实现统计。正常分析时不会弹出 JASP 窗口；只有“用已有 `.jasp` 模板导出报告”时才会调用 JASP 桌面程序。插件是分析的支配方：先读数据、给出可确认的方案，你确认后再由 JASP 出表、图和 `.jasp`。WorkBuddy 只负责转发和展示，不要自行计算或改用 Python 做旁路分析。

一句话：

> 你描述研究问题，插件负责计划和调用，JASP 负责出数。

---

## 2. 适合谁

- 心理学、教育学、社会学、管理学等需要做量化分析的研究者；
- 不想学 R，也不想每次手点 JASP 菜单的人；
- 希望分析过程可追溯、可复现的人；
- 数据不能上传到云端的人。

不适合：

- 需要 JASP 图形界面交互式探索的人；
- 需要 JASP 尚未封装的分析（例如贝叶斯广义混合模型之外的自定义 Stan 模型），或坚持只用图形界面点选的人；
- 需要密码保护的 Excel 工作簿、或必须保留宏逻辑（而不仅是单元格数据）的人。

---

## 3. 30 秒判断能不能用

| 条件 | 要求 |
| --- | --- |
| 操作系统 | Windows 10/11 64 位 |
| WorkBuddy | 已安装并能正常对话 |
| JASP | 已安装（Microsoft Store 或官网桌面版） |
| 数据格式 | CSV / TSV / JSON / Excel（.xlsx .xls） / SPSS（.sav） |
| 是否需要 R | 不需要单独安装；安装脚本会从本机 JASP 复制 |
| 是否需要 GitHub | 不需要；安装和运行都是本地 |
| 是否需要联网 | 安装包下载需要；运行分析不需要 |

---

## 4. 安装

### 4.1 超级简单版：把安装包直接发给 WorkBuddy

如果你的 WorkBuddy 版本允许执行本地命令或文件操作，可以把 `jasp-bridge-0.3.4-portable.zip` 拖进对话框，然后发：

```text
这是我下载的 JASP-Bridge 安装包。请帮我：
1. 解压到一个合适的位置；
2. 检查我电脑上是否安装了 JASP；
3. 如果已安装，运行包里的 install.ps1 完成安装；
4. 安装完成后告诉我怎么验证。
不要覆盖已有的 runtime 和 sessions。
```

WorkBuddy 可能会询问文件保存位置、请求运行 PowerShell 的权限；按提示允许即可。

安装完成后，直接说：

```text
检查 JASP 状态
```

如果当前 WorkBuddy 不能执行本地命令，它会退回下面的手动三步。

### 4.2 手动三步（不需要记路径）

1. 解压 zip；
2. 在解压后的文件夹空白处 `Shift + 右键`，选择“在终端中打开”或“在此处打开 PowerShell 窗口”；
3. 运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

不需要 `cd` 到某个固定目录，也不需要改脚本里的路径。

如果系统提示“禁止运行脚本”，就用上面这条带 `-ExecutionPolicy Bypass` 的命令。

安装完成后重启 WorkBuddy，问：

```text
检查 JASP 状态
```

### 4.3 路径怎么填（不要照抄示例）

指南里的 `<...>` 都是占位符，必须换成你自己的路径。例如：

```text
加载 <你的数据文件.csv>，先看变量情况
```

获取路径的三种方法：

1. 在资源管理器里 `Shift + 右键` 文件 → “复制文件地址”；
2. 在 PowerShell 里输入 `cd `，然后把文件夹拖进窗口；
3. 直接把文件拖进 WorkBuddy 对话框，让它读取。

路径有空格时，用英文引号包起来。

### 4.4 JASP 不在默认位置时

大多数用户不需要这一步：安装脚本会自动找 Microsoft Store 版和常见桌面版路径。

只有自动识别失败时，才需要把下面的占位符换成你自己的 JASP 路径：

```powershell
.\install.ps1 -JaspPath "<你的JASP安装目录>\JASPDesktop.exe"
```

不要照抄示例里的盘符，除非你的 JASP 真的装在那里。

### 4.5 已安装过，只更新插件

```powershell
.\install.ps1 -SkipRuntime
```

安装后，WorkBuddy 加载的是 `%USERPROFILE%\.workbuddy\jasp-bridge`。以后只需更新这个目录（或用 `update.ps1`），不必把桌面文件夹当作正在运行的副本。

### 4.6 便携包里有什么、没有什么

官方 `jasp-bridge-0.3.4-portable.zip` 约 41 MB，内含插件代码、`node_modules`、文档、示例和 Windows `node.exe`。**不包含**约 1.7 GB 的 JASP 运行时（安装时由 `install.ps1` 从本机 JASP 复制）。

- 仓库：https://github.com/nanple/jasp-bridge
- 便携包：https://github.com/nanple/jasp-bridge/releases/download/v0.3.4/jasp-bridge-0.3.4-portable.zip
- 更新清单：https://github.com/nanple/jasp-bridge/releases/latest/download/latest.json

---

## 5. 数据准备

### 5.1 基本要求

- CSV 编码用 UTF-8；
- 第一行是变量名；
- 一行一个被试；
- 缺失值留空或写 `NA`；
- 变量名建议用英文、数字、下划线，避免空格；
- 分类变量用文字或数字编码都可以，但要在对话里说明含义。

示例：

```csv
id,gender,edu,age,sat1,sat2,sat3,sat4,sat5,sat_mean,perf
1,男,本科,30,4,5,4,4,5,4.4,90
2,女,硕士,28,5,4,5,4,5,4.6,88
```

本包自带三份示例：`examples/demo.csv`（描述统计、回归、t 检验、ANOVA、Process 等）、`examples/factor-demo.csv`（两因子题项，适合 EFA/PCA/CFA）、`examples/mixed-demo.csv`（12 被试 × 4 时点，适合混合模型）。

### 5.2 量表题与总分

P0 **不会自动计算量表总分**。如果你要做回归，请先在 Excel/SPSS/JASP 里算好 `sat_mean` 或 `sat_total`，再放进 CSV。

信度分析可以直接用原始题项 `sat1`–`sat5`。

### 5.3 反向计分题

如果量表里有反向题，在计划里明确指出，例如：

```text
sat3 是反向计分题，做信度时请反向处理
```

插件会在信度分析里使用 `reverseScaledItems`。如果没有自动识别，用修改计划补上。

### 5.4 分组变量

t 检验只接受 **2 个水平** 的分组变量。3 组及以上请用 ANOVA。

如果 `gender` 编码为 1/2，建议在对话里说明：

```text
gender 的 1 表示男，2 表示女
```

---

## 6. 现在能做什么

| 分析 | 你可以得到 | 备注 |
| --- | --- | --- |
| 描述统计 | N、缺失、均值、SD、中位数、四分位、偏度、峰度；Shapiro-Wilk 与矩阵散点图默认关闭 | 支持分组描述；需要时再说“看正态性”或“画矩阵散点图”，或在选项里打开。变量数 ≥ 15 且仍打开这两项时会提醒可能较慢，但不会取消你的明确要求 |
| 信度 | Cronbach's α、McDonald's ω、删除条目后的 α、题总相关、条目均值/SD | 支持反向题 |
| 相关 | Pearson / Spearman / Kendall，r、p、N | 默认 Pearson |
| 独立样本 t 检验 | Student t、Welch t、Levene、均值差、95% CI、Cohen's d | 仅两组 |
| 配对样本 t 检验 | 差值均值、t、p、Cohen's dz、差值正态性 | 需要两个配对变量 |
| ANCOVA | 调整后均值、F、p、偏 eta²、Levene、因子与协变量独立性 | 新封装，标 beta |
| 单因素 ANOVA | 主效应 F、df、p、效应量、Levene、事后比较 | 水平数 >2 时自动追加 Tukey；可说 Holm/Bonferroni/Scheffé/Šidák |
| 两因素 ANOVA + 简单效应 | 交互作用 F、每个调节水平上的简单效应 F 与偏 eta²（含 CI） | 变量角色 `simpleEffectFactor` + `simpleEffectModerator` |
| 对比（contrast） | Helmert / 多项式 / 重复 / 差异 / 偏差 / 简单 对比表；可传自定义系数矩阵 | 自定义写法见下方说明 |
| 重复测量 ANOVA | Mauchly 球形检验、GG 校正、被试内/被试间效应、偏 eta²、事后比较 | 宽格式；单一被试内因子 + 可选组间因子；默认 Holm |
| Process 中介/调节 | a/b/c′ 路径、间接效应 + bootstrap CI、总效应、R²、简单斜率、调节中介指数、路径图 | Model 1 / 4 / 6 / 7 / 8 / 14 / 15；对话里提“缺失/FIML”可用 FIML |
| 贝叶斯 Process | 后验估计、可信区间、R̂、有效样本量 | 同一套 Hayes 模型；说“贝叶斯中介”或“贝叶斯调节”。MCMC 较慢 |
| 探索性因子分析 | KMO、Bartlett、特征值、碎石图、载荷、因子相关、拟合优度 | 至少 3 个观测变量；未指定题项时先给建议，确认后再跑 |
| 主成分分析 | 特征值、碎石图、成分载荷、累计解释方差 | 至少 3 个变量；可指定保留成分数 |
| 验证性因子分析 | χ²、CFI/TLI/RMSEA/SRMR、载荷、组合信度、路径图 | 未给因子结构时按题项前缀提出建议，确认后再跑；也可显式传 `options.factors` |
| 结构方程模型 | 拟合指标、路径系数、R²、路径图 | 未给语法时可先给建议测量模型，确认后再跑；也可显式传 `options.models` |
| PLS-SEM | 路径系数 + bootstrap CI、Composite Reliability、AVE、HTMT | 必须给出 `->` 复合测量语法 |
| MIMIC 模型 | 拟合指标、路径系数 | 至少 3 个指标，预测变量须为连续或二分 |
| 潜变量增长曲线 | 截距/斜率（可选二次/三次）及拟合指标 | 至少 3 个连续重复测量变量 |
| 线性混合模型 | 固定效应、随机效应方差、拟合统计、样本量 | 随机截距，可加随机斜率 |
| 广义线性混合模型 | 二项 / Poisson / 高斯等族的固定效应与随机效应 | 需先把因变量编码成 0/1 或计数 |
| 贝叶斯线性混合模型 | 后验估计、可信区间、R̂ | 说“贝叶斯线性混合模型”；MCMC 较慢 |
| 贝叶斯广义线性混合模型 | 后验估计、可信区间、R̂ | 说“贝叶斯广义/二项混合”；支持 Bernoulli、Poisson、高斯等族 |
| 线性回归 | R²、F、系数、β、95% CI、VIF | 默认 enter 法；标 beta |
| 图片 | JASP 生成的 PNG/SVG；描述统计矩阵图需显式打开 | 复杂交互图可能需要导出 PDF/HTML |
| 模板报告 | 已有 `.jasp` → `report.pdf` + HTML dashboard | 不替换模板内数据 |
| `.jasp` 导出 | 可用 JASP 打开的归档，写入分析选项与已跑出的结果 | `jasp_export(format=jasp)`；打开后可 Refresh |
| 工件导出 | `request.json`、`data.csv`、`run_analysis.R`、`result.json`、Markdown、结果 CSV、`plots/` | 可复现 |

---

## 7. 现在不能做什么，以及使用注意

- Excel 多工作表默认只读第一张，要用其他表请在加载时指定 `sheet`（表名或从 1 开始的序号）；密码保护的工作簿需先取消密码；`.xlsm` 只读取单元格数据，不会执行宏；
- 不能自动计算量表总分；反向题自动识别不保证 100%。前缀相近的题项可能提示「看起来像同一个量表，是否先算总分或均分」，这只是建议，确认前不会自动计算或反向计分；
- 不能做多因素被试内设计（如 2×3 全被试内）；重复测量目前是单一被试内因子，可叠加 1–2 个组间因子；
- 方法顾问会对照已加载的表格核实因变量、实验设计（「组内」与「被试内」「重复测量」属同一类）和人口学变量。可用「反应时」「正确率」「学历」等口语对上 `rt`、`acc`、`education` 这类列名；对不上时会提问，不会偷偷选定。只描述实验情景、没有说出方法名时，也会给出可确认的建议，并说明理由、备选，以及说法和表格对不上时的提醒。如果只说「帮我分析」、或说明自己还不清楚实验设计，只要已经加载了数据，插件会先根据表格给出描述统计，并列出几种说得通的候选方法（例如宽格式组内用重复测量，组间用 t 检验或方差分析，长格式可考虑混合模型），措辞只会说「表格看起来像……」，都需要确认后才执行，不会自动改数据或开跑。这不是新方法包，仍是现有 22 类分析；
- 因子分析 / SEM：EFA/PCA 至少需要 3 个观测变量。只说“做 EFA / CFA / SEM”且未指定题项或因子时，插件会根据列名、前缀和类型给出建议方案，并标明这是建议、须确认后才执行；你也可以继续显式提供 `options.factors` 或 `options.models`。插件不会把建议当成已确认的事实，也不会自动开跑；
- 简单效应支持一个调节因子，也可以加第二个调节因子（三因素）；数据需要平衡，有空格子时 JASP 无法估计；
- Process 支持 Model 1 / 4 / 6 / 7 / 8 / 14 / 15（含有调节的中介）。双调节、并行多中介等尚未封装。对话中提到缺失或 FIML 时可用 FIML，否则默认 listwise；
- 贝叶斯 Process、贝叶斯线性/广义混合模型已经封装，但 MCMC 默认 3 条链、500 次 burn-in、1000 次抽样，可能需要几分钟；自定义 Stan 模型仍不能做；
- 复杂交互图（例如部分 SEM 路径图）不能直接作为图片返回，需要导出 PDF/HTML；
- 可以用 `jasp_export(format=jasp)` 生成真正的 `.jasp` 文件（有成功运行时会写入结果）。无对应运行结果时，仍只写入数据与选项；
- 不能自动修复不满足的前提条件，只会提示或追问；
- 配对 t、ANCOVA、ANOVA、线性回归目前标 beta，关键论文建议与 JASP 图形界面对照；
- 描述统计时若把题项标成有序（ordinal）变量，JASP 不会输出均值和标准差。0.3.0 起，带小数的量表均分会推断为连续（scale）；若仍被判错，用 `types` 覆盖后再跑。
- 描述统计默认关闭 Shapiro-Wilk 正态检验和矩阵散点图（与官方 JASP 一致）。题项较多时这两项会明显变慢。需要时请明确说“看正态性”或“画矩阵散点图”，或在选项里打开 `shapiroWilkTest` / `matrixPlot`。变量数达到或超过 15 个时，若仍打开这两项，计划会提醒可能较慢，但不会取消你的明确要求；变量很多时建议按分量表分开跑。

---

## 8. 十二个实用场景

### 场景 1：先做数据体检

你可以说：

```text
加载 <你的数据文件.csv>，先告诉我每列的类型、缺失和取值范围。
```

你会得到：样本量、变量类型、缺失数、唯一值、均值/SD、分类水平。

---

### 场景 2：量表信度

```text
用 sat1 到 sat5 做信度分析，报告 Cronbach's α、McDonald's ω 和删除条目后的 α。
```

你会得到：α、ω、条目统计、删除某题后的 α 变化。

---

### 场景 3：男女差异

```text
比较男女在 perf 上的差异，先看方差齐性，报告 Cohen's d。
```

你会得到：两组描述统计、Levene、Student/Welch t、均值差、95% CI、d。

---

### 场景 4：多组差异与重复测量

组间设计：

```text
比较不同学历（edu）的 perf，做单因素方差分析，事后比较用 Tukey。
```

你会得到：ANOVA 主表、Levene、描述统计，以及两两事后比较（均值差、95% CI、t、校正 p、Cohen's d）。

交互显著后要看简单效应或特殊对比：

```text
在男女各水平上比较不同学历的 perf 简单效应，用 Helmert 对比
```

你会得到：交互项、每个性别水平内的简单效应 F 与偏 eta²（含 CI）、Helmert 对比表。变量角色写作 `simpleEffectFactor`（被检验的因子）与 `simpleEffectModerator`（分组因子）。

自定义系数对比（高级用法，`jasp_plan_analysis` 的 `options`）：

```json
{
  "contrasts": [{ "variable": "edu", "contrast": "custom" }],
  "customContrasts": [
    { "value": ["edu"], "values": [{ "isContrast": true, "values": [2, -1, -1] }] }
  ]
}
```

系数顺序按变量在数据里的水平顺序（本例为本科、博士、硕士），`[2, -1, -1]` 表示“本科 vs 硕士与博士的平均”。

重复测量设计（宽格式，每个时点一列）：

```text
对 sat1 到 sat5 做重复测量方差分析，事后比较用 Holm。
```

你会得到：Mauchly 球形检验、Greenhouse-Geisser 校正、被试内效应、偏 eta²，以及各时点两两比较。若数据里还有分组变量，可加一句"按 gender 分组"做混合设计。

---

### 场景 5：中介与调节（Process）

简单中介（Model 4）：

```text
检验 age 是否通过 sat1 影响 perf，用 bootstrap 1000 次。
```

你会得到：a、b、c′ 路径，间接效应点估计与 95% bootstrap CI，总效应，R²，以及概念路径图。

调节（Model 1）：

```text
检验 sat1 是否调节 age 对 perf 的影响，报告简单斜率。
```

你会得到：交互项、按 16/50/84 百分位的条件效应、R² 与路径图。链式中介（Model 6）直接说"模型 6，中介是 sat1 和 sat2"。有调节的中介可说"模型 7/8/14/15"。要贝叶斯版本就加一句"做贝叶斯中介"或"做贝叶斯调节"。

---

### 场景 6：相关矩阵

```text
对 age、sat_mean、mot_mean、perf 做 Pearson 相关矩阵。
```

你会得到：r、p、N。想用 Spearman 就说“用 Spearman”。

---

### 场景 7：多元回归与共线性

```text
以 perf 为因变量，age、sat_mean、mot_mean 为预测变量，做线性回归，报告 VIF。
```

你会得到：模型摘要、ANOVA、系数表、VIF。VIF > 10 时插件会提醒。

---

### 场景 8：一条完整的小论文分析链

先准备 `sat_mean`、`mot_mean` 两列，然后说：

```text
先对 sat1-sat5 做信度；然后用 sat_mean、mot_mean、age 预测 perf，做回归。
```

插件会分别生成信度计划和回归计划，依次执行。每份计划仍只做一个分析；如果只描述实验情景、没有点名方法，也可能一次给出几份相关计划（例如先描述统计、再做重复测量），需要分别确认后再执行。多个分析也可以连续说。

---

### 场景 9：导出可复现工件

```text
把刚才的回归计划导出成 request.json 和 R 脚本，结果表导出 CSV。
```

你会得到：`request.json`、`run_analysis.R`、`data.csv` 快照和执行命令。

---

### 场景 10：用已有 `.jasp` 模板出报告

```text
用 <你的模板.jasp> 生成 PDF 报告，输出到 <你的输出目录>。
```

适合固定分析流程、只换报告的场景。注意：JASP 0.99.x 的 `--report` 使用模板内嵌数据，不替换新数据。

---

### 场景 11：追问结果，不重算

```text
这个 VIF 说明什么？共线性严重吗？论文里怎么写？
```

插件会基于同一会话的结果解释，不会重新跑分析。

---

### 场景 12：因子分析、结构方程与混合模型

因子结构探索。可以直接说“做探索性因子分析”；如果题项有 `sat1` / `anx1` 这样的前缀，插件会先给出建议题项和因子数，标明为建议，等你确认后再跑。也可以自己指定：

```text
对 x1 到 x8 做探索性因子分析，提取 2 个因子
```

确认并运行后，你会得到：KMO、Bartlett 球形检验、特征值与碎石图、因子载荷矩阵、因子间相关。

验证性因子分析：未给因子结构时，插件也会按题项前缀提出建议。若要自己指定，可在 `options.factors` 里写：

```json
{
  "factors": [
    { "name": "F1", "title": "因子 1", "indicators": ["x1", "x2", "x3", "x4"] },
    { "name": "F2", "title": "因子 2", "indicators": ["x5", "x6", "x7", "x8"] }
  ]
}
```

结构方程模型：未给语法时，插件可先给出建议测量模型。若要自己指定 lavaan 语法，可在 `options.models` 里写：

```json
{
  "models": [
    { "name": "Model 1", "syntax": "F1 =~ x1 + x2 + x3 + x4\nF2 =~ x5 + x6 + x7 + x8\nperf ~ F1 + F2" }
  ]
}
```

多水平数据（每个被试多次测量，需要被试 ID 列）：

```text
以 score 为因变量，把 wave 和 condition 作为固定效应，按 subject 做随机截距
```

你会得到：固定效应估计、随机效应（被试截距）、AIC/BIC 与样本量。要贝叶斯或广义模型时，把“贝叶斯”“广义/二项”说清楚。

---

## 9. 让另一个助手接手（进度接口）

如果你在别的机器人里继续这个项目，不必把整个仓库贴过去——起一个只读端口让它自己读：

```powershell
npm run progress -- --host 0.0.0.0 --port 8787
```

然后让对方抓 `http://<你的局域网 IP>:8787/progress.md`（人读简报）或 `/progress.json`（机器读），里面已经包含：

- 当前阶段与版本；
- 已完成的功能清单与下一步计划；
- 已知问题与踩坑记录（避免重踩）；
- 待办清单（含进行中状态）；
- 22 类分析的清单与变量角色（见图文指南）；
- 最近改动的文件；
- 一段可直接粘贴的「接手提示词」。

端口只读，不提供写入分析的能力；需要跑测试时用 `GET /tests?run=1`。

---

## 10. 怎么问效果最好

| 做法 | 例子 |
| --- | --- |
| 明确变量名 | “用 sat1-sat5”，不要只说“满意度” |
| 明确因变量 | “perf 是因变量” |
| 明确分组水平 | “gender 的 1=男，2=女” |
| 明确方法 | “用 Welch t”“用 Pearson”“用 enter 法回归” |
| 说明反向题 | “sat3 反向计分” |
| 说明缺失处理 | “缺失按 listwise 处理” |
| 先确认计划 | 看到变量映射不对，直接说“把 group 改成 edu” |

---

## 11. 常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 提示找不到变量 | 变量名拼写不一致 | 先 `jasp_describe_data` 看准确列名 |
| t 检验要求 2 组 | 分组变量有 3 个及以上水平 | 改用 ANOVA |
| 回归没有 `sat_mean` | P0 不自动算总分 | 先在 CSV 里准备好 |
| α 很低 | 反向题未处理 | 指定 `reverseScaledItems` |
| VIF 很大 | 预测变量高度相关 | 删除/合并变量，或改做主成分/岭回归（P0 未封装） |
| 结果表为空 | 变量类型或选项不匹配 | 看 `jasp_run_status` 的 error，或导出请求核对 |
| 首次很慢 | 正在复制/加载运行时 | 首次约 5–10 秒 worker 加载，冷启动更久 |
| 描述统计很慢 | 打开了 Shapiro-Wilk 或矩阵散点图，且一次放入很多变量 | 这两项现已默认关闭。若你显式打开且变量数 ≥ 15，计划会提醒可能较慢，但不会自动取消。可关掉这两项，或按分量表分开跑 |
| 想读 Excel 的第二张表 | 默认读第一张 | 加载时指定 `sheet` 为表名或从 1 开始的序号 |
| Excel 提示已加密 | 工作簿有密码 | 先在 Excel 中取消密码再加载 |

---

## 12. 结果与文件在哪里

默认安装目录：

```text
$HOME\.workbuddy\jasp-bridge
```

在 PowerShell 里 `$HOME` 会自动变成当前用户目录，不需要手动替换用户名。

每次分析在 `sessions/<session_id>/runs/<run_id>/` 下保存：

```text
request.json      JASP 引擎请求
data.csv          本次数据快照
run_analysis.R    一次性执行脚本
result.json       原始结果
status.json       运行状态
plots/            JASP 生成的图片
```

### 11.1 导出结果 CSV

在对话里说：

```text
把刚才的结果导出 CSV
```

插件会把每张结果表写成单独的 CSV，放在：

```text
sessions/<session_id>/exports/<run_id>-csv/
```

文件带 UTF-8 BOM，Excel 直接打开中文不会乱码。  
注意：`data.csv` 是数据快照，不是分析结果；结果 CSV 在 `exports/` 下。

MCP 配置：

```text
$HOME\.workbuddy\mcp.json
```

---

## 13. 隐私与边界

- 数据文件和统计结果保存在本机；
- 插件不上传数据文件；
- WorkBuddy 的模型会看到工具返回的结果表（不是原始数据文件），这部分按 WorkBuddy 的隐私策略；
- 所有分析都在本机 JASP/R 运行时执行；
- 上传到对话里的表格会进入会话上下文，敏感数据请先脱敏。

---

## 14. 故障排查

| 现象 | 处理 |
| --- | --- |
| `JASP: 未找到` | 安装 JASP，或用 `-JaspPath` 指定 |
| `JASP 运行时：❌` | 重新运行 `install.ps1`（不要加 `-SkipRuntime`） |
| `jaspTools：❌` | 用安装脚本构建运行时，不要手拼系统 R |
| `无头 R：❌` | 看 `jasp_status` 的运行时路径，重跑 `setup_runtime.ps1` |
| WorkBuddy 看不到插件 | 检查 `~/.workbuddy/mcp.json`，重启 WorkBuddy |
| PowerShell 禁止运行脚本 | 用 `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
| 复制运行时很慢 | 1.7 GB，首次正常；杀毒软件可能拖慢 |

---

## 15. 版本与路线图

- **当前（0.3.4）**：提高对实验描述和数据列的可识别度（组内/组间等设计用语、口语别名对列名、未点名方法时的可确认建议，以及理由、备选和不一致提醒）。若用户只有数据、尚未说明设计，也会先根据表格给出描述统计和候选方法，需确认后才执行。仍为 22 类分析、16 个 MCP 工具，不是新方法包。量表总分只作为建议，不会自动计算；多因素组内设计目前仍不能跑。0.3.3 已让生成的 `.jasp` 把结果表中的编码列名还原为原始变量名，并写入变量标题与值标签。0.3.2 已将描述统计的 Shapiro-Wilk 与矩阵散点图改为默认关闭。0.3.1 已支持直接读取 Excel 和 SPSS。表、图和 `.jasp` 由 JASP 引擎产生，宿主只负责展示。其中回归、配对 t、ANCOVA、ANOVA 仍标 beta。
- **下一步（3.0 仍未做部分）**：测量等值、元分析、功效分析、更接近 APA 的表格、更稳定地打开 `.jasp`；已经画进 PNG 的图若仍显示编码名，可在 JASP 中 Refresh。以及把缺失值策略（FIML / 多重插补）扩展到更多分析。

---

## 16. 一页速查

```text
检查 JASP 状态

加载 <你的数据文件.csv>，看变量情况

用 sat1-sat5 做信度

比较男女在 perf 上的差异，报告 Cohen's d

比较不同 edu 的 perf，做 ANOVA，事后比较用 Tukey

在男女各水平上比较不同 edu 的 perf 简单效应，用 Helmert 对比

对 x1 到 x8 做探索性因子分析，提取 2 个因子

以 score 为因变量，把 wave 和 condition 作为固定效应，按 subject 做随机截距

对 sat1 到 sat5 做重复测量方差分析，事后比较用 Holm

检验 age 是否通过 sat1 影响 perf（中介，Model 4）

检验 sat1 是否调节 age 对 perf 的影响（调节，Model 1）

把刚才的结果导出为 .jasp 文件

对 age、sat_mean、perf 做 Pearson 相关

用 age、sat_mean、mot_mean 预测 perf，做回归并看 VIF

把刚才的回归导出 request.json 和 R 脚本

用 <你的模板.jasp> 生成 PDF 报告
```

---

## 17. 更新插件

如果 WorkBuddy 提示有新版本，或在对话里说：

```text
检查插件更新
```

插件会读取 `latest.json`，只提示版本和更新说明，不会自动替换代码。

确认后说：

```text
下载更新
```

插件会下载 zip、校验 SHA256、解压到 `updates\<version>\`，然后给你一条 `update.ps1` 命令。

**安装步骤：**

1. 关闭 WorkBuddy；
2. 运行插件返回的 `update.ps1` 命令；
3. 重启 WorkBuddy；
4. 问“检查 JASP 状态”。

`update.ps1` 会保留：

- `runtime/`：不用重新复制 1.7 GB；
- `sessions/`：历史会话；
- `mcp.json`：WorkBuddy 配置。

如果更新说明里写了“需要重建运行时”，安装后再运行：

```powershell
.\scripts\setup_runtime.ps1 -Force
```

不要直接把新 zip 解压覆盖整个安装目录，否则可能覆盖 `runtime/` 和 `sessions/`。用 `install.ps1 -SkipRuntime` 或 `update.ps1`。

---

## 18. 不用 WorkBuddy，能用 DeepSeek / 豆包吗？

先说结论：

1. **DeepSeek、豆包的官方桌面版，通常没有“装插件”的入口**，不能直接把 JASP-Bridge 装进去；
2. 想用它们的模型，需要换一个**能装插件的聊天软件**，比如 Cherry Studio；
3. 换的只是聊天软件，模型还是 DeepSeek/豆包，JASP 仍然在你电脑上跑。

可以这样理解：

- DeepSeek/豆包模型 = 大脑；
- JASP = 计算器；
- JASP-Bridge = 把大脑和计算器接起来的线；
- 官方桌面版 = 没有插线口的手机；
- Cherry Studio = 有插线口的手机。

如果你愿意装一个免费聊天软件，按 `SUPPORT-DEEPSEEK-DOUBAO.md` 的“方案一”做；里面每一步都写了“你会看到什么、该点什么”。

如果你只想用官方桌面版，也能用，但只能：

- 让模型帮你规划分析步骤；
- 你自己在 JASP 里点；
- 把结果贴回对话让模型解释。

这仍然有价值，但不是自动执行。

配置模板在 `configs/`，完整的“小白版 + 技术附录”见 `SUPPORT-DEEPSEEK-DOUBAO.md`。
