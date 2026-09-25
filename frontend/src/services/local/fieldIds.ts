import { db } from '../../lib/db';
import { calcWeight } from '../../lib/adaptive';
import { masteryThreshold, birderLevelToInitialMastery } from '../../lib/mastery';
import { loadSettings } from '../../lib/settings';
import { addToPaletteForType } from './progress';
import type { BirdProgress, FieldId } from '../../types';

// ── Field identification (seen/heard in the wild) ──────────────────────────────
// A user-reported "I identified this bird in the wild" tick (image: seen it, song: heard it).
// Ticks live in their own table, apart from quiz progress. Making one can optionally also
// add the bird to the learning palette, or master it; un-ticking undoes a mastery the tick
// caused, but leaves any other quiz progress alone.

export type FieldIdType = FieldId['questionType'];

/** What else to do when making a tick. */
export type FieldIdAction = 'record' | 'palette' | 'master';

/** Lookup of ticks by fieldIdKey(). */
export type FieldIdMap = ReadonlyMap<string, FieldId>;

export function fieldIdKey(speciesCode: string, questionType: FieldIdType): string {
  return `${speciesCode}|${questionType}`;
}

export function buildFieldIdMap(fieldIds: FieldId[]): FieldIdMap {
  return new Map(fieldIds.map(f => [fieldIdKey(f.speciesCode, f.questionType), f]));
}

// ── Sighting details ──────────────────────────────────────────────────────────

/** The user-editable details of a sighting. */
export interface FieldIdDetails {
  sightedOn:     string;   // YYYY-MM-DD
  locationName?: string;
  locationLat?:  number;
  locationLng?:  number;
  notes?:        string;
}

/** `now` as a local-time YYYY-MM-DD date (what an <input type="date"> uses). */
export function localIsoDate(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** A sighting date must be a real YYYY-MM-DD date, and not in the future. */
export function isValidSightedOn(sightedOn: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sightedOn)) return false;
  if (Number.isNaN(new Date(`${sightedOn}T00:00:00`).getTime())) return false;
  return sightedOn <= today;
}

/** Trims text fields, turning blank ones into undefined; coordinates are kept only as a pair. */
export function normalizeFieldIdDetails(details: FieldIdDetails): FieldIdDetails {
  const locationName = details.locationName?.trim() || undefined;
  const notes        = details.notes?.trim()        || undefined;
  const hasCoords    = details.locationLat !== undefined && details.locationLng !== undefined;
  return {
    sightedOn:   details.sightedOn,
    locationName,
    locationLat: hasCoords ? details.locationLat : undefined,
    locationLng: hasCoords ? details.locationLng : undefined,
    notes,
  };
}

/** "A", "A and B", "A, B and C". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Context for the "Add bird to learning palette" explanation: where this bird already stands for
 * its other question types, since the option shows up on birds that are already being learned -
 * just not for this type. `otherRecords` are the species' records for types other than
 * `questionType`; `label` names a type as the progress cards do (e.g. "Photo").
 */
export function paletteContextText(
  questionType: FieldIdType,
  otherRecords: BirdProgress[],
  label: (type: BirdProgress['questionType']) => string,
): string | null {
  const learning = otherRecords.filter(r => !(r.isMastered ?? false)).map(r => label(r.questionType));
  const mastered = otherRecords.filter(r =>  (r.isMastered ?? false)).map(r => label(r.questionType));

  const parts: string[] = [];
  if (learning.length > 0) parts.push(`in your learning palette for ${joinList(learning)} questions`);
  if (mastered.length > 0) parts.push(`mastered for ${joinList(mastered)} questions`);
  if (parts.length === 0) return null; // brand-new bird - the general explanation says it all
  return `This bird is currently ${parts.join(' and ')}, but not in your learning palette for ${label(questionType)} questions.`;
}

/**
 * The location text after picking a spot on the map. The picked place's name replaces the text
 * when it's blank or still the name a previous pick filled in (`lastPickedName`); text the user
 * typed themselves is kept.
 */
