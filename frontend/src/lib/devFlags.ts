/**
 * Development flags — flip these to enable extra UI detail useful for testing.
 * Should never be committed as `true` in production.
 */

/** When true, the "Not asked yet" section in RecentProgressScreen splits into
 *  "Seeded (never asked)" vs "Unseen (never seeded)" sub-categories. */
export const DEV_SHOW_PALETTE_SPLIT = false;

/** When true, logs audio track failures (broken URLs) to the console. */
export const DEV_LOG_AUDIO_ERRORS = true;
