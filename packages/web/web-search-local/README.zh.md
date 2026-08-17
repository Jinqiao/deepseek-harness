# @deepseek-ai/dsh-web-search-local

[English](README.md) | 中文

一个**本地 grounding 搜索后端**的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它调用本地端点的 `POST /grounding/search/clean` 并传入 JSON 请求体，把生成的 `answer` 与 `sources[]` 域名数组映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有 `ctx.web` 键，也不注册面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。它是函数／命名空间插件（`inject: ['web']`），负责注册后端，而非默认导出服务。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `http://127.0.0.1:8787` | 端点基址；追加 `/grounding/search/clean`。无法解析时提供方不可用。 |

```yaml
- id: web-search-local
  name: '@deepseek-ai/dsh-web-search-local'
  config:
    baseURL: http://127.0.0.1:8787
```

## 请求

每次搜索向 `POST {baseURL}/grounding/search/clean` 发送一个 JSON 请求体，携带模型查询词：

```json
{ "query": "how is the weather tomorrow in NYC" }
```

## 映射

本地引擎返回生成的 `answer` 和 `sources[]` 域名数组（例如 `weather.gov`）。`content` 取自 `answer`。每个域名映射为 `WebSearchSource`，其 `url` 推导为 `https://<domain>`（seam 要求可引用的 URL）；空白域名会被丢弃。`groundingSupports[]` 与回显的 `query` 是提供方私有字段，不进入上下文。提供方失败（HTTP 错误、网络失败、响应体无法解析或结构不符）以 `WebError` `WEB_PROVIDER_ERROR` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.md) 间接影响；该工具保留此提供方生成的答案及其经 `maxResults` 限制的 `https://<domain>` 来源，或将确切的错误消息 `Local search aborted`、`Local search request failed: <error>` 和 `Local search returned an unprocessable response body: <error>` 置于消费方的错误包装层内；`groundingSupports[]` 与其他提供方私有字段不进入上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **来源是域名而非完整 URL**：本地引擎返回裸域名，因此 seam 的 `url` 推导为 `https://<domain>`；来源无法指向具体页面。
- **请求词汇刻意保持精简**：只有 `query` 会到达本地端点；引擎特定的控制项（过滤条件、排序权重、地区提示）等待提供方无关的 Service Definition 字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **按错误形状分类中止**：只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。
