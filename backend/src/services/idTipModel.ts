import Anthropic from '@anthropic-ai/sdk';
import { ID_TIP_MODEL, ID_TIP_SYSTEM, buildIdTipPrompt, type IdTipRequest } from '../lib/idTip';
import { USER_AGENT } from '../lib/userAgent';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit for a base64 image
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const MODEL_TIMEOUT_MS = 30_000;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: MODEL_TIMEOUT_MS, maxRetries: 1 }) : null;
  return client;
}

export function idTipsConfigured(): boolean {
  return getClient() !== null;
}

async function loadImage(url: string): Promise<{ data: string; mediaType: ImageMediaType }> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image too large (${bytes.length} bytes)`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mediaType = (['image/png', 'image/webp', 'image/gif'] as const).find(t => t === type) ?? 'image/jpeg';
  return { data: bytes.toString('base64'), mediaType };
}

/**
 * Asks Claude for a tip about the photo. Resolves to null when the model declines or returns no text;
 * throws on network/API errors. The caller has already validated the request and the photo.
 */
export async function generateIdTip(r: IdTipRequest): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not set');
  const image = await loadImage(r.photoUrl);

  const msg = await anthropic.messages.create({
    model: ID_TIP_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: ID_TIP_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: buildIdTipPrompt(r) },
      ],
    }],
  });

  if (msg.stop_reason === 'refusal') {
    console.warn(`[id-tip] ${r.speciesCode}: model declined (${msg.stop_details?.category ?? 'no category'})`);
    return null;
  }
  const text = msg.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim();
  return text || null;
}
