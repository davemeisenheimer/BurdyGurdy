import { useState } from 'react';
import type { BirdProgress, QuestionType } from '../../types';
import { masteryThreshold, MASTERY_LABELS, masteryBadgeClass } from '../../lib/mastery';
import { MasteryBadge } from './MasteryBadge';
import { ProgressTypePill, TYPE_LABELS } from './ProgressTypePill';

export interface SightingInfo {
  locName:          string;
  obsDt:            string;
  howMany:          number | null;
  userDisplayName?: string | null;
}

function masteryColor(accuracy: number): string {
  if (accuracy >= 0.85) return 'bg-green-500';
  if (accuracy >= 0.6)  return 'bg-amber-400';
  return 'bg-red-400';
}

/** Returns the question type that needs the most work. Mirrors the life list logic. */
function findPoorestType(records: BirdProgress[]): QuestionType {
  const nonMastered = records.filter(r => !(r.isMastered ?? false));
  const pool = nonMastered.length > 0 ? nonMastered : records;
  if (pool.length === 0) return 'song';
  return pool.reduce((worst, r) => {
    const wLvl = worst.masteryLevel ?? 0;
    const rLvl = r.masteryLevel ?? 0;
    if (rLvl < wLvl) return r;
    if (rLvl > wLvl) return worst;
    const wTotal = worst.correct + worst.incorrect;
    const rTotal = r.correct + r.incorrect;
    const wAcc = wTotal > 0 ? worst.correct / wTotal : 1;
    const rAcc = rTotal > 0 ? r.correct / rTotal : 1;
    return rAcc <= wAcc ? r : worst;
  }).questionType;
}

function formatSightingTime(obsDt: string): string {
  const d = new Date(obsDt.replace(' ', 'T'));
  if (isNaN(d.getTime())) return obsDt;
  const now     = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time    = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`;
}

interface Props {
  comName:     string;
  records:     BirdProgress[];
  sighting?:   SightingInfo;
  isSelected?: boolean;
  onClick?:    () => void;
}

export function BirdMasteryCard({ comName, records, sighting, isSelected = false, onClick }: Props) {
  const [selectedType, setSelectedType] = useState<QuestionType>(
    () => records.length > 0 ? findPoorestType(records) : 'song',
  );

  const baseCard = isSelected
    ? 'bg-sky-50 border-sky-400 shadow-sm'
    : 'bg-white border-slate-200';

  const selectedRecord  = records.find(r => r.questionType === selectedType) ?? records[0];
  const total           = selectedRecord ? selectedRecord.correct + selectedRecord.incorrect : 0;
  const displayAccuracy = total > 0 ? selectedRecord.correct / total : 0;

  const nonMasteredRecords = records.filter(r => !(r.isMastered ?? false));
  const masteredRecords    = records.filter(r =>  (r.isMastered ?? false));

  return (
    <div
      className={`${baseCard} rounded-xl border p-4 transition-shadow ${onClick ? 'cursor-pointer hover:border-sky-300 hover:shadow-sm' : ''}`}
      onClick={onClick}
    >
      {records.length === 0 ? (
        <>
          <p className="font-semibold text-slate-800">{comName}</p>
          <span className="text-[10px] text-slate-400">Not studied</span>
        </>
      ) : (
        <>
          {/* Top row: name + mastery badge | accuracy */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-800">{comName}</span>
              {selectedRecord && (() => {
                if (selectedRecord.isMastered ?? false) {
                  return (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                      Mastered
                    </span>
                  );
                }
                const lvl       = selectedRecord.masteryLevel ?? 0;
                const threshold = masteryThreshold(lvl);
                const streak    = selectedRecord.consecutiveCorrect ?? 0;
                return (
                  <MasteryBadge
                    className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${masteryBadgeClass(lvl)}`}
                  >
                    {streak}/{threshold} {MASTERY_LABELS[lvl] ?? 'Hard'} distractors
                  </MasteryBadge>
                );
              })()}
            </div>
            <div className="text-right shrink-0 ml-2">
              <span className="text-sm font-semibold text-slate-700">{Math.round(displayAccuracy * 100)}%</span>
              <span className="text-xs text-slate-400 ml-1">{TYPE_LABELS[selectedType] ?? selectedType}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
            <div
              className={`h-1.5 rounded-full transition-all ${masteryColor(displayAccuracy)}`}
              style={{ width: `${Math.round(displayAccuracy * 100)}%` }}
            />
          </div>

          {/* Selectable pills */}
          <div className="flex flex-wrap gap-2">
            {nonMasteredRecords.map(r => (
              <ProgressTypePill
                key={r.questionType}
                record={r}
                selected={r.questionType === selectedType}
                onClick={() => setSelectedType(r.questionType)}
              />
            ))}
            {masteredRecords.map(r => (
              <ProgressTypePill
                key={r.questionType}
                record={r}
                selected={r.questionType === selectedType}
                onClick={() => setSelectedType(r.questionType)}
              />
            ))}
          </div>
        </>
      )}

      {/* Sighting row — locName left, time + count right */}
      {sighting && (
        <div className="flex items-start justify-between mt-2 pt-2 border-t border-slate-100">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 truncate">{sighting.locName}</p>
            {sighting.userDisplayName && (
              <p className="text-[10px] text-slate-400 truncate">Reported by {sighting.userDisplayName}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {sighting.howMany != null && (
              <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">
                ×{sighting.howMany}
              </span>
            )}
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatSightingTime(sighting.obsDt)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
