# 不用 WorkBuddy，能用 DeepSeek / 豆包吗？

版本：0.3.2  
适用：Windows 10/11，已安装 JASP

> 图文版：浏览器打开 `docs/visual-guide.html`，或直接看 `docs/visual-guide.pdf`。

---

## 一、先说结论（30 秒）

1. **DeepSeek、豆包的官方桌面版，通常没有“装插件”的入口**，不能直接把 JASP-Bridge 装进去。
2. 想用它们的模型，需要换一个**能装插件的聊天软件**，比如 Cherry Studio。
3. 换的只是聊天软件，模型还是 DeepSeek/豆包；JASP 仍然在你自己的电脑上跑，数据不出本机。

打个比方：

| 东西 | 好比是 |
| --- | --- |
| DeepSeek / 豆包模型 | 大脑 |
| JASP | 计算器 |
| JASP-Bridge 插件 | 把大脑和计算器接起来的那根线 |
| 官方桌面版 | 没有插线口的手机 |
| Cherry Studio | 有插线口的手机 |

所以不是“加一个文件”就行，而是要给大脑换一个能插线的外壳。

---

## 二、你属于哪种情况

| 你的情况 | 能不能用 | 建议 |
| --- | --- | --- |
| 只用 DeepSeek/豆包官方桌面版，不想装别的 | 不能自动出数 | 看“方案二：手动版” |
| 愿意装一个免费聊天软件 | 可以 | 看“方案一：换宿主” |
| 有会电脑的朋友 | 可以 | 把这份文档和 `configs/` 发给他 |

---

## 三、方案一：换一个能装插件的聊天软件（推荐）

### 需要准备

- 一台装了 JASP 的 Windows 电脑；
- DeepSeek 或豆包的账号；
- 10–20 分钟；
- 不需要会编程。

### 第 1 步：装一个“能装插件”的聊天软件

推荐 **Cherry Studio**（免费）。其他类似软件还有 Cline、Roo Code、Qwen Code，但 Cherry Studio 对普通用户最直观。

安装后打开，先不要管插件，先把模型接上。

### 第 2 步：把模型的“钥匙”填进去

#### 用 DeepSeek

1. 打开 DeepSeek 开放平台，注册/登录；
2. 创建一个 **API Key**（一串字母数字，作用像密码）；
3. 在 Cherry Studio 的设置里找到“模型服务/提供商”；
4. 选择 DeepSeek，把 API Key 粘进去；
5. 模型选 `deepseek-chat`（日常分析够用）或 `deepseek-reasoner`（推理更强，但更慢）。

> 不同版本的菜单文字可能略有不同，找“模型服务”“提供商”“API Key”这些词即可。

#### 用豆包

豆包模型要通过**火山方舟**开通，步骤比 DeepSeek 多：

1. 登录火山引擎，开通方舟服务；
2. 创建一个“推理接入点”，会得到一串 `ep-...` 的编号；
3. 创建一个 API Key；
4. 在 Cherry Studio 里添加 OpenAI 兼容提供商；
5. 地址填 `https://ark.cn-beijing.volces.com/api/v3`；
6. 模型填你的 `ep-...` 接入点编号；
7. API Key 填方舟的 Key。

如果你看到“接入点”“方舟”“推理”这些词就头疼，建议找会电脑的朋友帮你开通一次。

### 第 3 步：把 JASP-Bridge 接上

1. 在聊天软件的设置里找“MCP 服务器”“插件”“扩展”；
2. 选择“添加服务器”或“导入 JSON”；
3. 填入两个路径：

```text
程序：<你的安装目录>\node.exe
启动文件：<你的安装目录>\src\server.js
```

4. `<你的安装目录>` 通常是：

```text
C:\Users\<你的用户名>\.workbuddy\jasp-bridge
```

5. 不会找路径时：在资源管理器里 `Shift + 右键` 文件 → “复制文件地址”；
6. 保存，重启聊天软件；
7. 在对话里说：

```text
检查 JASP 状态
```

看到“无头 R：✅”就说明接好了。

### 第 4 步：开始用

```text
加载 <你的数据文件.csv>，先看变量情况
```

```text
比较男女在绩效上的差异，报告 Cohen's d
```

插件会先给分析计划，你确认后才执行；数字来自本机 JASP。

---

## 四、方案二：只用官方桌面版（手动版）

