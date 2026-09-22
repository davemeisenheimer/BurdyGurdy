// Load .env before reading BURDYGURDY_CONTACT below: service modules are imported (and evaluate
// their HEADERS constants) before index.ts gets to call dotenv.config().
import 'dotenv/config';

/**
 * User-Agent sent on outbound requests to third-party APIs (iNaturalist, Wikipedia/Wikimedia,
 * Nominatim). Wikimedia's User-Agent policy asks for a descriptive agent that includes a way to
 * contact the operator, and Nominatim's usage policy asks for an identifying agent too.
 * https://meta.wikimedia.org/wiki/User-Agent_policy
 *
 * Deliberately not used by routes/proxy.ts, which mimics a browser on purpose.
 */
const BASE = 'BurdyGurdy/1.0 (bird identification learning app';

/** Pure: appends the operator contact (email or URL) when one is provided. Exported for tests. */
export function buildUserAgent(contact?: string): string {
  const trimmed = contact?.trim();
  return trimmed ? `${BASE}; ${trimmed})` : `${BASE})`;
}

const contact = process.env.BURDYGURDY_CONTACT;
if (!contact?.trim()) {
  console.warn('[user-agent] BURDYGURDY_CONTACT is not set - outbound requests will not identify a contact address');
}

export const USER_AGENT = buildUserAgent(contact);
