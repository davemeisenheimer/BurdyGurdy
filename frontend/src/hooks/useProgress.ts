import { useState, useEffect } from 'react';
import { db } from '../lib/db';
import type { BirdProgress, QuestionType } from '../types';

/** Hook to read progress records for a set of species codes and a question type. */
export function useProgress(speciesCodes: string[], questionType: QuestionType) {
  const [progress, setProgress] = useState<Map<string, BirdProgress>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (speciesCodes.length === 0) return;
    setLoading(true);
    db.progress
      .where('[speciesCode+questionType]')
      .anyOf(speciesCodes.map(code => [code, questionType]))
      .toArray()
      .then(records => {
        const map = new Map<string, BirdProgress>();
        for (const r of records) {
          map.set(r.speciesCode, r);
        }
        setProgress(map);
      })
      .finally(() => setLoading(false));
  }, [speciesCodes.join(','), questionType]);

  return { progress, loading };
}
