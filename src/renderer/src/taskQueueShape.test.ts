import { describe, expect, it } from 'vitest'
import type { AgentTask } from './types'
import { newQueuedTask, retriedQueuedTask } from './taskQueueShape'

function queued(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'original',
    folderPath: 'C:/repo',
    prompt: 'fix task-42',
    presetId: 'preset-claude',
    useWorktree: false,
    status: 'failed',
    createdAt: 100,
    ...over
  }
}

describe('newQueuedTask', () => {
  const base = {
    id: 'new-id',
    folderPath: 'C:/repo',
    presetId: 'preset-claude',
    useWorktree: false,
    createdAt: 500
  }

  it('links a prompt that names a task', () => {
    expect(newQueuedTask({ ...base, prompt: 'rewrite checkout for task-42' }).backlogTaskId).toBe('task-42')
  })

  it('leaves a prompt that names none unlinked', () => {
    expect(newQueuedTask({ ...base, prompt: 'poke at the build' }).backlogTaskId).toBeUndefined()
  })

  it('trims the prompt before storing and parsing it', () => {
    const task = newQueuedTask({ ...base, prompt: '  task-7 needs copy  ' })
    expect(task.prompt).toBe('task-7 needs copy')
    expect(task.backlogTaskId).toBe('task-7')
  })

  it('starts queued', () => {
    expect(newQueuedTask({ ...base, prompt: 'anything' }).status).toBe('queued')
  })
})

describe('retriedQueuedTask', () => {
  it('carries the link through a retry', () => {
    expect(retriedQueuedTask(queued({ backlogTaskId: 'task-42' }), 'retry-id', 900).backlogTaskId).toBe('task-42')
  })

  it('recovers a link from the prompt when the original predates the field', () => {
    expect(retriedQueuedTask(queued(), 'retry-id', 900).backlogTaskId).toBe('task-42')
  })

  it('leaves an unlinkable task unlinked', () => {
    expect(retriedQueuedTask(queued({ prompt: 'no reference here' }), 'retry-id', 900).backlogTaskId).toBeUndefined()
  })

  it('queues the copy under the new id and timestamp', () => {
    const retry = retriedQueuedTask(queued(), 'retry-id', 900)
    expect(retry).toMatchObject({ id: 'retry-id', createdAt: 900, status: 'queued' })
  })

  it('retains the checkout of a setup failure so the retry can reuse it', () => {
    const retry = retriedQueuedTask(
      queued({ error: 'setup-failed: worktree busy', workspaceId: 'ws-1', branch: 'task/x-1' }),
      'retry-id',
      900
    )
    expect(retry).toMatchObject({ workspaceId: 'ws-1', branch: 'task/x-1' })
  })

  it('does not retain a checkout for an ordinary failure', () => {
    const retry = retriedQueuedTask(queued({ workspaceId: 'ws-1', branch: 'task/x-1' }), 'retry-id', 900)
    expect(retry.workspaceId).toBeUndefined()
    expect(retry.branch).toBeUndefined()
  })
})
