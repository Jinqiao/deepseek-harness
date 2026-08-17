# @deepseek-ai/dsh-web-search-local

English | [中文](README.zh.md)

A **local grounding-search-backed** `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls a local endpoint's `POST /grounding/search/clean` with a JSON body and maps the generated `answer` plus the `sources[]` domain names into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). It is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `http://127.0.0.1:8787` | Endpoint base; `/grounding/search/clean` is appended. An unparseable value makes the provider unavailable. |

```yaml
- id: web-search-local
  name: '@deepseek-ai/dsh-web-search-local'
  config:
    baseURL: http://127.0.0.1:8787
```

## Request

Each search sends `POST {baseURL}/grounding/search/clean` with a JSON body carrying the model query:

```json
{ "query": "how is the weather tomorrow in NYC" }
```

## Mapping

The local engine returns a generated `answer` and a `sources[]` array of bare domain names (for example `weather.gov`). `content` is set from `answer`. Each domain maps to a `WebSearchSource` whose `url` is derived as `https://<domain>` (the seam requires a citeable URL); a blank domain is dropped. `groundingSupports[]` and the echoed `query` are provider-private and stay out of context. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's generated answer and its `maxResults`-bounded `https://<domain>` sources or its exact `Local search aborted`, `Local search request failed: <error>`, and `Local search returned an unprocessable response body: <error>` failures under the consumer's error wrapper while `groundingSupports[]` and other provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Sources are domain names, not full URLs** — the local engine returns bare domains, so the seam's `url` is derived as `https://<domain>`; a source cannot point at a specific page.
- **The request vocabulary is deliberately minimal** — only `query` reaches the local endpoint; engine-specific controls (filters, ranking weights, regional hints) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
