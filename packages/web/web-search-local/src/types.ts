/**
 * Wire types for the local grounding search API (`POST {baseURL}/grounding/search/clean`).
 * Types only — no runtime code. The endpoint returns a generated `answer`, a
 * `sources[]` array of domain names, and `groundingSupports[]` supporting
 * statements; the request echoes the `query` back.
 *
 * @module @deepseek-ai/dsh-web-search-local/types
 */

/** Request body sent to the local grounding search endpoint. */
export interface LocalSearchRequest {
  query: string
}

/** The local grounding search response envelope. */
export interface LocalSearchResponse {
  /** Provider-generated answer text. */
  answer?: string
  /** Domain names backing the answer. */
  sources?: string[]
  /** Supporting statements grounding the answer. */
  groundingSupports?: string[]
  /** The echoed query. */
  query?: string
}

/** The local search error response envelope (best-effort; fields vary). */
export interface LocalSearchError {
  error?: string
  message?: string
}
