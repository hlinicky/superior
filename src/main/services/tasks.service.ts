import type { AgentTask, AgentTaskStatus, TasksState } from '@shared/types'
import { readJsonFile, userDataFile, writeJsonFile } from '../lib/jsonStore'

/**
 * The store stays a dumb record of the queue; it does not learn what Backlog
 * is. It emits, and main wires a reporter to the emission — which is why
 * saveTask can be the single hook for all five paths into a terminal state
 * without this file gaining a dependency on any of them.
 */
type TaskTransitionListener = (task: AgentTask, previousStatus?: AgentTaskStatus) => void

let transitionListener: TaskTransitionListener | null = null

export function setTaskTransitionListener(listener: TaskTransitionListener | null): void {
  transitionListener = listener
}

function storeFile(): string {
  return userDataFile('tasks.json')
}

function save(state: TasksState): void {
  writeJsonFile(storeFile(), state, 'tasks')
}

function read(): TasksState {
  const parsed = readJsonFile<TasksState | null>(storeFile(), null, (p) => {
    const obj = p as Partial<TasksState>
    return obj && Array.isArray(obj.tasks)
      ? { tasks: obj.tasks.filter(isTask), paused: obj.paused === true }
      : null
  })
  return parsed ?? { tasks: [], paused: false }
}

const TASK_STATUSES = new Set(['queued', 'running', 'done', 'failed', 'canceled'])

function isTask(value: unknown): value is AgentTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Record<string, unknown>
  return (
    typeof task.id === 'string' &&
    typeof task.folderPath === 'string' &&
    typeof task.prompt === 'string' &&
    typeof task.presetId === 'string' &&
    typeof task.useWorktree === 'boolean' &&
    typeof task.status === 'string' &&
    TASK_STATUSES.has(task.status) &&
    typeof task.createdAt === 'number' &&
    Number.isFinite(task.createdAt)
  )
}

/**
 * Persisted task queue. The queue *engine* (start next, watch exits) lives in
 * the renderer, which owns tabs and session state; this store is only the
 * durable record. Tasks stored as 'running' can be stale after a crash — the
 * renderer reconciles them against surviving daemon sessions on launch.
 */
export function listTasks(): TasksState {
  return read()
}

/** Upsert a task by id (adds when new, replaces when existing). */
export function saveTask(task: AgentTask): TasksState {
  const state = read()
  const idx = state.tasks.findIndex((t) => t.id === task.id)
  const previousStatus = idx >= 0 ? state.tasks[idx].status : undefined
  if (idx >= 0) state.tasks[idx] = task
  else state.tasks.push(task)
  save(state)

  // A brand new task is normally 'queued', which means nothing has happened to
  // report. Anything else on a first sighting is a real transition.
  const changed = previousStatus !== task.status && !(previousStatus === undefined && task.status === 'queued')
  if (changed && transitionListener) {
    try {
      transitionListener(task, previousStatus)
    } catch (err) {
      // Reporting is an accessory to the queue, never a condition of it.
      console.warn('[tasks] transition listener failed:', err)
    }
  }
  return state
}

export function deleteTask(id: string): TasksState {
  const state = read()
  state.tasks = state.tasks.filter((t) => t.id !== id)
  save(state)
  return state
}

/** Drop every finished (done/failed/canceled) task of one folder. */
export function clearFinishedTasks(folderPath: string): TasksState {
  const state = read()
  state.tasks = state.tasks.filter(
    (t) => t.folderPath !== folderPath || t.status === 'queued' || t.status === 'running'
  )
  save(state)
  return state
}

/** Pause/resume the queue (running tasks finish; queued ones wait). */
export function setTasksPaused(paused: boolean): TasksState {
  const state = read()
  state.paused = paused
  save(state)
  return state
}
