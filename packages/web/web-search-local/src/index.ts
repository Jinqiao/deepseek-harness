/**
 * `@deepseek-ai/dsh-web-search-local`: registers a local grounding-search-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@deepseek-ai/dsh-llm-deepseek` registers an adapter into `ctx.llm`. The key
 * is owned by `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { LOCAL_DEFAULT_BASE_URL, LocalSearchProvider } from './provider.ts'

export {
  LOCAL_DEFAULT_BASE_URL,
  LOCAL_PROVIDER_ID,
  LocalSearchProvider,
} from './provider.ts'
export type { LocalSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-local'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills constant defaults). */
export interface Config {
  /** Endpoint base; `/grounding/search/clean` is appended. Defaults to the local default. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
})

/** Register the local search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new LocalSearchProvider({
    baseURL: config.baseURL ?? LOCAL_DEFAULT_BASE_URL,
  }))
}
