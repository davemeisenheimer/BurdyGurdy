import { describe, it, expect } from 'vitest';
import {
  validateIdTipRequest,
  photoBelongsToSpecies,
  idTipCacheKey,
  buildIdTipPrompt,
  createRateLimiter,
  ID_TIP_NAME_MAX,
  guessKey,
  validateIdTipReport,
  validateIdTipResolution,
  idTipResolutionText,
  ID_TIP_REPORT_MIN,
  ID_TIP_REPORT_MAX,
  ID_TIP_RESOLUTIONS,
  validateIdTipSave,
  ID_TIP_TEXT_MAX,
  countReportsByTip,
  tipKeyString,
  indexTaxonomy,
  describeError,
} from './idTip';

const valid = {
  speciesCode: 'coohaw',
  comName: " Cooper's Hawk ",
  sciName: 'Astur cooperii',
  guess: 'Sharp-shinned Hawk',
  photoUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/643249785/1800',
};

describe('validateIdTipRequest', () => {
  it('accepts a valid body and trims strings', () => {
    const r = validateIdTipRequest(valid);
    expect(r).toEqual({ ok: true, value: { ...valid, comName: "Cooper's Hawk" } });
  });

  it('rejects missing or blank fields', () => {
    expect(validateIdTipRequest(undefined).ok).toBe(false);
    expect(validateIdTipRequest({ ...valid, guess: '  ' }).ok).toBe(false);
    expect(validateIdTipRequest({ ...valid, photoUrl: undefined }).ok).toBe(false);
  });

  it('rejects over-long names', () => {
    expect(validateIdTipRequest({ ...valid, guess: 'x'.repeat(ID_TIP_NAME_MAX + 1) }).ok).toBe(false);
  });

  it('rejects a malformed species code and non-http photo URLs', () => {
    expect(validateIdTipRequest({ ...valid, speciesCode: '../etc' }).ok).toBe(false);
    expect(validateIdTipRequest({ ...valid, photoUrl: 'file:///etc/passwd' }).ok).toBe(false);
    expect(validateIdTipRequest({ ...valid, photoUrl: 'data:image/png;base64,AAAA' }).ok).toBe(false);
  });

  it('rejects a guess that is the correct species (common or scientific, any case)', () => {
    expect(validateIdTipRequest({ ...valid, guess: "cooper's hawk" }).ok).toBe(false);
    expect(validateIdTipRequest({ ...valid, guess: 'Astur Cooperii' }).ok).toBe(false);
  });
});

describe('photoBelongsToSpecies', () => {
  const set = { primary: { url: 'https://a/1.jpg' }, optional: [{ url: 'https://a/2.jpg' }] };

  it('matches the primary or an optional photo exactly', () => {
    expect(photoBelongsToSpecies('https://a/1.jpg', set)).toBe(true);
    expect(photoBelongsToSpecies('https://a/2.jpg', set)).toBe(true);
  });

  it('rejects any other URL, including when there is no primary', () => {
    expect(photoBelongsToSpecies('https://evil/x.jpg', set)).toBe(false);
    expect(photoBelongsToSpecies('https://a/1.jpg', { primary: null, optional: [] })).toBe(false);
  });
});

describe('idTipCacheKey', () => {
  const base = validateIdTipRequest(valid);
  if (!base.ok) throw new Error('fixture invalid');

  it('ignores guess case but distinguishes photo, species and guess', () => {
    const k = idTipCacheKey(base.value);
    expect(idTipCacheKey({ ...base.value, guess: 'SHARP-SHINNED HAWK' })).toBe(k);
    expect(idTipCacheKey({ ...base.value, guess: 'Northern Goshawk' })).not.toBe(k);
    expect(idTipCacheKey({ ...base.value, photoUrl: 'https://other/1.jpg' })).not.toBe(k);
    expect(idTipCacheKey({ ...base.value, speciesCode: 'shshaw' })).not.toBe(k);
  });
});

describe('buildIdTipPrompt', () => {
  it('names the correct species with its scientific name, and the guess', () => {
    expect(buildIdTipPrompt({ comName: "Cooper's Hawk", sciName: 'Astur cooperii', guess: 'Accipiter striatus' }))
      .toBe("Correct species: Cooper's Hawk (Astur cooperii)\nPlayer's guess: Accipiter striatus");
  });
});

describe('createRateLimiter', () => {
  it('allows up to the limit per key within a window, then blocks', () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('a', 10)).toBe(true);
    expect(allow('a', 20)).toBe(false);
    expect(allow('b', 20)).toBe(true); // separate key
  });

  it('resets once the window has passed', () => {
    const allow = createRateLimiter(1, 1000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('a', 999)).toBe(false);
    expect(allow('a', 1000)).toBe(true);
  });
});

describe('guessKey', () => {
  it('trims and lower-cases', () => {
    expect(guessKey('  Sharp-shinned Hawk ')).toBe('sharp-shinned hawk');
  });
});

