import { describe, expect, it } from 'vitest'

import { config, middleware, runtime } from '../middleware'

describe('short-link middleware runtime', () => {
  it('uses the Node.js runtime required by the configured KV client', () => {
    expect(runtime).toBe('nodejs')
    expect(config.matcher).toBe('/s/:path*')
  })

  it('fails closed to the home page when KV is not configured', async () => {
    const previousUrl = process.env.KV_REST_API_URL
    const previousToken = process.env.KV_REST_API_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN

    try {
      const request = {
        nextUrl: new URL('https://example.test/s/missing'),
        url: 'https://example.test/s/missing',
      }

      const response = await middleware(request as never)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('https://example.test/')
    } finally {
      if (previousUrl === undefined) delete process.env.KV_REST_API_URL
      else process.env.KV_REST_API_URL = previousUrl
      if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN
      else process.env.KV_REST_API_TOKEN = previousToken
    }
  })
})
