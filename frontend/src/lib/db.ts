import Dexie, { type Table } from 'dexie';
import type { BirdProgress, RegionSpeciesCache } from '../types';

export interface AdminBlockedMediaEntry {
  url:         string;
  speciesCode: string;
  mediaType:   'photo' | 'audio';
  blockScope:  'full' | 'question';
}

class BirdyGurdyDB extends Dexie {
  progress!:          Table<BirdProgress>;
  regionSpecies!:     Table<RegionSpeciesCache>;
  blockedPhotos!:     Table<{ url: string }>;
  adminBlockedMedia!: Table<AdminBlockedMediaEntry>;

  constructor(name: string) {
    super(name);
    // v1: initial schema — progress table with compound key [speciesCode+questionType]
    this.version(1).stores({
      progress: '[speciesCode+questionType], weight, lastAsked',
    });
    // v2: backfill comName (was missing on early records) and favourited flag
    this.version(2).stores({
      progress: '[speciesCode+questionType], weight, lastAsked',
    }).upgrade(tx => {
      return tx.table('progress').toCollection().modify(record => {
        if (!record.comName) record.comName = record.speciesCode;
        if (record.favourited === undefined) record.favourited = false;
      });
    });
    // v3: standalone speciesCode index for per-species queries + new adaptive fields
    //     (excluded, masteryLevel, consecutiveCorrect)
    this.version(3).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
    }).upgrade(tx => {
      return tx.table('progress').toCollection().modify(record => {
        if (record.excluded === undefined) record.excluded = false;
        if (record.masteryLevel === undefined) record.masteryLevel = 0;
        if (record.consecutiveCorrect === undefined) record.consecutiveCorrect = 0;
      });
    });
    // v4: replace isInitialBucket with inHistory (per question-type graduation flag)
    this.version(4).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
    }).upgrade(tx => {
      return tx.table('progress').toCollection().modify(record => {
        if (record.inHistory === undefined) record.inHistory = false;
      });
    });
    // v5: add regionSpecies table — ordered species cache used as the adaptive promotion queue
    this.version(5).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
    });
    // v6: add blockedPhotos table — URLs of optional observation photos dismissed by the user
    this.version(6).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
      blockedPhotos: 'url',
    });
    // v7: add adminBlockedMedia table — media globally blocked by admin via the curation panel;
    //     initially keyed on url only (v8 changes this)
    this.version(7).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
      blockedPhotos: 'url',
      adminBlockedMedia: 'url',
    });
    // v8: rekey adminBlockedMedia on [url+speciesCode] to support per-species blocking;
    //     clears the table because old url-only records are incompatible with the new key
    this.version(8).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
      blockedPhotos: 'url',
      adminBlockedMedia: '[url+speciesCode]',
    }).upgrade(tx => tx.table('adminBlockedMedia').clear());
    // v9: seed recentAnswers rolling window for existing mastered birds — backfills based on
    //     historical accuracy (Fs first, Ts last) so the window reflects past performance
    this.version(9).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
      blockedPhotos: 'url',
      adminBlockedMedia: '[url+speciesCode]',
    }).upgrade(tx => {
      return tx.table('progress').toCollection().modify(record => {
        if (record.inHistory && record.recentAnswers === undefined) {
          const total = (record.correct ?? 0) + (record.incorrect ?? 0);
          const accuracy = total > 0 ? (record.correct ?? 0) / total : 1;
          const correctCount = Math.round(accuracy * 10);
          const incorrectCount = 10 - correctCount;
          record.recentAnswers = [
            ...Array(incorrectCount).fill(false),
            ...Array(correctCount).fill(true),
          ];
        }
      });
    });
    // v10: rename inHistory → isMastered for clarity (inHistory was ambiguous with regional
    //      "historical" sightings); existing records are migrated, old field removed
    this.version(10).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
      blockedPhotos: 'url',
      adminBlockedMedia: '[url+speciesCode]',
    }).upgrade(tx => {
      return tx.table('progress').toCollection().modify(record => {
        record.isMastered = record.inHistory ?? false;
        delete record.inHistory;
      });
    });
  }
}

function openDb(instance: BirdyGurdyDB): BirdyGurdyDB {
  // If a schema migration leaves the database in an unrecoverable state, Dexie will
  // reject the open promise.  Delete and reload — onAuthStateChange fires on the next
  // load for already-signed-in users, which triggers the full cloud sync automatically.
  instance.open().catch(async err => {
    console.error('BirdyGurdyDB: failed to open, resetting database:', err);
    try { await instance.delete(); } catch { /* best-effort */ }
    window.location.reload();
  });
  return instance;
}

// Unauthenticated users get a shared guest database.
// Call switchToUserDb() when a user signs in or out to isolate their progress.
export let db = openDb(new BirdyGurdyDB('BirdyGurdyDB-guest'));

/**
 * Switches the active database to the per-user database for the given userId,
 * or back to the shared guest database when userId is null (signed out).
 * All modules that import `db` will see the new instance immediately.
 */
export function switchToUserDb(userId: string | null): void {
  const name = userId ? `BirdyGurdyDB-${userId}` : 'BirdyGurdyDB-guest';
  if (db.name === name) return;
  db.close();
  db = openDb(new BirdyGurdyDB(name));
}
