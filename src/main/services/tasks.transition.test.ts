import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTask, AgentTaskStatus } from '@shared/types'

const electron = vi.hoisted(() => ({ getPath: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: electron.getPath } }))

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'a1b2',
    folderPath: 'C:/repo',
    prompt: 'fix task-42',
    presetId: 'preset-claude',
    useWorktree: false,
    backlogTaskId: 'task-42',
    status: 'queued',
    createdAt: 0,
    ...over
  }
}

describe('saveTask emits status transitions', () => {
  let userData: string
  beforeEach(() => {
    vi.resetModules()
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-transition-'))
    electron.getPath.mockReturnValue(userData)
  })
  afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }) })

  it('stays silent for a freshly queued task, which has not happened yet', async () => {
    const tasks = await import('./tasks.service')
    const seen: Array<[AgentTaskStatus, AgentTaskStatus | undefined]> = []
    tasks.setTaskTransitionListener((t, prev) => seen.push([t.status, prev]))
    tasks.saveTask(task())
    expect(seen).toEqual([])
  })

  it('reports the move from queued to running with the previous status', async () => {
    const tasks = await import('./tasks.service')
    tasks.saveTask(task())
    const seen: Array<[AgentTaskStatus, AgentTaskStatus | undefined]> = []
    tasks.setTaskTransitionListener((t, prev) => seen.push([t.status, prev]))
    tasks.saveTask(task({ status: 'running' }))
    expect(seen).toEqual([['running', 'queued']])
  })

  it('fires once when startTask saves running twice in a row', async () => {
    const tasks = await import('./tasks.service')
    tasks.saveTask(task())
    const seen: AgentTaskStatus[] = []
    tasks.setTaskTransitionListener((t) => seen.push(t.status))
    tasks.saveTask(task({ status: 'running' }))
    tasks.saveTask(task({ status: 'running', sessionId: 'sess-1' }))
    expect(seen).toEqual(['running'])
  })

  it('reports the finish', async () => {
    const tasks = await import('./tasks.service')
    tasks.saveTask(task({ status: 'running' }))
    const seen: AgentTaskStatus[] = []
    tasks.setTaskTransitionListener((t) => seen.push(t.status))
    tasks.saveTask(task({ status: 'done', exitCode: 0 }))
    expect(seen).toEqual(['done'])
  })

  it('still saves when the listener throws', async () => {
    const tasks = await import('./tasks.service')
    tasks.saveTask(task())
    tasks.setTaskTransitionListener(() => { throw new Error('reporter exploded') })
    expect(() => tasks.saveTask(task({ status: 'done', exitCode: 0 }))).not.toThrow()
    expect(tasks.listTasks().tasks[0].status).toBe('done')
  })

  it('persists the Backlog link across a reload', async () => {
    const tasks = await import('./tasks.service')
    tasks.saveTask(task())
    vi.resetModules()
    const reloaded = await import('./tasks.service')
    expect(reloaded.listTasks().tasks[0].backlogTaskId).toBe('task-42')
  })
})