export function locationTextAfterPick(
  currentText: string | undefined,
  lastPickedName: string | undefined,
  pickedName: string | undefined,
): string | undefined {
  const text = currentText?.trim() ?? '';
  const userTyped = text !== '' && text !== lastPickedName;
  if (userTyped || pickedName === undefined) return currentText;
  return pickedName;
}

/**
 * Tooltip for a field-ID button, e.g. "Seen on 2026-05-14 at Mud Lake". A friend's ticks never
 * carry the private location, so theirs read "Seen on 2026-05-14".
 */
export function fieldIdTooltip(questionType: FieldIdType, fieldId: FieldId | undefined): string {
  const verb = questionType === 'image' ? 'Seen' : 'Heard';
  if (!fieldId) return `Not marked as ${verb.toLowerCase()} in the field`;
  const when  = fieldId.sightedOn ? ` on ${fieldId.sightedOn}` : ' in the field';
  const where = fieldId.locationName ? ` at ${fieldId.locationName}` : '';
  return `${verb}${when}${where}`;
}

/**
 * The actions worth offering for a tick, given the species' current progress record for that type.
 * 'palette' only makes sense for a bird that isn't quizzed or queued yet; 'master' only for one
 * that isn't mastered already.
 */
export function availableFieldIdActions(existing: BirdProgress | null): FieldIdAction[] {
  const actions: FieldIdAction[] = ['record'];
  if (!existing) actions.push('palette');
  if (!(existing?.isMastered ?? false)) actions.push('master');
  return actions;
}

export interface FieldIdConfirmPlan {
  fieldId: FieldId;
  /** Progress record to write, or null to leave progress untouched. */
  progress: BirdProgress | null;
  /** Seed a learning-palette record for this species+type (only ever true when none exists). */
  addToPalette: boolean;
}

/**
 * Pure planner for making a tick. Exported for unit tests; call confirmFieldId() from
 * production code. `sibling` is any other-type record for the same species, used to inherit
 * favourited/excluded onto a newly created record (matching palette seeding).
 */
export function planFieldIdConfirm(
  speciesCode: string,
  questionType: FieldIdType,
  comName: string,
  action: FieldIdAction,
  details: FieldIdDetails,
  existing: BirdProgress | null,
  sibling: BirdProgress | null,
  now: number,
): FieldIdConfirmPlan {
  const masters = action === 'master' && !(existing?.isMastered ?? false);
  const fieldId: FieldId = {
    speciesCode, questionType, comName, masteredByField: masters, confirmedAt: now,
    ...normalizeFieldIdDetails(details),
  };

  if (masters) {
    const progress: BirdProgress = existing
      ? {
          ...existing,
          // A palette-seeded record (lastAsked 0) is a never-played placeholder - stamp it so it
          // shows on the Life List and syncs like any other mastered record.
          lastAsked:  existing.lastAsked > 0 ? existing.lastAsked : now,
          isMastered: true,
          masteredAt: now,
          weight:     calcWeight(true, existing.favourited, existing.recentAnswers, existing.correct, existing.incorrect),
        }
      : {
          speciesCode, questionType, comName,
          correct: 0, incorrect: 0, lastAsked: now,
          weight: calcWeight(true, false, undefined, 0, 0),
          favourited: sibling?.favourited ?? false,
          excluded:   sibling?.excluded   ?? false,
          masteryLevel: 0, consecutiveCorrect: 0,
          isMastered: true, masteredAt: now,
        };
    return { fieldId, progress, addToPalette: false };
  }

  return { fieldId, progress: null, addToPalette: action === 'palette' && !existing };
}

/** Whether `record`'s mastered state is earned some way other than a field tick. */
function isMasteredIndependently(record: BirdProgress): boolean {
  if (record.noPhoto || record.noAudio) return true;
  return (record.masteryLevel ?? 0) >= 2 && (record.consecutiveCorrect ?? 0) >= masteryThreshold(2);
}

export type FieldIdUnconfirmPlan =
  | { kind: 'none' }
  | { kind: 'put'; record: BirdProgress }
  | { kind: 'delete' };

