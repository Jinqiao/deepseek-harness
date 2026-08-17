/**
 * `LocalSearchProvider`: a `WebSearchProvider` backed by a local grounding
 * search endpoint (`POST {baseURL}/grounding/search/clean`). It sends the query
 * as a JSON body and maps the generated `answer` plus the `sources[]` domain
 * names into the seam's normalized `WebSearchResult`.
 *
 * @module @deepseek-ai/dsh-web-search-local/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { LocalSearchError, LocalSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const LOCAL_PROVIDER_ID = 'local'

/** Default search endpoint base; `/grounding/search/clean` is appended. */
export const LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface LocalSearchProviderOptions {
  /** Endpoint base; `/grounding/search/clean` is appended. */
  baseURL: string
}

/**
 * Map one domain name to a normalized source. The local engine returns bare
 * domain names (for example `weather.gov`), so the seam's required `url` is
 * derived as `https://<domain>`. A blank domain is dropped.
 *
 * @param domain - one entry of the local `sources[]`.
 * @returns the normalized source, or `undefined` when the domain is blank.
 */
export function mapLocalSource(domain: string): WebSearchSource | undefined {
  const trimmed = domain.trim()
  if (trimmed.length === 0) return undefined
  return { url: `https://${trimmed}` }
}

/**
 * Map a local response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /grounding/search/clean` response body.
 * @returns the normalized result; blank domains are dropped
 *   ({@link mapLocalSource}).
 */
export function mapLocalResponse(response: LocalSearchResponse): WebSearchResult {
  const sources = (response.sources ?? [])
    .map(mapLocalSource)
    .filter((source): source is WebSearchSource => source !== undefined)
  // The local engine returns a generated answer, so `content` is set from it.
  // The web service owns the final `maxResults` truncation, so this provider
  // reports `truncated: false`.
  return {
    ...response.answer != null && response.answer.length > 0 ? { content: response.answer } : {},
    sources,
    truncated: false,
  }
}

/** The local grounding-search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class LocalSearchProvider implements WebSearchProvider {
  readonly id = LOCAL_PROVIDER_ID

  constructor(private readonly options: LocalSearchProviderOptions) {}

  available(): boolean {
    return isValidBaseUrl(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/grounding/search/clean`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ query: request.query }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Local search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Local search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Local search API error (HTTP ${status})`
      try {
        const parsed = await response.json() as LocalSearchError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Local search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body can only cost a richer provider message,
        // never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as LocalSearchResponse
      return mapLocalResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Local search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Local search returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
