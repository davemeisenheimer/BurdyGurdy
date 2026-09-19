import { describe, it, expect } from 'vitest';
import { classifyUpstreamError, identifyUpstreamService } from './upstreamError';

describe('classifyUpstreamError', () => {
  it('classifies a 500 response as upstream-5xx with the status code', () => {
    const err = { response: { status: 500 } };
    expect(classifyUpstreamError(err)).toEqual({ code: 'upstream-5xx', statusCode: 500 });
  });

  it('classifies a 503 response as upstream-5xx', () => {
    const err = { response: { status: 503 } };
    expect(classifyUpstreamError(err)).toEqual({ code: 'upstream-5xx', statusCode: 503 });
  });

  it('classifies a 429 response as rate-limited, not upstream-4xx', () => {
    const err = { response: { status: 429 } };
    expect(classifyUpstreamError(err)).toEqual({ code: 'rate-limited', statusCode: 429 });
  });

  it('classifies a 404 response as upstream-4xx', () => {
    const err = { response: { status: 404 } };
    expect(classifyUpstreamError(err)).toEqual({ code: 'upstream-4xx', statusCode: 404 });
  });

  it('classifies an axios timeout (ECONNABORTED) as timeout', () => {
    const err = { code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' };
    expect(classifyUpstreamError(err)).toEqual({ code: 'timeout' });
  });

  it('classifies a message mentioning timeout even without the axios code', () => {
    const err = { message: 'Request timeout' };
    expect(classifyUpstreamError(err)).toEqual({ code: 'timeout' });
  });

  it('classifies DNS/connection failures as network', () => {
    expect(classifyUpstreamError({ code: 'ENOTFOUND' })).toEqual({ code: 'network' });
    expect(classifyUpstreamError({ code: 'ECONNREFUSED' })).toEqual({ code: 'network' });
    expect(classifyUpstreamError({ code: 'ECONNRESET' })).toEqual({ code: 'network' });
  });

  it('classifies a generic "Network Error" message as network', () => {
    const err = { message: 'Network Error' };
    expect(classifyUpstreamError(err)).toEqual({ code: 'network' });
  });

  it('classifies a request with no response and no known code as network', () => {
    const err = { request: {} };
    expect(classifyUpstreamError(err)).toEqual({ code: 'network' });
  });

  it('classifies an unrecognized error shape as unknown', () => {
    expect(classifyUpstreamError({ message: 'something odd happened' })).toEqual({ code: 'unknown' });
  });

  it('handles non-object thrown values without crashing', () => {
    expect(classifyUpstreamError('boom')).toEqual({ code: 'unknown' });
    expect(classifyUpstreamError(undefined)).toEqual({ code: 'unknown' });
    expect(classifyUpstreamError(null)).toEqual({ code: 'unknown' });
  });

  it('prefers response status over a coincidentally timeout-like message', () => {
    // A real upstream 500 whose body happens to mention "timeout" should still be upstream-5xx -
    // the response actually arrived, so it's not a client-side timeout.
    const err = { response: { status: 500 }, message: 'upstream reported a timeout' };
    expect(classifyUpstreamError(err)).toEqual({ code: 'upstream-5xx', statusCode: 500 });
  });
});

describe('identifyUpstreamService', () => {
  it('identifies eBird from a relative url + baseURL (axios.create pattern)', () => {
    const err = { config: { baseURL: 'https://api.ebird.org/v2', url: '/data/obs/US-NE/recent' } };
    expect(identifyUpstreamService(err)).toBe('eBird');
  });

  it('identifies xeno-canto from a full url', () => {
    const err = { config: { url: 'https://xeno-canto.org/api/3/recordings?query=norcar' } };
    expect(identifyUpstreamService(err)).toBe('xeno-canto');
  });

  it('identifies the Macaulay Library from its search host', () => {
    const err = { config: { url: 'https://search.macaulaylibrary.org/api/v1/search' } };
    expect(identifyUpstreamService(err)).toBe('the Macaulay Library');
  });

  it('identifies the Macaulay Library from its Cornell CDN host', () => {
    const err = { config: { url: 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset/123' } };
    expect(identifyUpstreamService(err)).toBe('the Macaulay Library');
  });

  it('identifies iNaturalist', () => {
    const err = { config: { url: 'https://api.inaturalist.org/v1/taxa?q=norcar' } };
    expect(identifyUpstreamService(err)).toBe('iNaturalist');
  });

  it('identifies Wikipedia', () => {
    const err = { config: { url: 'https://en.wikipedia.org/w/api.php' } };
    expect(identifyUpstreamService(err)).toBe('Wikipedia');
  });

  it('returns undefined for an unrecognized host', () => {
    const err = { config: { url: 'https://example.com/whatever' } };
    expect(identifyUpstreamService(err)).toBeUndefined();
  });

  it('returns undefined when there is no config on the error', () => {
    expect(identifyUpstreamService({})).toBeUndefined();
    expect(identifyUpstreamService(undefined)).toBeUndefined();
  });
});
