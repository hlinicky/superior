import { parseBacklogTaskId } from './types'
import type { AgentTask } from './types'

/**
 * The shape of a task entering the queue.
 *
 * Extracted from useTaskQueue for the reason buildTaskCommand was: a hook is
 * awkward to test, and the two rules that matter here are worth pinning
 * directly — a prompt is trimmed before it is parsed, and a retry keeps the
 * Backlog link the original found.
 */
export function newQueuedTask(args: {
  id: string
  folderPath: string
  prompt: string
  presetId: string
  useWorktree: boolean
  createdAt: number
}): AgentTask {
  const prompt = args.prompt.trim()
  return {
    id: args.id,
    folderPath: args.folderPath,
    prompt,
    presetId: args.presetId,
    useWorktree: args.useWorktree,
    backlogTaskId: parseBacklogTaskId(prompt),
    status: 'queued',
    createdAt: args.createdAt
  }
}

/**
 * A queued copy of a failed or canceled task.
 *
 * The prompt is unchanged, so the link it produced still holds — and a task
 * queued before the link existed gets one here, which is why the prompt is
 * consulted rather than trusted to the stored field alone.
 */
export function retriedQueuedTask(task: AgentTask, id: string, createdAt: number): AgentTask {
  return {
    id,
    // A setup failure keeps its checkout so the retry can reuse it.
    ...(task.error?.startsWith('setup-failed:')
      ? { workspaceId: task.workspaceId, branch: task.branch }
      : {}),
    folderPath: task.folderPath,
    prompt: task.prompt,
    presetId: task.presetId,
    useWorktree: task.useWorktree,
    backlogTaskId: task.backlogTaskId ?? parseBacklogTaskId(task.prompt),
    status: 'queued',
    createdAt
  }
}
