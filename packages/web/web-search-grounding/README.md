---
description: "The Google Search grounding-backed provider for ctx.web: how deployments mount local llm-router search with no API key on the machine running the harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-grounding

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-grounding`, the harness searches the web through a local llm-router service's `/grounding/search/clean` endpoint, which owns the Gemini API key and Google-grade retrieval. Choose it when a deployment runs the llm-router beside the harness and wants high-quality grounding without exposing a search credential to the agent process: no model turn is spent, no secret leaves the router, and the request body carries only the query and an output budget. A search against an unstarted router fails with an actionable `WEB_PROVIDER_ERROR`; the provider id is `grounding`. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `grounding` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: grounding`.

### When to choose it

Choose this backend when a deployment runs the llm-router service locally and wants the harness to never hold a search credential. The router is the single place the Gemini API key lives; the provider is a thin HTTP adapter onto the `ctx.web` seam. One search is a single HTTP round trip to the router — no auxiliary model turn — so cost and latency are the router's own retrieval cost. Avoid it when no local router is available, because every search then fails fast with the router-not-running error.

### Minimal configuration

Load the web service and the provider; the router base URL defaults to the local endpoint. The base URL resolves from the Settings section, then `$GROUNDING_SEARCH_BASE_URL`, then the default.

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
| `baseURL` | `http://127.0.0.1:8787` | Local llm-router base URL; `/grounding/search/clean` is appended. Falls back to `$GROUNDING_SEARCH_BASE_URL`; an unparseable value makes the provider unavailable |
| `maxOutputTokens` | `256` | Max output tokens for the router's generated answer (1–8192) |
| `timeoutMs` | `30000` | Per-search network timeout in milliseconds |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-grounding) is the exhaustive source for every accepted field and its JSDoc. The entry above is the base layer of the provider's Settings section; a user layer over it reaches the next search, because the provider projects the section per call rather than capturing it at registration.

### What a search returns

`content` is the router's generated, grounded answer text. `sources[]` comes from the router's `sources` URL list; the router's `groundingSupports` are free-text citations rather than per-URL metadata, so they surface on the answer text and no title or snippet is invented. `truncated` is always false at the provider: the seam enforces the request's `maxResults` bound on the way back.

### Failures and recovery

Failures throw `WebError` with a machine-routable code: caller cancellation is `WEB_ABORTED`, and provider or transport failures are `WEB_PROVIDER_ERROR`. HTTP redirects are rejected before the `Location` target is contacted. A `503` carries the router-not-running message with a start hint; a response with neither answer nor sources fails loudly rather than degrading. The request body never carries a credential, so a leaked body cannot leak a key.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is built on two commitments:

- **The router owns the credential and the retrieval.** The provider sends only the query and the output budget to `/grounding/search/clean`. No model turn is spent and no key leaves the machine: the Gemini credential lives exclusively in the llm-router service.
- **Per-search option projection.** The provider resolves the current Settings section per call, so a committed settings change reaches the next search without re-registration, and a settings write between searches never mixes two sections.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, Settings section installation, per-search option projection |
| [`src/provider.ts`](src/provider.ts) | The `GroundingSearchProvider`: HTTP dispatch, abort handling, response mapping |
| — | No runtime invariant companion is published; the request is a plain HTTP POST with no model turn, so there is no secret-free envelope to relate to a later authoritative event. |

### Request flow

Each search snapshots the current Settings section into provider options, appends `/grounding/search/clean` to the base URL, and POSTs `{ query, maxOutputTokens }` with an abort-and-timeout composite signal. The response's `answer` becomes `content`, `sources[]` becomes the citation list, and the seam enforces the requested source bound on the way back.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-grounding) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Conversation tool result

#### What the model sees

Through `dsh-tool-web`, the conversation model sees the router's generated answer as `content`, plus deduplicated source URLs; no title or snippet is invented. The provider's failures include `Grounding search aborted` and `Grounding search request failed (is the llm-router service running?)`. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration or search; the router's generated answer arrives as result content and scales with the output budget.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is unavailable or incomplete. They are current package constraints.

- **Requires a local llm-router** — every search dispatches to `http://127.0.0.1:8787` (or the configured base); with no router running, searches fail fast with the router-not-running error instead of degrading to another backend.
- **Sources are URL-only** — the router returns plain source URLs and free-text `groundingSupports`; titles and snippets are not reconstructed, so rendered citations show the hostname.
- **Answer tokens are bounded by `maxOutputTokens`** — a large budget costs the router's generation; the provider does not stream.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: streaming answer

The router's generated answer is currently received whole; streaming would lower perceived latency for large budgets but is deferred until the llm-router route supports it.

</details>
