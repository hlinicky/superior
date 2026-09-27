import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTask } from '@shared/types'
import { formatDuration, planBacklogUpdate, reportTaskTransition } from './backlog-report.service'

// The module under test reaches presets.service -> jsonStore -> electron, so
// the import chain alone fails under vitest without this. `vi.mock` is hoisted
// above the imports, and userData is only read lazily inside listPresets(), so
// pointing it at a scratch directory here is early enough. The preset lookup
// finds nothing there and falls back to the id, which is all these tests need.
const electron = vi.hoisted(() => ({ getPath: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: electron.getPath } }))
electron.getPath.mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), 'superior-report-ud-')))

// The failure-mode tests below only need editBacklogTask to reject; spawning a
// real child just to get a rejection ties a temp directory's lifetime to a
// process exit, and on Windows a child's cwd stays locked briefly after it.
// isBacklogRepo stays real — the folder-gone test depends on it.
const backlog = vi.hoisted(() => ({ editBacklogTask: vi.fn() }))
vi.mock('./backlog.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backlog.service')>()),
  editBacklogTask: backlog.editBacklogTask
}))

const NOW = new Date('2026-09-27T14:03:22.000Z')

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

describe('formatDuration', () => {
  it('renders seconds alone under a minute', () => {
    expect(formatDuration(48_000)).toBe('48s')
  })

  it('pads the seconds of a minutes-long run', () => {
    expect(formatDuration(62_000)).toBe('1m02s')
  })

  it('renders hours for a long run', () => {
    expect(formatDuration(7_500_000)).toBe('2h05m')
  })

  it('renders a sub-second run as 0s rather than empty', () => {
    expect(formatDuration(120)).toBe('0s')
  })
})

describe('planBacklogUpdate', () => {
  it('marks a starting task In Progress with no note', () => {
    const plan = planBacklogUpdate(task({ status: 'running', startedAt: NOW.getTime() }), 'queued', 'claude', NOW)
    expect(plan).toEqual({ status: 'In Progress' })
  })

  it('marks a clean finish Done and notes it', () => {
    const plan = planBacklogUpdate(
      task({ status: 'done', exitCode: 0, startedAt: NOW.getTime() - 12_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW
    )
    expect(plan).toEqual({
      status: 'Done',
      appendNotes: 'superior: done · exit 0 · claude · 12s · 2026-09-27 14:03 UTC'
    })
  })

  it('sends a failed run back to To Do so the phone still shows work to do', () => {
    const plan = planBacklogUpdate(
      task({ status: 'failed', exitCode: 1, startedAt: NOW.getTime() - 252_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW
    )
    expect(plan).toEqual({
      status: 'To Do',
      appendNotes: 'superior: failed · exit 1 · claude · 4m12s · 2026-09-27 14:03 UTC'
    })
  })

  it('names the branch of a worktree run so the work is findable', () => {
    const plan = planBacklogUpdate(
      task({
        status: 'done',
        exitCode: 0,
        useWorktree: true,
        branch: 'task/fix-cart-a3f1',
        startedAt: NOW.getTime() - 12_000,
        finishedAt: NOW.getTime()
      }),
      'running',
      'claude',
      NOW
    )
    expect(plan?.appendNotes).toBe(
      'superior: done · exit 0 · claude · branch task/fix-cart-a3f1 · 12s · 2026-09-27 14:03 UTC'
    )
  })

  it('omits the exit segment for a canceled run, which never produced a code', () => {
    const plan = planBacklogUpdate(
      task({ status: 'canceled', startedAt: NOW.getTime() - 62_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW
    )
    expect(plan).toEqual({
      status: 'To Do',
      appendNotes: 'superior: canceled · claude · 1m02s · 2026-09-27 14:03 UTC'
    })
  })

  it('never writes "exit null" when crash recovery closes a task with no code', () => {
    const plan = planBacklogUpdate(
      task({ status: 'failed', exitCode: null, startedAt: NOW.getTime() - 5_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW
    )
    expect(plan?.status).toBe('To Do')
    expect(plan?.appendNotes).toBe('superior: failed · claude · 5s · 2026-09-27 14:03 UTC')
    expect(plan?.appendNotes).not.toContain('null')
  })

  it('does nothing for a task with no Backlog link', () => {
    expect(planBacklogUpdate(task({ status: 'running', backlogTaskId: undefined }), 'queued', 'claude', NOW)).toBeNull()
  })

  it('does nothing when the status did not actually change', () => {
    expect(planBacklogUpdate(task({ status: 'running' }), 'running', 'claude', NOW)).toBeNull()
  })

  it('does nothing for a freshly queued task, which has not happened yet', () => {
    expect(planBacklogUpdate(task({ status: 'queued' }), undefined, 'claude', NOW)).toBeNull()
  })
})

describe('a failed report never fails the task', () => {
  beforeEach(() => {
    backlog.editBacklogTask.mockReset()
  })

  it('survives a CLI that rejects an unknown task id', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-report-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    backlog.editBacklogTask.mockRejectedValueOnce(new Error('Command failed: task edit task-999'))
    try {
      expect(() =>
        reportTaskTransition(task({ status: 'done', exitCode: 0, folderPath: dir }), 'running')
      ).not.toThrow()
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(1))
      expect(backlog.editBacklogTask).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: dir, taskId: 'task-42', status: 'Done' })
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('survives a folder that no longer exists', () => {
    expect(() =>
      reportTaskTransition(
        task({ status: 'done', exitCode: 0, folderPath: 'C:/gone-since-the-task-was-queued' }),
        'running'
      )
    ).not.toThrow()
    expect(backlog.editBacklogTask).not.toHaveBeenCalled()
  })
})

describe('a missing CLI is a standing condition, not news', () => {
  it('warns once per run however many tasks report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    backlog.editBacklogTask.mockReset()
    backlog.editBacklogTask.mockRejectedValue(
      new Error('Could not find the backlog CLI. Install it with `npm i -g backlog.md`, or set SUPERIOR_BACKLOG_CLI to the path of its cli.js.')
    )
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-nocli-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    try {
      reportTaskTransition(task({ status: 'done', exitCode: 0, folderPath: dir }), 'running')
      reportTaskTransition(task({ id: 'b2c3', status: 'done', exitCode: 0, folderPath: dir }), 'running')
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(2))
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let that latch suppress unrelated failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    backlog.editBacklogTask.mockReset()
    backlog.editBacklogTask.mockRejectedValue(new Error('Command failed: task edit task-42'))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-other-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    try {
      reportTaskTransition(task({ status: 'done', exitCode: 0, folderPath: dir }), 'running')
      reportTaskTransition(task({ id: 'c3d4', status: 'done', exitCode: 0, folderPath: dir }), 'running')
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
    } finally {
      warn.mockRestore()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
