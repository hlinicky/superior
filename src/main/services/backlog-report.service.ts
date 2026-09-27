// Turns one task-queue transition into one Backlog edit.
//
// Split from backlog.service.ts on purpose: deciding *what* to write is a pure
// function of the task, and keeping it pure is what lets the status mapping and
// the note format be tested without a CLI anywhere near them.
//
// Reporting is an accessory to the queue, never a condition of it. Every path
// out of reportTaskTransition swallows its error: a task that ran must still
// save, whatever Backlog thinks.

import type { AgentTask, AgentTaskStatus } from '@shared/types'
import { listPresets } from './presets.service'
import { describeResolvedBacklogCli, editBacklogTask, isBacklogRepo, readBacklogTaskStatus } from './backlog.service'

/** The Backlog status each terminal state maps to. */
const STATUS: Partial<Record<AgentTaskStatus, string>> = {
  running: 'In Progress',
  done: 'Done',
  // A run that died still needs doing, and the phone's job is to show what
  // needs doing. Leaving it In Progress would make a dead run look like a live
  // one. (Narrow exception below: an agent that already finished the work and
  // marked it Done itself is not undone by its own late nonzero exit.)
  failed: 'To Do',
  canceled: 'To Do'
}

/** `48s`, `1m02s`, `2h05m` — compact enough to sit in a one-line note. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/** `2026-09-27 14:03`, the shape hooks/backlog-session.mjs already appends. */
function stamp(now: Date): string {
  return now.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * What to write for this transition, or null when nothing should be written.
 *
 * Pure. Takes `now` rather than reading the clock so the note format can be
 * asserted exactly, and takes the task's current Backlog status (already read
 * by the caller) rather than reading it itself, for the same reason.
 *
 * The returned `status` is omitted — note-only — exactly when this would
 * demote a task to To Do that the agent itself already marked Done before
 * exiting nonzero. Every other transition always carries a status.
 */
export function planBacklogUpdate(
  task: AgentTask,
  previousStatus: AgentTaskStatus | undefined,
  presetName: string,
  now: Date,
  currentBacklogStatus: string | null = null
): { status?: string; appendNotes?: string } | null {
  if (!task.backlogTaskId) return null
  // Two consecutive saves with the same status is normal — startTask persists
  // `running` once before the spawn and once after the session id lands.
  if (previousStatus === task.status) return null

  const mapped = STATUS[task.status]
  if (!mapped) return null
  if (task.status === 'running') return { status: mapped }

  // The agent may have done the work, run `backlog task edit -s Done` itself,
  // then exited nonzero for something unrelated (a trailing lint gate, e.g.).
  // Demoting that back to To Do would tell the phone finished work is undone.
  const demoted = mapped === 'To Do' && currentBacklogStatus === 'Done'

  const segments = ['superior: ' + task.status]
  // A canceled run never produced a code, and a lost session has none to
  // report. Either way the segment is omitted rather than printed as null.
  if (typeof task.exitCode === 'number') segments.push(`exit ${task.exitCode}`)
  segments.push(presetName)
  // Only set on a pre-spawn failure (bad preset, missing workspace, worktree
  // setup) — the one case where the note would otherwise say nothing about
  // what actually went wrong.
  if (task.error) segments.push(task.error)
  if (task.branch) segments.push(`branch ${task.branch}`)
  segments.push(formatDuration((task.finishedAt ?? now.getTime()) - (task.startedAt ?? now.getTime())))
  segments.push(`${stamp(now)} UTC`)

  return { status: demoted ? undefined : mapped, appendNotes: segments.join(' · ') }
}

let warnedNoCli = false

// One write in flight at a time per task, so a finish that lands while a start
// is still on the wire can never overtake it. `backlog task edit` is
// read-modify-write on one markdown file; without this, a task whose agent
// dies immediately can have its `In Progress` write land after its finish
// write, and the task is stuck In Progress with no note.
const chains = new Map<string, Promise<void>>()

function enqueue(key: string, run: () => Promise<void>): void {
  const chained = (chains.get(key) ?? Promise.resolve()).then(run, run)
  chains.set(key, chained)
  // Drop the entry once this is the last link in its chain, so a long-lived
  // app does not accumulate one entry per task forever. A concurrent enqueue
  // may have already replaced it with a newer chain — leave that one alone.
  void chained.finally(() => {
    if (chains.get(key) === chained) chains.delete(key)
  })
}

async function performReport(task: AgentTask, previousStatus: AgentTaskStatus | undefined): Promise<void> {
  try {
    if (!isBacklogRepo(task.folderPath)) return

    const preset = listPresets().presets.find((p) => p.id === task.presetId)
    // A raw preset id in the note beats losing the note entirely when a preset has
    // been deleted since the task ran.
    const mapped = STATUS[task.status]
    // Reading current status costs a CLI round trip, so only pay it for the
    // one transition it can change the outcome of.
    const currentStatus =
      mapped === 'To Do' && task.backlogTaskId
        ? await readBacklogTaskStatus(task.folderPath, task.backlogTaskId)
        : null
    const plan = planBacklogUpdate(task, previousStatus, preset?.name ?? task.presetId, new Date(), currentStatus)
    if (!plan) return

    await editBacklogTask({
      repoPath: task.folderPath,
      taskId: task.backlogTaskId!,
      status: plan.status,
      appendNotes: plan.appendNotes
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A missing CLI is a standing condition, not news — say it once a run.
    if (/backlog CLI/i.test(message)) {
      if (warnedNoCli) return
      warnedNoCli = true
    }
    const cli = describeResolvedBacklogCli()
    console.warn(`[backlog] could not report ${task.backlogTaskId} (${cli ?? 'no CLI resolved'}):`, message)
  }
}

/**
 * Report a transition, fire-and-forget. Never throws and never returns a
 * promise the queue could be made to await.
 *
 * Nothing here does synchronous IO: `saveTask` calls this on the same tick it
 * returns to the renderer, so even the `isBacklogRepo` check, the preset
 * lookup, and CLI resolution are deferred past an async boundary inside
 * `performReport` — otherwise every transition would block the main thread
 * with `existsSync`/`readFileSync` calls before the renderer ever sees its
 * response, and on a machine with no backlog CLI would redo the entire PATH
 * sweep synchronously on every single transition.
 *
 * The write always targets `task.folderPath`, never the worktree a task ran in:
 * the Minas runner watches the main checkout, so an update written beside the
 * work would not reach the phone until the branch merged.
 */
export function reportTaskTransition(task: AgentTask, previousStatus?: AgentTaskStatus): void {
  try {
    if (!task.backlogTaskId) return
    const key = `${task.folderPath}::${task.backlogTaskId}`
    enqueue(key, () =>
      // setImmediate, not a bare microtask: it hops past the current
      // synchronous stack into its own turn of the event loop, which is what
      // actually keeps the filesystem/CLI work off the path that runs before
      // saveTask replies to the renderer.
      new Promise<void>((resolve) => setImmediate(resolve)).then(() => performReport(task, previousStatus))
    )
  } catch (err) {
    console.warn('[backlog] report failed:', err)
  }
}