/**
 * Pure planner for removing a tick: what to do to the species' progress record. Only a
 * mastery the tick itself caused is undone. A record with no quiz answers at all goes back
 * to untouched (deleted) rather than becoming an active never-answered quiz bird.
 */
export function planFieldIdUnconfirm(fieldId: FieldId, existing: BirdProgress | null): FieldIdUnconfirmPlan {
  if (!fieldId.masteredByField || !existing || !(existing.isMastered ?? false)) return { kind: 'none' };
  if (isMasteredIndependently(existing)) return { kind: 'none' };
  if (existing.correct + existing.incorrect === 0) return { kind: 'delete' };
  return {
    kind: 'put',
    record: {
      ...existing,
      isMastered: false,
      masteredAt: undefined,
      weight: calcWeight(false, existing.favourited, existing.recentAnswers, existing.correct, existing.incorrect),
    },
  };
}

// ── IndexedDB wrappers ────────────────────────────────────────────────────────

/** What a tick change did locally - handed to syncFieldIdChange() to mirror it to the cloud. */
export interface FieldIdChange {
  upserted?: FieldId;
  removed?: { speciesCode: string; questionType: FieldIdType };
  /** A progress record was written that the cloud should get (on the next progress upload). */
  progressChanged: boolean;
  /** A progress record was deleted locally and should be deleted from the cloud too. */
  progressDeleted?: { speciesCode: string; questionType: FieldIdType };
}

export async function loadFieldIds(): Promise<FieldId[]> {
  return db.fieldIds.toArray();
}

/** All of a species' progress records, across every question type. */
export async function getSpeciesProgress(speciesCode: string): Promise<BirdProgress[]> {
  return db.progress.where('speciesCode').equals(speciesCode).toArray();
}

export async function confirmFieldId(
  speciesCode: string,
  questionType: FieldIdType,
  comName: string,
  action: FieldIdAction,
  details: FieldIdDetails,
): Promise<FieldIdChange> {
  const existing = (await db.progress.get([speciesCode, questionType])) ?? null;
  const sibling  = (await db.progress.where('speciesCode').equals(speciesCode).first()) ?? null;
  const plan = planFieldIdConfirm(speciesCode, questionType, comName, action, details, existing, sibling, Date.now());

  await db.fieldIds.put(plan.fieldId);
  if (plan.progress) await db.progress.put(plan.progress);
  if (plan.addToPalette) {
    const { birderLevel } = await loadSettings();
    await addToPaletteForType(speciesCode, comName, questionType, birderLevelToInitialMastery(birderLevel));
  }
  return { upserted: plan.fieldId, progressChanged: plan.progress !== null };
}

/** Replaces an existing tick's sighting details. Returns null if the tick no longer exists. */
export async function updateFieldIdDetails(
  speciesCode: string,
  questionType: FieldIdType,
  details: FieldIdDetails,
): Promise<FieldIdChange | null> {
  const fieldId = await db.fieldIds.get([speciesCode, questionType]);
  if (!fieldId) return null;
  const updated: FieldId = { ...fieldId, ...normalizeFieldIdDetails(details) };
  await db.fieldIds.put(updated);
  return { upserted: updated, progressChanged: false };
}

export async function unconfirmFieldId(speciesCode: string, questionType: FieldIdType): Promise<FieldIdChange> {
  const fieldId = await db.fieldIds.get([speciesCode, questionType]);
  const removed = { speciesCode, questionType };
  if (!fieldId) return { removed, progressChanged: false };

  const existing = (await db.progress.get([speciesCode, questionType])) ?? null;
  const plan = planFieldIdUnconfirm(fieldId, existing);

  await db.fieldIds.delete([speciesCode, questionType]);
  if (plan.kind === 'put') {
    await db.progress.put(plan.record);
    return { removed, progressChanged: true };
  }
  if (plan.kind === 'delete') {
    await db.progress.delete([speciesCode, questionType]);
    return { removed, progressChanged: true, progressDeleted: removed };
  }
  return { removed, progressChanged: false };
}
