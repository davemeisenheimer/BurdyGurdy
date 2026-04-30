/**
 * Route an xeno-canto audio URL through our backend proxy.
 * Needed for two reasons:
 *  1. fetch() / Web Audio API: xeno-canto doesn't send CORS headers, so direct
 *     fetch() calls are blocked even though <audio> elements load fine.
 *  2. Content-Length: the proxy forwards the upstream Content-Length header,
 *     which lets the browser estimate seekable range for VBR MP3s that would
 *     otherwise report duration = Infinity until fully buffered.
 */
export function toProxyUrl(xcUrl: string | null | undefined): string {
  if (!xcUrl) return '';
  const normalized = xcUrl.startsWith('//') ? `https:${xcUrl}` : xcUrl;
  return `/api/proxy/audio?url=${encodeURIComponent(normalized)}`;
}
