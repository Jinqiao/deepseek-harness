import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { LocalSearchProvider, LOCAL_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-local'
import * as localPlugin from '@deepseek-ai/dsh-web-search-local'
import { mapLocalResponse, mapLocalSource } from '../src/provider.ts'

const options = { baseURL: 'http://127.0.0.1:8787' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Local source mapping', () => {
  it('maps a domain name to a https URL', () => {
    expect(mapLocalSource('weather.gov')).toEqual({ url: 'https://weather.gov' })
  })

  it('trims surrounding whitespace from a domain', () => {
    expect(mapLocalSource('  wunderground.com  ')).toEqual({ url: 'https://wunderground.com' })
  })

  it('drops a blank domain', () => {
    expect(mapLocalSource('')).toBeUndefined()
    expect(mapLocalSource('   ')).toBeUndefined()
  })
})

describe('Local response mapping', () => {
  it('maps answer to content and domains to sources', () => {
    const result = mapLocalResponse({
      answer: 'Sunny and pleasant.',
      sources: ['weather.gov', 'wunderground.com'],
      groundingSupports: ['Sunny and pleasant'],
      query: 'weather',
    })
    expect(result).toEqual({
      content: 'Sunny and pleasant.',
      sources: [
        { url: 'https://weather.gov' },
        { url: 'https://wunderground.com' },
      ],
      truncated: false,
    })
  })

  it('omits content when the answer is absent or blank', () => {
    expect(mapLocalResponse({ sources: ['weather.gov'] }).content).toBeUndefined()
    expect(mapLocalResponse({ answer: '', sources: ['weather.gov'] }).content).toBeUndefined()
  })

  it('tolerates a missing sources array', () => {
    expect(mapLocalResponse({ answer: 'hi' }).sources).toEqual([])
  })

  it('drops blank domains from the sources list', () => {
    const result = mapLocalResponse({ sources: ['weather.gov', '', '  '] })
    expect(result.sources).toEqual([{ url: 'https://weather.gov' }])
  })
})

describe('LocalSearchProvider availability', () => {
  it('is unavailable with an unparseable base URL', () => {
    expect(new LocalSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is available with a parseable base URL', () => {
    expect(new LocalSearchProvider(options).available()).toBe(true)
  })
})

describe('LocalSearchProvider request mapping', () => {
  it('sends the query as JSON to the grounding endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ answer: 'hi', sources: ['weather.gov'] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new LocalSearchProvider(options)
    await provider.search({ query: 'how is the weather tomorrow in NYC' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8787/grounding/search/clean')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(JSON.parse(init.body as string)).toEqual({ query: 'how is the weather tomorrow in NYC' })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new LocalSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('LocalSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad query' }, { status: 400 })))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad query' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Local search API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Local search API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ sources: {} }, { status: 200 })))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new LocalSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-local plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ sources: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: LOCAL_PROVIDER_ID })
    const fiber = await ctx.plugin(localPlugin, {})
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in localPlugin).toBe(false)
  })

  it('uses the default base URL when config omits it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: LOCAL_PROVIDER_ID })
    const fiber = await ctx.plugin(localPlugin, {})
    await ctx.web.search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('http://127.0.0.1:8787/grounding/search/clean')
    await fiber.dispose()
  })

  it('is unavailable when the base URL is unparseable', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: LOCAL_PROVIDER_ID })
    await ctx.plugin(localPlugin, { baseURL: 'not a url' })
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })
})
