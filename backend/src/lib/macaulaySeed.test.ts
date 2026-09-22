import { describe, it, expect } from 'vitest';
import {
  macaulayItemToPhoto, classifyMacaulayBody, parseSeedArgs, selectSeedTargets, jitteredDelayMs,
  MACAULAY_CDN, SEED_DEFAULTS,
} from './macaulaySeed';

describe('macaulayItemToPhoto', () => {
  it('builds the CDN url and credit', () => {
    expect(macaulayItemToPhoto({ assetId: 123456, userDisplayName: 'Jane Smith' })).toEqual({
      url: `${MACAULAY_CDN}/123456/1800`,
      credit: '© Jane Smith · Macaulay Library',
      source: 'macaulay',
    });
  });

  it('falls back to a plain credit when there is no contributor name', () => {
    expect(macaulayItemToPhoto({ assetId: '99' })?.credit).toBe('Macaulay Library');
  });

  it('returns null without an asset id', () => {
    expect(macaulayItemToPhoto({})).toBeNull();
    expect(macaulayItemToPhoto(null)).toBeNull();
    expect(macaulayItemToPhoto(undefined)).toBeNull();
  });
});

describe('classifyMacaulayBody', () => {
  it('recognises the Anubis challenge page', () => {
    const html = '<!doctype html><html><head><title>Making sure you&#39;re not a bot!</title></head></html>';
    expect(classifyMacaulayBody(html)).toEqual({ kind: 'challenge' });
  });

  it('parses the current v2 shape: a bare array of items', () => {
    const r = classifyMacaulayBody([{ assetId: 157574821, userDisplayName: 'Henry Trombley', rating: 4.9 }, { assetId: 2 }]);
    expect(r.kind).toBe('photos');
    if (r.kind === 'photos') {
      expect(r.photos).toHaveLength(2);
      expect(r.photos[0]).toEqual({
        url: `${MACAULAY_CDN}/157574821/1800`,
        credit: '© Henry Trombley · Macaulay Library',
        source: 'macaulay',
      });
    }
  });

  it('treats an empty v2 array as a real answer with no photos', () => {
    expect(classifyMacaulayBody([])).toEqual({ kind: 'photos', photos: [] });
  });

  it('parses photos from the legacy v1 wrapped shape', () => {
    const body = { results: { content: [{ assetId: 1, userDisplayName: 'A' }, { assetId: 2 }] } };
    const r = classifyMacaulayBody(body);
    expect(r.kind).toBe('photos');
    if (r.kind === 'photos') expect(r.photos.map(p => p.url)).toEqual([`${MACAULAY_CDN}/1/1800`, `${MACAULAY_CDN}/2/1800`]);
  });

  it('parses photos from a JSON string body', () => {
    const r = classifyMacaulayBody(JSON.stringify({ results: { content: [{ assetId: 7 }] } }));
    expect(r.kind).toBe('photos');
  });

  it('treats an empty result list as a real answer with no photos', () => {
    expect(classifyMacaulayBody({ results: { content: [] } })).toEqual({ kind: 'photos', photos: [] });
  });

  it('skips items without an asset id', () => {
    const r = classifyMacaulayBody({ results: { content: [{ nope: 1 }, { assetId: 5 }] } });
    expect(r.kind === 'photos' && r.photos).toHaveLength(1);
  });

  it('reports unexpected shapes instead of treating them as empty', () => {
    expect(classifyMacaulayBody({ results: {} }).kind).toBe('unexpected');
    expect(classifyMacaulayBody({}).kind).toBe('unexpected');
    expect(classifyMacaulayBody(null).kind).toBe('unexpected');
    expect(classifyMacaulayBody('<html>server error</html>').kind).toBe('unexpected');
  });
});

describe('parseSeedArgs', () => {
  it('requires a region or species codes', () => {
    expect(parseSeedArgs([])).toMatchObject({ ok: false });
  });

  it('parses a region with defaults', () => {
    const r = parseSeedArgs(['--region', 'CA-ON-OT']);
    expect(r.ok && r.args).toMatchObject({
      regions: ['CA-ON-OT'], codes: [], back: 30, limit: null, refresh: false, dryRun: false,
      count: SEED_DEFAULTS.count, delayMs: SEED_DEFAULTS.delayMs, chromePath: null,
    });
  });

  it('accepts comma lists and repeated flags', () => {
    const r = parseSeedArgs(['--region', 'CA-ON-OT,CA-QC', '--region', 'US-NY', '--codes', 'yebsap, amerob']);
    expect(r.ok && r.args.regions).toEqual(['CA-ON-OT', 'CA-QC', 'US-NY']);
    expect(r.ok && r.args.codes).toEqual(['yebsap', 'amerob']);
  });

  it('parses the numeric and boolean options', () => {
    const r = parseSeedArgs(['--codes', 'x', '--limit', '25', '--count', '2', '--back', '7', '--delay-ms', '4000', '--refresh', '--dry-run']);
    expect(r.ok && r.args).toMatchObject({ limit: 25, count: 2, back: 7, delayMs: 4000, refresh: true, dryRun: true });
  });

  it('rejects an invalid --back', () => {
    expect(parseSeedArgs(['--region', 'x', '--back', '14'])).toMatchObject({ ok: false });
  });

  it('rejects a bad --limit and a --delay-ms under one second', () => {
    expect(parseSeedArgs(['--region', 'x', '--limit', '0'])).toMatchObject({ ok: false });
    expect(parseSeedArgs(['--region', 'x', '--delay-ms', '200'])).toMatchObject({ ok: false });
  });

  it('rejects unknown options and missing values', () => {
    expect(parseSeedArgs(['--region', 'x', '--wat'])).toMatchObject({ ok: false });
    expect(parseSeedArgs(['--region'])).toMatchObject({ ok: false });
  });

  it('strips trailing slashes from the backend url', () => {
    const r = parseSeedArgs(['--region', 'x', '--backend-url', 'http://localhost:4000//']);
    expect(r.ok && r.args.backendUrl).toBe('http://localhost:4000');
  });
});

describe('selectSeedTargets', () => {
  const c = (speciesCode: string) => ({ speciesCode });

  it('skips species that already have stored photos', () => {
    const out = selectSeedTargets([c('a'), c('b'), c('c')], new Set(['b']), { refresh: false, limit: null });
    expect(out.map(x => x.speciesCode)).toEqual(['a', 'c']);
  });

  it('includes already-seeded species when refreshing', () => {
    const out = selectSeedTargets([c('a'), c('b')], new Set(['b']), { refresh: true, limit: null });
    expect(out.map(x => x.speciesCode)).toEqual(['a', 'b']);
  });

  it('de-duplicates and keeps first-seen order', () => {
    const out = selectSeedTargets([c('b'), c('a'), c('b')], new Set(), { refresh: false, limit: null });
    expect(out.map(x => x.speciesCode)).toEqual(['b', 'a']);
  });

  it('applies the limit after skipping, so a resumed run still makes progress', () => {
    const out = selectSeedTargets([c('a'), c('b'), c('c'), c('d')], new Set(['a', 'b']), { refresh: false, limit: 1 });
    expect(out.map(x => x.speciesCode)).toEqual(['c']);
  });
});

describe('jitteredDelayMs', () => {
  it('stays within ±25% of the base', () => {
    expect(jitteredDelayMs(3000, () => 0)).toBe(2250);
    expect(jitteredDelayMs(3000, () => 1)).toBe(3750);
    expect(jitteredDelayMs(3000, () => 0.5)).toBe(3000);
  });
});
