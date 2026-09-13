---
description: "面向 ctx.web 的 Google Search grounding 搜索 provider：如何在运行 harness 的机器上通过本地 llm-router 服务搜索，且无需持有 API key。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-grounding

[English](README.md) | 中文

## 概述

使用 `dsh-web-search-grounding` 时，harness 通过本地 llm-router 服务的 `/grounding/search/clean` 端点进行网络搜索，该服务持有 Gemini API key 并提供 Google 级检索。适合在 llm-router 与 harness 并排运行、且希望 agent 进程不接触任何搜索凭据的部署：不消耗模型 turn、密钥不离开路由器，请求体只携带 query 与输出预算。当路由器未启动时，搜索会以可操作的 `WEB_PROVIDER_ERROR` 失败；provider id 为 `grounding`。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与未决工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

在已加载 web 服务的组合中挂载此 provider；它以 `grounding` 搜索 provider 身份注册，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——或者用 `searchProvider: grounding` 显式指定。

### When to choose it

当部署在本地运行 llm-router 服务、且希望 harness 自身不持有任何搜索凭据时，选择此后端。路由器是 Gemini API key 的唯一存放处；provider 只是 `ctx.web` 缝上的一个薄 HTTP 适配器。一次搜索是对路由器的一次 HTTP 往返——没有额外的模型 turn——因此成本与延迟就是路由器自身的检索成本。当本地没有可用路由器时应避免使用，因为每次搜索都会以"路由器未运行"错误快速失败。

### Minimal configuration

加载 web 服务与 provider；路由器 base URL 默认为本地端点。base URL 依次从 Settings section、`$GROUNDING_SEARCH_BASE_URL`、默认值解析。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: grounding
- name: '@deepseek-ai/dsh-web-search-grounding'
  config:
    baseURL: http://127.0.0.1:8787
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `http://127.0.0.1:8787` | 本地 llm-router base URL；追加 `/grounding/search/clean`。回退到 `$GROUNDING_SEARCH_BASE_URL`；无法解析时 provider 不可用 |
| `maxOutputTokens` | `256` | 路由器生成答案的最大输出 token 数（1–8192） |
| `timeoutMs` | `30000` | 单次搜索的网络超时（毫秒） |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-grounding)是每个可接受字段及其 JSDoc 的权威来源。上面的条目是 provider Settings section 的 base 层；其上的用户层会在下一次搜索时生效，因为 provider 每次调用都投影 section，而不是在注册时捕获。

### What a search returns

`content` 是路由器生成的、有依据的答案文本。`sources[]` 来自路由器的 `sources` URL 列表；路由器的 `groundingSupports` 是自由文本引用而非按 URL 的结构化元数据，因此它们呈现在答案文本上，且不会臆造 title 或 snippet。`truncated` 在 provider 层始终为 false：由 seam 在返回路径上执行请求的 `maxResults` 上限。

### Failures and recovery

失败抛出带机器可路由 code 的 `WebError`：调用方取消为 `WEB_ABORTED`，provider 或传输失败为 `WEB_PROVIDER_ERROR`。HTTP 重定向在接触 `Location` 目标前被拒绝。`503` 携带"路由器未运行"消息与启动提示；既无答案也无来源的响应会大声失败而非降级。请求体从不携带凭据，因此泄漏的请求体不可能泄漏 key。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

本节解释 provider 背后的设计决策；可观察行为在 [使用此包](#use-this-package) 中完整覆盖。

### Design philosophy

provider 建立在两个承诺之上：

- **路由器持有凭据与检索。** provider 只向 `/grounding/search/clean` 发送 query 与输出预算。不消耗模型 turn，密钥不离开机器：Gemini 凭据只存在于 llm-router 服务中。
- **按搜索投影选项。** provider 每次调用都解析当前 Settings section，因此已提交的设置变更无需重新注册即可在下次搜索生效，且两次搜索之间的设置写入不会混用两个 section。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：config schema、Settings section 安装、按搜索的选项投影 |
| [`src/provider.ts`](src/provider.ts) | `GroundingSearchProvider`：HTTP 分发、abort 处理、响应映射 |
| — | 不发布运行时 invariant companion；请求是不消耗模型 turn 的普通 HTTP POST，因此没有可与后续权威事件关联的无秘密信封。 |

### Request flow

每次搜索将当前 Settings section 快照为 provider 选项，在 base URL 后追加 `/grounding/search/clean`，并以 abort 与超时组合信号 POST `{ query, maxOutputTokens }`。响应的 `answer` 成为 `content`，`sources[]` 成为引用列表，seam 在返回路径上执行请求的 source 上限。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

当包级契约不够时，请阅读以下页面。

- [Web subsystem](../../../docs/subsystems/web.zh.md) — 详尽的搜索请求/结果词汇与错误码。
- [dsh-web](../web/README.zh.md) — 此 provider 注册进的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) — 渲染此 provider sources 的面向模型 `web_search` 工具。
- [Generated configuration catalog](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-grounding) — 每个可接受配置字段及其来源声明。

-----

<a id="model-experience"></a>
## Model Experience

### Conversation tool result

#### What the model sees

通过 `dsh-tool-web`，对话模型看到路由器的生成答案作为 `content`，以及去重后的来源 URL；不会臆造 title 或 snippet。provider 的失败包括 `Grounding search aborted` 与 `Grounding search request failed (is the llm-router service running?)`。错误包装由消费方负责。

#### Token effect

注册或搜索本身不消耗对话 token；路由器的生成答案作为结果内容到达，并随输出预算伸缩。

#### KV Cache effect

只追加；新出现的内容跟随可复用的请求前缀，不会使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


以下限制定义了 provider 何时不可用或不完整。它们是当前的包约束。

- **需要本地 llm-router** —— 每次搜索都分发到 `http://127.0.0.1:8787`（或配置的 base）；没有运行中的路由器时，搜索会以"路由器未运行"错误快速失败，而不是降级到其他后端。
- **来源只有 URL** —— 路由器返回纯 URL 来源与自由文本 `groundingSupports`；不会重建 title 与 snippet，因此渲染出的引用显示主机名。
- **答案 token 受 `maxOutputTokens` 约束** —— 大预算会花费路由器的生成成本；provider 不流式返回。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

本 Dev Note 是面向维护者的工作上下文：未决问题与未定方向。它明确不具权威性——已发布的行为、限制与理由见上文各节及所链接的 Agent Notes。

#### Future: streaming answer

路由器的生成答案目前整体接收；流式可降低大预算下的感知延迟，但在 llm-router 路由支持前暂缓。

</details>
