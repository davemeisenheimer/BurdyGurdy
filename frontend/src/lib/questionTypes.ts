import type { QuestionType } from '../types';
import type { AppSettings } from './settings';

/**
 * Expands a base list of question types by appending any variant types that
 * the user has enabled in settings (latin-answer and song-answer variants).
 *
 * The base types always appear first in their original order; variants are
 * appended in a consistent order afterward.
 */
export function expandQuestionTypes(types: QuestionType[], s: AppSettings): QuestionType[] {
  const result = [...types];
  if (s.includeLatinAnswerVariants) {
    if (types.includes('image'))  result.push('image-latin');
    if (types.includes('song'))   result.push('song-latin');
    if (types.includes('family')) result.push('family-latin');
  }
  if (s.includeSongAnswerVariants) {
    if (types.includes('image')) result.push('image-song');
    if (types.includes('sono'))  result.push('sono-song');
    if (types.includes('latin')) result.push('latin-song');
  }
  return result;
}
