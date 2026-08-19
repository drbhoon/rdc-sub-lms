type AssessmentQuestionLike = { id: string; order: number };

function deterministicScore(seed: string, value: string) {
  let hash = 2166136261;
  for (const char of `${seed}:${value}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Selects a stable random subset for an attempt. The attempt id is the seed,
 * so a refresh cannot change the questions, while a retake receives a new set.
 */
export function selectAttemptQuestions<T extends AssessmentQuestionLike>(
  questions: T[],
  attemptId: string,
  offeredCount: number,
  shuffleQuestions: boolean,
): T[] {
  const count = Math.max(0, Math.min(offeredCount, questions.length));
  const selected = questions.length > count
    ? [...questions]
      .sort((a, b) => deterministicScore(`${attemptId}:select`, a.id) - deterministicScore(`${attemptId}:select`, b.id))
      .slice(0, count)
    : [...questions];

  return selected.sort(shuffleQuestions
    ? (a, b) => deterministicScore(`${attemptId}:order`, a.id) - deterministicScore(`${attemptId}:order`, b.id)
    : (a, b) => a.order - b.order);
}