如果你不想装额外软件，也可以这样用：

1. 让 DeepSeek/豆包帮你**规划**分析步骤、解释结果；
2. 你自己在 JASP 里按步骤点；
3. 把 JASP 的结果表贴回对话，让模型帮你解释和写报告。

这仍然有价值，但它**不是自动执行**，插件也帮不上忙。

---

## 五、名词小抄

| 名词 | 用大白话说 |
| --- | --- |
| 插件 / MCP | AI 和本地软件之间的“插头标准” |
| API Key | 模型服务的“钥匙”，像密码，不能给别人 |
| Base URL | 模型服务的“地址” |
| 安装目录 | 插件文件所在的文件夹 |
| 运行时 | JASP 自带计算引擎的一份副本，约 1.7 GB |
| 宿主 | 能装插件的聊天软件 |

---

## 六、安全提醒

- API Key 不要截图、不要发人、不要上传到网盘；
- 数据文件和 JASP 都在本机，插件不会上传原始数据；
- 只有工具返回的结果表会进入模型对话；
- 不要把 JASP 通过公网隧道暴露给云端智能体。

---

## 七、给技术同学的附录

### 7.1 能力矩阵

| 宿主 | 模型 | 能否直接用 | 说明 |
| --- | --- | --- | --- |
| WorkBuddy | 内置 | 可以 | 原生 MCP 插件 |
| Cherry Studio | DeepSeek / 豆包 Ark | 可以 | 添加 OpenAI 兼容提供商 + MCP |
| Cline / Roo Code | DeepSeek / 豆包 Ark | 可以 | VS Code 扩展，支持 MCP |
| Qwen Code | 千问 / 兼容 API | 可以 | 本地 CLI，支持 MCP |
| DeepSeek 官方桌面端 | DeepSeek | 通常不可以 | 以设置里是否有 MCP/工具入口为准 |
| 豆包官方桌面端 | 豆包 | 通常不可以 | 智能体插件多在云端，访问不到本机 JASP |
| Coze / 百炼云端智能体 | 豆包 / 千问 | 不能直接 | 需要本地 HTTP 桥 + 公网隧道 |

### 7.2 OpenAI 兼容参数

DeepSeek：

```text
Base URL：https://api.deepseek.com/v1
模型：deepseek-chat / deepseek-reasoner
```

豆包（火山方舟）：

```text
Base URL：https://ark.cn-beijing.volces.com/api/v3
模型：推理接入点 ID（ep-...）或方舟模型 ID
```

### 7.3 MCP 配置模板

见 `configs/mcp/jasp-bridge.json`。把 `<你的安装目录>` 换成实际路径，通常是：

```text
C:\Users\<用户名>\.workbuddy\jasp-bridge
```

如果客户端使用系统 Node，把 `command` 从 `node.exe` 改成 `node`。

### 7.4 提示词模板

见 `configs/prompts/jasp-analyst.md`。核心规则：

1. 先 `jasp_status`；
2. 加载数据后先 `jasp_describe_data`；
3. 生成计划让用户确认；
4. 数值只来自 JASP，不编造；
5. 失败时返回错误，不猜结果。

### 7.5 后续开发路线

- **P0（本文档）**：API + MCP 客户端配置说明、模板、提示词；
- **P1**：给 `src/server.js` 增加 HTTP transport，适配只支持 HTTP MCP 的客户端；
- **P2**：独立本地客户端（Web UI/CLI），用 DeepSeek/豆包 API + function calling 调 JASP 工具。这是新产品，不是加一个 skill 文件。

### 7.6 验证清单

- [ ] 客户端能添加 OpenAI 兼容提供商；
- [ ] 能添加 MCP stdio 服务器；
- [ ] `jasp_status` 返回“无头 R：✅”；
- [ ] 能加载 CSV 并返回变量字典；
- [ ] 能生成分析计划并确认；
- [ ] 能跑一次描述统计或 t 检验；
- [ ] 结果表数值与 JASP GUI 一致；
- [ ] 关闭客户端后，MCP 进程能正常退出。

---

## 八、一句话总结

**DeepSeek/豆包官方桌面版不能直接装这个插件；想用它们的模型，就换一个能装插件的聊天软件，比如 Cherry Studio。**  
不想折腾的话，继续用 WorkBuddy 最省事；只想手动分析，就让模型帮你规划、你在 JASP 里点。