describe('validateIdTipReport', () => {
  const report = { ...valid, issueType: 'not_visible', description: '  The tail is not visible in this photo.  ', notifyEmail: true, regionCode: 'CA-ON-OT' };

  it('accepts a valid report and trims the description', () => {
    const r = validateIdTipReport(report);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.issueType).toBe('not_visible');
      expect(r.value.description).toBe('The tail is not visible in this photo.');
      expect(r.value.notifyEmail).toBe(true);
      expect(r.value.regionCode).toBe('CA-ON-OT');
      expect(r.value.comName).toBe("Cooper's Hawk");
    }
  });

  it('requires a description of at least the minimum length, and caps it', () => {
    expect(validateIdTipReport({ ...report, description: undefined }).ok).toBe(false);
    expect(validateIdTipReport({ ...report, description: 'x'.repeat(ID_TIP_REPORT_MIN - 1) }).ok).toBe(false);
    expect(validateIdTipReport({ ...report, description: 'x'.repeat(ID_TIP_REPORT_MIN) }).ok).toBe(true);
    expect(validateIdTipReport({ ...report, description: 'x'.repeat(ID_TIP_REPORT_MAX + 1) }).ok).toBe(false);
  });

  it('rejects an unknown issue type and an invalid tip reference', () => {
    expect(validateIdTipReport({ ...report, issueType: 'wrong_bird' }).ok).toBe(false);
    expect(validateIdTipReport({ ...report, photoUrl: 'ftp://x' }).ok).toBe(false);
  });

  it('defaults notifyEmail to false and a blank region to null', () => {
    const r = validateIdTipReport({ ...report, notifyEmail: 'yes', regionCode: '  ' });
    expect(r.ok && r.value.notifyEmail).toBe(false);
    expect(r.ok && r.value.regionCode).toBe(null);
  });
});

describe('validateIdTipResolution', () => {
  it('accepts each action, with an optional trimmed note', () => {
    for (const action of ID_TIP_RESOLUTIONS) {
      expect(validateIdTipResolution({ action })).toEqual({ ok: true, value: { action, note: null } });
    }
    expect(validateIdTipResolution({ action: 'kept', note: ' Checked the photo. ' }))
      .toEqual({ ok: true, value: { action: 'kept', note: 'Checked the photo.' } });
  });

  it('rejects unknown actions and over-long notes', () => {
    expect(validateIdTipResolution({ action: 'blocked' }).ok).toBe(false);
    expect(validateIdTipResolution({ action: 'regenerated' }).ok).toBe(false); // retired: regenerating no longer resolves a report
    expect(validateIdTipResolution({ action: 'kept', note: 'x'.repeat(501) }).ok).toBe(false);
  });
});

describe('idTipResolutionText', () => {
  it('gives distinct text for each outcome', () => {
    const texts = ID_TIP_RESOLUTIONS.map(idTipResolutionText);
    expect(new Set(texts).size).toBe(ID_TIP_RESOLUTIONS.length);
  });
});

describe('validateIdTipSave', () => {
  it('accepts the tip reference plus trimmed text', () => {
    const r = validateIdTipSave({ ...valid, tip: '  Note the rounded tail.  ' });
    expect(r.ok && r.value.tip).toBe('Note the rounded tail.');
    expect(r.ok && r.value.speciesCode).toBe('coohaw');
  });

  it('rejects blank or over-long text and an invalid tip reference', () => {
    expect(validateIdTipSave({ ...valid, tip: '   ' }).ok).toBe(false);
    expect(validateIdTipSave({ ...valid }).ok).toBe(false);
    expect(validateIdTipSave({ ...valid, tip: 'x'.repeat(ID_TIP_TEXT_MAX + 1) }).ok).toBe(false);
    expect(validateIdTipSave({ ...valid, tip: 'ok text', photoUrl: 'file:///x' }).ok).toBe(false);
  });
});

describe('countReportsByTip', () => {
  it('counts reports per species + guess + photo', () => {
    const counts = countReportsByTip([
      { species_code: 'coohaw', guess_key: 'sharp-shinned hawk', photo_url: 'https://a/1.jpg' },
      { species_code: 'coohaw', guess_key: 'sharp-shinned hawk', photo_url: 'https://a/1.jpg' },
      { species_code: 'coohaw', guess_key: 'northern goshawk', photo_url: 'https://a/1.jpg' },
    ]);
    expect(counts.get(tipKeyString('coohaw', 'sharp-shinned hawk', 'https://a/1.jpg'))).toBe(2);
    expect(counts.get(tipKeyString('coohaw', 'northern goshawk', 'https://a/1.jpg'))).toBe(1);
    expect(counts.get(tipKeyString('coohaw', 'other', 'https://a/1.jpg'))).toBeUndefined();
  });
});

describe('indexTaxonomy', () => {
  it('records family and position in list order', () => {
    const idx = indexTaxonomy([
      { speciesCode: 'shshaw', familyComName: 'Hawks, Eagles, and Kites', familySciName: 'Accipitridae' },
      { speciesCode: 'coohaw', familyComName: 'Hawks, Eagles, and Kites', familySciName: 'Accipitridae' },
      { speciesCode: 'dowwoo', familyComName: 'Woodpeckers', familySciName: 'Picidae' },
    ]);
    expect(idx.get('coohaw')).toEqual({ familyComName: 'Hawks, Eagles, and Kites', familySciName: 'Accipitridae', taxonIndex: 1 });
    expect(idx.get('dowwoo')?.taxonIndex).toBe(2);
    expect(idx.get('nope')).toBeUndefined();
  });
});

describe('describeError', () => {
  it('returns the message of a plain error', () => {
    expect(describeError(new Error('image fetch 403'))).toBe('image fetch 403');
  });

  it('follows the cause chain and adds error codes', () => {
    const socket = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const fetchErr = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) });
    const sdk = new Error('Connection error.', { cause: fetchErr });
    expect(describeError(sdk)).toBe('Connection error. <- caused by: fetch failed <- caused by: socket closed [UND_ERR_SOCKET]');
    // A code already in the message isn't repeated
    expect(describeError(socket)).toBe('read ECONNRESET');
  });

  it('handles non-Error values and stops at maxDepth', () => {
    expect(describeError('boom')).toBe('boom');
    const deep = new Error('a', { cause: new Error('b', { cause: new Error('c') }) });
    expect(describeError(deep, 1)).toBe('a <- caused by: b');
  });
});
