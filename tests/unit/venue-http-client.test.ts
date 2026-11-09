import { afterEach, describe, expect, it, vi } from 'vitest';
import { VenueHttpClient } from '@/lib/sources/venue/http-client';

describe('VenueHttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches successfully and returns HTML body with headers and timestamp', async () => {
    const mockHtml = '<html><body><h1>Concerts</h1></body></html>';
    const mockResponse = new Response(mockHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const client = new VenueHttpClient({ maxRetries: 0 });
    const result = await client.get('https://example.com/events');

    expect(result.status).toBe(200);
    expect(result.body).toBe(mockHtml);
    expect(result.contentType).toBe('text/html; charset=utf-8');
    expect(result.url).toBe('https://example.com/events');
    expect(typeof result.fetchedAt).toBe('string');
  });

  it('includes polite User-Agent and Accept headers in requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const client = new VenueHttpClient({
      userAgent: 'CustomAgent/1.0',
      maxRetries: 0,
    });
    await client.get('https://example.com/events');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers['User-Agent']).toBe('CustomAgent/1.0');
    expect(headers['Accept']).toContain('text/html');
  });

  it('retries on HTTP 429 Too Many Requests and succeeds on second attempt', async () => {
    const rateLimitResponse = new Response('Rate limited', {
      status: 429,
      headers: { 'Retry-After': '0' },
    });
    const successResponse = new Response('<html>ok</html>', { status: 200 });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);

    const client = new VenueHttpClient({
      maxRetries: 1,
      retryBaseDelayMs: 10,
    });
    const result = await client.get('https://example.com/events');

    expect(result.status).toBe(200);
    expect(result.body).toBe('<html>ok</html>');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws descriptive error on non-retryable 404 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    const client = new VenueHttpClient({ maxRetries: 0 });
    await expect(client.get('https://example.com/events')).rejects.toThrow(
      'Venue HTTP fetch failed for https://example.com/events with status 404',
    );
  });

  it('surfaces post-redirect URL when response.url is populated', async () => {
    const mockResponse = new Response('<html>redirected</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    Object.defineProperty(mockResponse, 'url', {
      value: 'https://example.com/events/final-destination',
      writable: false,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const client = new VenueHttpClient({ maxRetries: 0 });
    const result = await client.get('https://example.com/events/initial');

    expect(result.status).toBe(200);
    expect(result.url).toBe('https://example.com/events/final-destination');
  });

  it('validates redirect destination before following and prevents network requests to unapproved URLs', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr === 'https://allowed.com/initial') {
          return Promise.resolve(
            new Response(null, {
              status: 301,
              headers: {
                location: 'https://untrusted-destination.com/malicious',
              },
            }),
          );
        }
        if (urlStr === 'https://untrusted-destination.com/malicious') {
          return Promise.resolve(
            new Response('malicious content', { status: 200 }),
          );
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      });

    const client = new VenueHttpClient({ maxRetries: 0 });
    const validateRedirectUrl = (url: string) =>
      url.startsWith('https://allowed.com/');

    await expect(
      client.get('https://allowed.com/initial', { validateRedirectUrl }),
    ).rejects.toThrow(
      'Disallowed redirect destination: https://untrusted-destination.com/malicious',
    );

    // Crucial: proves fetch was NEVER invoked for the untrusted destination!
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      'https://untrusted-destination.com/malicious',
      expect.anything(),
    );
  });

  it('allows and follows validated same-site redirects up to bounded limit', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr === 'https://allowed.com/step1') {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: 'https://allowed.com/step2' },
            }),
          );
        }
        if (urlStr === 'https://allowed.com/step2') {
          return Promise.resolve(
            new Response('<html>legitimate final page</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          );
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      });

    const client = new VenueHttpClient({ maxRetries: 0 });
    const validateRedirectUrl = (url: string) =>
      url.startsWith('https://allowed.com/');

    const result = await client.get('https://allowed.com/step1', {
      validateRedirectUrl,
      maxRedirects: 2,
    });

    expect(result.status).toBe(200);
    expect(result.url).toBe('https://allowed.com/step2');
    expect(result.body).toBe('<html>legitimate final page</html>');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('enforces maximum redirect limit and throws when exceeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://allowed.com/loop' },
        }),
      );
    });

    const client = new VenueHttpClient({ maxRetries: 0 });
    const validateRedirectUrl = (url: string) =>
      url.startsWith('https://allowed.com/');

    await expect(
      client.get('https://allowed.com/loop', {
        validateRedirectUrl,
        maxRedirects: 2,
      }),
    ).rejects.toThrow('Exceeded maximum redirect limit of 2');
  });
});
