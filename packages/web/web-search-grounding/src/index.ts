/**
 * Register a Google Search grounding-backed provider in `ctx.web`. It calls the
 * local llm-router service's `/grounding/search/clean` endpoint, which owns the
 * Gemini API key and Google-grade retrieval — this plugin never sees a secret,
 * and the request body carries only the query and an output budget.
 * @module @deepseek-ai/dsh-web-search-grounding
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  GroundingSearchProvider,
  GROUNDING_DEFAULT_BASE_URL,
  GROUNDING_DEFAULT_MAX_OUTPUT_TOKENS,
  GROUNDING_SEARCH_TIMEOUT_MS,
} from './provider.ts'
import type { GroundingSearchProviderOptions } from './provider.ts'

export {
  GroundingSearchProvider,
  GROUNDING_DEFAULT_BASE_URL,
  GROUNDING_DEFAULT_MAX_OUTPUT_TOKENS,
  GROUNDING_SEARCH_TIMEOUT_MS,
  GROUNDING_PROVIDER_ID,
} from './provider.ts'
export type { GroundingSearchProviderOptions, GroundingSearchResponse } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-grounding'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Environment variable naming this provider's base URL. */
const BASE_URL_ENV = 'GROUNDING_SEARCH_BASE_URL'

/** Plugin config (all optional — `apply` fills defaults). */
export interface Config {
  /** Local llm-router base URL; `/grounding/search/clean` is appended. */
  baseURL: Volatile<string | undefined>
  /** Max output tokens for the router's generated answer (1–8192). */
  maxOutputTokens: Volatile<number>
  /** Per-search network timeout in milliseconds. */
  timeoutMs: Volatile<number>
}

export const Config = z.object({
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string().volatile(),
  maxOutputTokens: z.number().step(1).min(1).max(8192).default(GROUNDING_DEFAULT_MAX_OUTPUT_TOKENS).volatile(),
  timeoutMs: z.number().step(1).min(1).default(GROUNDING_SEARCH_TIMEOUT_MS).volatile(),
})

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider.
 * @param ctx - plugin context supplying the environment plane.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(
  ctx: Context, config: { [K in keyof Config]: ReturnType<Config[K]['get']> },
): GroundingSearchProviderOptions {
  return {
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? GROUNDING_DEFAULT_BASE_URL,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  }
}

/** Register the grounding search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new GroundingSearchProvider(() => resolveOptions(ctx, {
    baseURL: config.baseURL.get(),
    maxOutputTokens: config.maxOutputTokens.get(),
    timeoutMs: config.timeoutMs.get(),
  })))
}
