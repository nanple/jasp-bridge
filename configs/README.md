# 非 WorkBuddy 宿主配置

如果你不是技术用户，先看根目录 `SUPPORT-DEEPSEEK-DOUBAO.md` 的“方案一”；那里是给普通用户看的步骤。这个目录是给帮你配置的人或技术同学参考的。

一句话：模型可以换，但需要一个“能装插件”的聊天软件。

## 文件

- `mcp/jasp-bridge.json`：MCP 服务器配置模板；
- `prompts/jasp-analyst.md`：建议粘贴到客户端系统提示词里的统计助手规则。

## 使用步骤

1. 在支持 MCP 的客户端（Cherry Studio、Cline、Roo Code、Qwen Code 等）里添加 OpenAI 兼容模型提供商；
2. 把 `mcp/jasp-bridge.json` 里的 `<你的安装目录>` 换成实际安装路径；
3. 把 `prompts/jasp-analyst.md` 设为系统提示词；
4. 对话输入“检查 JASP 状态”。

## DeepSeek

```text
Base URL：https://api.deepseek.com/v1
模型：deepseek-chat / deepseek-reasoner
```

## 豆包（火山方舟）

```text
Base URL：https://ark.cn-beijing.volces.com/api/v3
模型：你的推理接入点 ID（ep-...）或方舟模型 ID
```

API Key 只保存在本地客户端，不要提交到仓库。

完整说明见根目录 `SUPPORT-DEEPSEEK-DOUBAO.md`。
