/**
 * Google Search grounding search through the local llm-router service
 * (`POST /grounding/search/clean`). The router owns the Gemini API key and
 * Google-grade retrieval; this provider is a thin HTTP adapter onto dsh's
 * `ctx.web` seam. No model turn is spent and no credential leaves the machine:
 * the request body carries only the query and the optional output budget.
 * @module @deepseek-ai/dsh-web-search-grounding/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const GROUNDING_PROVIDER_ID = 'grounding'

/** Default endpoint of the local llm-router grounding search route. */
export const GROUNDING_DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

/** Default budget for the router's generated answer, in output tokens. */
export const GROUNDING_DEFAULT_MAX_OUTPUT_TOKENS = 256

/** Network budget for one search; the router itself owns the Gemini call. */
export const GROUNDING_SEARCH_TIMEOUT_MS = 30_000

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** The llm-router grounding search response shape (secret-free subset). */
export interface GroundingSearchResponse {
  error?: string
  answer?: string
  sources?: string[]
  groundingSupports?: string[]
  query?: string
}

/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface GroundingSearchProviderOptions {
  /** Local llm-router base URL; `/grounding/search/clean` is appended. */
  baseURL: string
  /** Max output tokens for the router's generated answer (1–8192). */
  maxOutputTokens: number
  /** Per-search network timeout in milliseconds. */
  timeoutMs: number
}

/**
 * Map one router source URL to a citeable `WebSearchSource`. The router's
 * `sources` entries are plain URLs; titles/snippets (when any) live in the
 * generated answer's `groundingSupports`, which are free-text citations rather
 * than per-URL structured metadata, so they are surfaced on the answer text
 * rather than invented here.
 * @param url - a source URL from the router response.
 * @returns the normalized source (title falls back to the hostname at render).
 */
export function mapSource(url: string): WebSearchSource {
  return { url }
}

/**
 * Map a router response to a normalized search result. `content` is the
 * router's generated, grounded answer; `sources` are the URL list; `truncated`
 * is false because the router returns as many sources as it found (dsh's seam
 * enforces the `maxResults` bound on the way back).
 * @param data - the parsed router response body.
 * @returns the normalized result.
 */
export function mapGroundingResponse(data: GroundingSearchResponse): WebSearchResult {
  const answer = data.answer?.trim() ?? ''
  const sources = (data.sources ?? []).filter(url => url.length > 0).map(mapSource)
  if (answer.length === 0 && sources.length === 0) {
    throw new WebError('Grounding search returned no answer or sources', 'WEB_PROVIDER_ERROR')
  }
  return { content: answer, sources, truncated: false }
}

/** The llm-router-backed grounding search provider. */
export class GroundingSearchProvider implements WebSearchProvider {
  readonly id = GROUNDING_PROVIDER_ID

  /**
   * @param resolveOptions - options for the NEXT operation, snapshotted once
   * per search so a settings write between searches never mixes two sections.
   */
  constructor(private readonly resolveOptions: () => GroundingSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return URL.canParse(options.baseURL)
      && Number.isInteger(options.maxOutputTokens)
      && options.maxOutputTokens >= 1
      && options.maxOutputTokens <= 8192
      && Number.isInteger(options.timeoutMs)
      && options.timeoutMs > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    throwIfSearchAborted(signal)
    const endpoint = `${options.baseURL.replace(/\/+$/u, '')}/grounding/search/clean`
    const body: Record<string, unknown> = {
      query: request.query,
      maxOutputTokens: options.maxOutputTokens,
    }

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          ...signal !== undefined ? [signal] : [],
          AbortSignal.timeout(options.timeoutMs),
        ]),
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Grounding search request failed (is the llm-router service running?): ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (response.status === 503) {
      throw new WebError(
        'Grounding search unavailable: the llm-router service is not running. '
        + 'Start it with: sudo systemctl start llm-router',
        'WEB_PROVIDER_ERROR',
      )
    }

    if (!response.ok) {
      throw new WebError(`Grounding search failed: HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
    }

    let data: GroundingSearchResponse
    try {
      data = await response.json() as GroundingSearchResponse
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Grounding search returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (data.error !== undefined && data.error.length > 0) {
      throw new WebError(`Grounding search error: ${data.error}`, 'WEB_PROVIDER_ERROR')
    }

    return mapGroundingResponse(data)
  }
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Grounding search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
