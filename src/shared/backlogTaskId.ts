/**
 * A task's link to the Backlog.md task it is about.
 *
 * Superior's queue carries a free-form prompt and nothing that identifies work,
 * so the prompt is where the link has to come from: a prompt mentioning
 * `task-42` is a run about `task-42`.
 *
 * The `task-` prefix is required. Bare numbers appear in prose constantly and
 * treating them as references would link runs to tasks at random. Ids can be
 * nested (`task-5.1`), which the Backlog CLI accepts as-is.
 *
 * Two negative lookaheads ensure the id doesn't run into adjacent characters:
 * `(?!\w)` rejects a word character immediately after the id (e.g., `task-42abc`),
 * and `(?!\.\d)` rejects a dot-digit sequence that would extend a nested id
 * (e.g., `task-5.1abc` backtracking to match `task-5` followed by `.1abc`).
 */
const TASK_REFERENCE = /\btask-(\d+(?:\.\d+)*)(?!\w)(?!\.\d)/i

/**
 * The first Backlog task id mentioned in `prompt`, lowercased so the CLI always
 * receives one spelling, or undefined when the prompt names none.
 */
export function parseBacklogTaskId(prompt: string): string | undefined {
  const match = TASK_REFERENCE.exec(prompt)
  return match ? `task-${match[1]}` : undefined
}
