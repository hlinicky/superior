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
import { editBacklogTask, isBacklogRepo } from './backlog.service'

/** The Backlog status each terminal state maps to. */
const STATUS: Partial<Record<AgentTaskStatus, string>> = {
  running: 'In Progress',
  done: 'Done',
  // A run that died still needs doing, and the phone's job is to show what
  // needs doing. Leaving it In Progress would make a dead run look like a live
  // one.
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
 * asserted exactly.
 */
export function planBacklogUpdate(
  task: AgentTask,
  previousStatus: AgentTaskStatus | undefined,
  presetName: string,
  now: Date
): { status: string; appendNotes?: string } | null {
  if (!task.backlogTaskId) return null
  // Two consecutive saves with the same status is normal — startTask persists
  // `running` once before the spawn and once after the session id lands.
  if (previousStatus === task.status) return null

  const status = STATUS[task.status]
  if (!status) return null
  if (task.status === 'running') return { status }

  const segments = ['superior: ' + task.status]
  // A canceled run never produced a code, and a lost session has none to
  // report. Either way the segment is omitted rather than printed as null.
  if (typeof task.exitCode === 'number') segments.push(`exit ${task.exitCode}`)
  segments.push(presetName)
  if (task.branch) segments.push(`branch ${task.branch}`)
  segments.push(formatDuration((task.finishedAt ?? now.getTime()) - (task.startedAt ?? now.getTime())))
  segments.push(`${stamp(now)} UTC`)

  return { status, appendNotes: segments.join(' · ') }
}

let warnedNoCli = false

/**
 * Report a transition, fire-and-forget. Never throws and never returns a
 * promise the queue could be made to await.
 *
 * The write always targets `task.folderPath`, never the worktree a task ran in:
 * the Minas runner watches the main checkout, so an update written beside the
 * work would not reach the phone until the branch merged.
 */
export function reportTaskTransition(task: AgentTask, previousStatus?: AgentTaskStatus): void {
  try {
    if (!task.backlogTaskId) return
    if (!isBacklogRepo(task.folderPath)) return

    const preset = listPresets().presets.find((p) => p.id === task.presetId)
    const plan = planBacklogUpdate(task, previousStatus, preset?.name ?? task.presetId, new Date())
    if (!plan) return

    void editBacklogTask({
      repoPath: task.folderPath,
      taskId: task.backlogTaskId,
      status: plan.status,
      appendNotes: plan.appendNotes
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      // A missing CLI is a standing condition, not news — say it once a run.
      if (/backlog CLI/i.test(message)) {
        if (warnedNoCli) return
        warnedNoCli = true
      }
      console.warn(`[backlog] could not report ${task.backlogTaskId}:`, message)
    })
  } catch (err) {
    console.warn('[backlog] report failed:', err)
  }
}
