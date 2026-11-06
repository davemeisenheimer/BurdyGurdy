import type { Request, Response, NextFunction } from 'express';

/** Completed requests slower than this are logged. */
export const SLOW_REQUEST_MS = 3_000;
/** Requests still running after this get a "still running" warning (once). */
export const HANGING_REQUEST_MS = 10_000;

/** Long-lived media streams are expected to run for a while; don't report them. */
export function isTimedPath(path: string): boolean {
  return path.startsWith('/api/') && !path.startsWith('/api/proxy/');
}

export function formatRequestLog(method: string, url: string, status: number | null, ms: number, aborted: boolean): string {
  const outcome = aborted ? 'client disconnected' : `HTTP ${status}`;
  return `[request] slow: ${method} ${url} - ${outcome} after ${ms}ms`;
}

/** Strips the query string's values so logs stay short and free of tokens or personal data. */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const keys = url.slice(q + 1).split('&').map(kv => kv.split('=')[0]).filter(Boolean);
  return `${url.slice(0, q)}?${keys.join('&')}`;
}

/** Express middleware: logs slow requests and warns about ones that appear to hang. */
export function requestTiming(req: Request, res: Response, next: NextFunction): void {
  if (!isTimedPath(req.path)) { next(); return; }
  const t0 = Date.now();
  const url = redactUrl(req.originalUrl);
  const hangTimer = setTimeout(() => {
    console.warn(`[request] still running after ${HANGING_REQUEST_MS}ms: ${req.method} ${url}`);
  }, HANGING_REQUEST_MS);

  let logged = false;
  const done = () => {
    if (logged) return;
    logged = true;
    clearTimeout(hangTimer);
    const ms = Date.now() - t0;
    if (ms >= SLOW_REQUEST_MS) console.warn(formatRequestLog(req.method, url, res.statusCode, ms, !res.writableFinished));
  };
  res.on('finish', done);
  res.on('close', done);
  next();
}
