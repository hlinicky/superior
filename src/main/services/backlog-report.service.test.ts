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
// readBacklogTaskStatus is mocked for the same reason — left real, it would
// resolve and spawn whatever backlog CLI happens to be on the machine running
// these tests. isBacklogRepo stays real — the folder-gone test depends on it.
const backlog = vi.hoisted(() => ({
  editBacklogTask: vi.fn(),
  readBacklogTaskStatus: vi.fn(),
  describeResolvedBacklogCli: vi.fn(),
  // Wraps the real isBacklogRepo (set below) rather than replacing its
  // behaviour — this exists only so a test can see *when* it was called,
  // which a real ESM export can't be spied on directly for.
  isBacklogRepo: vi.fn()
}))
vi.mock('./backlog.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('./backlog.service')>()
  backlog.isBacklogRepo.mockImplementation(original.isBacklogRepo)
  return {
    ...original,
    editBacklogTask: backlog.editBacklogTask,
    readBacklogTaskStatus: backlog.readBacklogTaskStatus,
    describeResolvedBacklogCli: backlog.describeResolvedBacklogCli,
    isBacklogRepo: backlog.isBacklogRepo
  }
})

// Both mocks default to "nothing special going on" so tests that don't touch
// them (most of them — only a To Do demotion ever calls readBacklogTaskStatus)
// see the same behaviour as before these existed.
beforeEach(() => {
  backlog.readBacklogTaskStatus.mockReset().mockResolvedValue(null)
  backlog.describeResolvedBacklogCli.mockReset().mockReturnValue('node fake-cli.js')
  backlog.isBacklogRepo.mockClear()
})

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

  it('leaves a status the agent already set to Done alone, but still appends the note', () => {
    const plan = planBacklogUpdate(
      task({ status: 'failed', exitCode: 1, startedAt: NOW.getTime() - 5_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW,
      'Done'
    )
    expect(plan?.status).toBeUndefined()
    expect(plan?.appendNotes).toBe('superior: failed · exit 1 · claude · 5s · 2026-09-27 14:03 UTC')
  })

  it('still demotes to To Do when the current status is not Done', () => {
    const plan = planBacklogUpdate(
      task({ status: 'failed', exitCode: 1, startedAt: NOW.getTime() - 5_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW,
      'In Progress'
    )
    expect(plan?.status).toBe('To Do')
  })

  it('does not apply the already-Done exception to a clean finish', () => {
    // Done -> Done is not a demotion in the first place; currentBacklogStatus
    // is irrelevant here and must not suppress the status write.
    const plan = planBacklogUpdate(
      task({ status: 'done', exitCode: 0, startedAt: NOW.getTime() - 5_000, finishedAt: NOW.getTime() }),
      'running',
      'claude',
      NOW,
      'Done'
    )
    expect(plan?.status).toBe('Done')
  })

  it('includes the pre-spawn failure reason after the preset segment', () => {
    const plan = planBacklogUpdate(
      task({ status: 'failed', error: 'preset-missing', startedAt: NOW.getTime(), finishedAt: NOW.getTime() }),
      'queued',
      'preset-claude',
      NOW
    )
    expect(plan?.appendNotes).toBe('superior: failed · preset-claude · preset-missing · 0s · 2026-09-27 14:03 UTC')
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

describe('a demotion checks whether the agent already finished the work', () => {
  beforeEach(() => {
    backlog.editBacklogTask.mockReset().mockResolvedValue(undefined)
  })

  it('reads current status only for a To Do demotion, and writes note-only when it is already Done', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-alreadydone-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    backlog.readBacklogTaskStatus.mockResolvedValueOnce('Done')
    try {
      reportTaskTransition(
        task({ status: 'failed', exitCode: 1, folderPath: dir, backlogTaskId: 'task-already-done' }),
        'running'
      )
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(1))
      expect(backlog.readBacklogTaskStatus).toHaveBeenCalledWith(dir, 'task-already-done')
      expect(backlog.editBacklogTask).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: dir, taskId: 'task-already-done', status: undefined })
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never reads current status for a clean finish, which is never a demotion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-nodemote-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    try {
      reportTaskTransition(
        task({ status: 'done', exitCode: 0, folderPath: dir, backlogTaskId: 'task-clean' }),
        'running'
      )
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(1))
      expect(backlog.readBacklogTaskStatus).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('two edits for one task never race', () => {
  beforeEach(() => {
    backlog.editBacklogTask.mockReset()
  })

  it('serialises a slow start against a fast finish so the finish cannot land first', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-race-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    const order: string[] = []
    let releaseStart: () => void = () => {}
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    backlog.editBacklogTask.mockImplementationOnce(async () => {
      order.push('start-write-began')
      await startGate
      order.push('start-write-done')
    })
    backlog.editBacklogTask.mockImplementationOnce(async () => {
      order.push('finish-write-began')
    })
    try {
      reportTaskTransition(
        task({ status: 'running', startedAt: NOW.getTime(), folderPath: dir, backlogTaskId: 'task-race' }),
        'queued'
      )
      reportTaskTransition(
        task({
          status: 'failed',
          exitCode: 1,
          startedAt: NOW.getTime(),
          finishedAt: NOW.getTime(),
          folderPath: dir,
          backlogTaskId: 'task-race'
        }),
        'running'
      )
      await vi.waitFor(() => expect(order).toContain('start-write-began'))
      // The still in-flight start write must be the only thing that has run —
      // the finish write is queued behind it, not racing it.
      expect(order).toEqual(['start-write-began'])
      releaseStart()
      await vi.waitFor(() => expect(order).toEqual(['start-write-began', 'start-write-done', 'finish-write-began']))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prunes its per-task entry once the chain drains, so a long-lived app does not leak one per task', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-prune-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    backlog.editBacklogTask.mockResolvedValue(undefined)
    try {
      reportTaskTransition(
        task({ status: 'done', exitCode: 0, folderPath: dir, backlogTaskId: 'task-prune' }),
        'running'
      )
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(1))
      // A second, unrelated transition on the same task+folder key runs to
      // completion on its own rather than sitting queued forever behind a
      // chain entry that should have been dropped.
      backlog.editBacklogTask.mockClear()
      reportTaskTransition(
        task({
          status: 'failed',
          exitCode: 1,
          folderPath: dir,
          backlogTaskId: 'task-prune',
          startedAt: NOW.getTime(),
          finishedAt: NOW.getTime() + 1
        }),
        'done'
      )
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(1))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('reporting never blocks the synchronous call into saveTask', () => {
  it('defers isBacklogRepo, the preset lookup, and CLI-touching work past an async boundary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-defer-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    backlog.editBacklogTask.mockReset().mockResolvedValue(undefined)
    try {
      reportTaskTransition(
        task({ status: 'done', exitCode: 0, folderPath: dir, backlogTaskId: 'task-defer' }),
        'running'
      )
      // Still on the same synchronous stack as the call above: the guard that
      // would otherwise do a synchronous existsSync hasn't run yet.
      expect(backlog.isBacklogRepo).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(backlog.editBacklogTask).toHaveBeenCalledTimes(1))
      expect(backlog.isBacklogRepo).toHaveBeenCalledWith(dir)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
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

  it('names the resolved CLI in the warning, not just the error message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    backlog.editBacklogTask.mockReset()
    backlog.editBacklogTask.mockRejectedValueOnce(new Error('Command failed: task edit task-42'))
    backlog.describeResolvedBacklogCli.mockReturnValue('node C:/npm/backlog.md/cli.js')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-namedcli-'))
    fs.mkdirSync(path.join(dir, 'backlog'), { recursive: true })
    try {
      reportTaskTransition(task({ status: 'done', exitCode: 0, folderPath: dir }), 'running')
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
      expect(warn.mock.calls[0][0]).toContain('node C:/npm/backlog.md/cli.js')
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
