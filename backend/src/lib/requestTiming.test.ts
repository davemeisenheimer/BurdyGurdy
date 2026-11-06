import { describe, it, expect } from 'vitest';
import { isTimedPath, formatRequestLog, redactUrl } from './requestTiming';

describe('isTimedPath', () => {
  it('times API routes', () => {
    expect(isTimedPath('/api/quiz/questions')).toBe(true);
    expect(isTimedPath('/api/birds/taxonomy')).toBe(true);
  });

  it('skips media proxy streams and non-API paths', () => {
    expect(isTimedPath('/api/proxy/audio')).toBe(false);
    expect(isTimedPath('/health')).toBe(false);
    expect(isTimedPath('/assets/index.js')).toBe(false);
  });
});

describe('redactUrl', () => {
  it('keeps query keys but drops values', () => {
    expect(redactUrl('/api/birds/taxonomy?codes=amro,bcch&x=1')).toBe('/api/birds/taxonomy?codes&x');
  });

  it('leaves URLs without a query unchanged', () => {
    expect(redactUrl('/api/feedback')).toBe('/api/feedback');
  });
});

describe('formatRequestLog', () => {
  it('formats a completed request', () => {
    expect(formatRequestLog('POST', '/api/quiz/questions', 200, 4200, false))
      .toBe('[request] slow: POST /api/quiz/questions - HTTP 200 after 4200ms');
  });

  it('formats a request the client abandoned', () => {
    expect(formatRequestLog('GET', '/api/birds/photos/amro', 200, 30000, true))
      .toBe('[request] slow: GET /api/birds/photos/amro - client disconnected after 30000ms');
  });
});
