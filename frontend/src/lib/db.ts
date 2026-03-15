import Dexie, { type Table } from 'dexie';
import type { BirdProgress, RegionSpeciesCache } from '../types';

class BirdyGurdyDB extends Dexie {
  progress!: Table<BirdProgress>;
  regionSpecies!: Table<RegionSpeciesCache>;
  blockedPhotos!: Table<{ url: string }>;

  constructor() {
    super('BirdyGurdyDB');
    this.version(1).stores({
      progress: '[speciesCode+questionType], weight, lastAsked',
    });
    this.version(2).stores({
      progress: '[speciesCode+questionType], weight, lastAsked',
    }).upgrade(tx => {
      return tx.table('progress').toCollection().modify(record => {
        if (!record.comName) record.comName = record.speciesCode;
        if (record.favourited === undefined) record.favourited = false;
      });
    });
    // v3: standalone speciesCode index for per-species queries + new adaptive fields
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
    // v5: regional species cache for adaptive promotion queue
    this.version(5).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
    });
    // v6: blocked photos (user-dismissed optional observation photos)
    this.version(6).stores({
      progress: '[speciesCode+questionType], speciesCode, weight, lastAsked',
      regionSpecies: 'regionCode',
      blockedPhotos: 'url',
    });
  }
}

export const db = new BirdyGurdyDB();
