// A real run of the Task 7 probe proved this end to end, then was deleted —
// leaving nothing that exercises an actual `backlog task edit` spawn. This
// rebuilds that coverage: a throwaway git + Backlog repository, driven
// entirely through `reportTaskTransition` (never the CLI directly), asserting
// on the markdown Backlog.md actually wrote to disk.
//
// Skips itself when the machine running the suite has no backlog CLI, rather
// than failing — CI without it should stay green.

import { execFileSync, execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentTask, AgentTaskStatus } from '@shared/types'

const hasCli = (() => {
  try {
    execFileSync('backlog', ['--version'], { stdio: 'ignore', shell: true })
    return true
  } catch {
    return false
  }
})()

// presets.service reaches electron.app.getPath; nothing else here touches
// Electron at all. backlog.service is deliberately left real — the whole
// point of this file is a real CLI spawn.
const electron = vi.hoisted(() => ({ getPath: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: electron.getPath } }))

import { reportTaskTransition } from './backlog-report.service'

describe.skipIf(!hasCli)('against a real Backlog repository', () => {
  let repo: string

  // `backlog init` is run through a shell (see hasCli above), so a multi-word
  // project name would split into separate arguments — OneWordName avoids that.
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-backlog-real-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['config', 'user.email', 'superior-test@example.com'], { cwd: repo })
    execFileSync('git', ['config', 'user.name', 'Superior Test'], { cwd: repo })
    execSync(
      'backlog init ProbeProject --agent-instructions none --install-claude-agent false ' +
        '--auto-open-browser false --check-branches false',
      { cwd: repo }
    )
    electron.getPath.mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), 'superior-backlog-real-ud-')))
  }, 30_000)

  afterAll(async () => {
    // The CLI child spawned for each edit can hold the checkout briefly after
    // exit on Windows (the same lock diff-review.integration.test.ts works
    // around) — a bare rmSync can lose that race. A few retries clear it
    // without turning a harmless cleanup race into a failed test run.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.rmSync(repo, { recursive: true, force: true })
        return
      } catch (err) {
        if (attempt >= 5) throw err
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
  })

  /** Creates a task in the repo and returns its id in `task-N` form. */
  function createTask(title: string): string {
    const out = execSync(`backlog task create "${title}"`, { cwd: repo, encoding: 'utf-8' })
    const match = /Created task TASK-(\d+)/i.exec(out)
    if (!match) throw new Error(`could not parse a task id out of: ${out}`)
    return `task-${match[1]}`
  }

  function taskFilePath(taskId: string): string {
    const dir = path.join(repo, 'backlog', 'tasks')
    const prefix = `${taskId} -`.toLowerCase()
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase().startsWith(prefix))
    if (!file) throw new Error(`no task markdown for ${taskId} in ${dir}`)
    return path.join(dir, file)
  }

  /** Rereads the task's markdown from disk — never cached across polls. */
  function readTaskFile(taskId: string): string {
    return fs.readFileSync(taskFilePath(taskId), 'utf-8')
  }

  function task(over: Partial<AgentTask> & { backlogTaskId: string; status: AgentTaskStatus }): AgentTask {
    return {
      id: randomUUID(),
      folderPath: repo,
      prompt: `about ${over.backlogTaskId}`,
      presetId: 'preset-claude',
      useWorktree: false,
      createdAt: Date.now(),
      ...over
    }
  }

  it('a start writes In Progress', async () => {
    const id = createTask('Start task')
    reportTaskTransition(task({ backlogTaskId: id, status: 'running', startedAt: Date.now() }), 'queued')

    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: In Progress$/m), { timeout: 10_000 })
  })

  it('a clean finish writes Done plus a note in the spec shape', async () => {
    const id = createTask('Finish task')
    const startedAt = Date.now() - 12_000
    const finishedAt = Date.now()
    reportTaskTransition(task({ backlogTaskId: id, status: 'running', startedAt }), 'queued')
    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: In Progress$/m), { timeout: 10_000 })

    reportTaskTransition(
      task({ backlogTaskId: id, status: 'done', exitCode: 0, startedAt, finishedAt, presetId: 'preset-claude' }),
      'running'
    )

    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: Done$/m), { timeout: 10_000 })
    const md = readTaskFile(id)
    expect(md).toMatch(/## Implementation Notes/)
    expect(md).toMatch(/superior: done · exit 0 · preset-claude · \d+s · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/)
  })

  it('a worktree failure writes To Do with a branch segment, into the main checkout', async () => {
    const id = createTask('Worktree failure task')
    const startedAt = Date.now() - 4_000
    const finishedAt = Date.now()
    reportTaskTransition(task({ backlogTaskId: id, status: 'running', startedAt }), 'queued')
    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: In Progress$/m), { timeout: 10_000 })

    // useWorktree is true, but folderPath (below, via task()) is always the
    // main checkout `repo` — that's the invariant this test exists to prove:
    // the write never targets a worktree, only task.folderPath.
    reportTaskTransition(
      task({
        backlogTaskId: id,
        status: 'failed',
        useWorktree: true,
        branch: 'task/fix-cart-a3f1',
        error: 'worktree-missing',
        startedAt,
        finishedAt
      }),
      'running'
    )

    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: To Do$/m), { timeout: 10_000 })
    const md = readTaskFile(id)
    expect(md).toMatch(/superior: failed · preset-claude · worktree-missing · branch task\/fix-cart-a3f1 · \d+s/)
    // The file this asserts on lives under `repo`, the main checkout — there
    // is no worktree directory involved anywhere in this test.
    expect(taskFilePath(id).startsWith(repo)).toBe(true)
  })

  it('a canceled run never renders "exit null"', async () => {
    const id = createTask('Canceled task')
    const startedAt = Date.now() - 62_000
    const finishedAt = Date.now()
    reportTaskTransition(task({ backlogTaskId: id, status: 'running', startedAt }), 'queued')
    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: In Progress$/m), { timeout: 10_000 })

    reportTaskTransition(
      task({ backlogTaskId: id, status: 'canceled', exitCode: null, startedAt, finishedAt }),
      'running'
    )

    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: To Do$/m), { timeout: 10_000 })
    const md = readTaskFile(id)
    expect(md).toMatch(/superior: canceled · preset-claude · 1m02s/)
    expect(md).not.toMatch(/exit null/)
  })

  it('does not demote a task the agent already marked Done itself', async () => {
    const id = createTask('Agent finished it task')
    const startedAt = Date.now() - 8_000
    const finishedAt = Date.now()
    reportTaskTransition(task({ backlogTaskId: id, status: 'running', startedAt }), 'queued')
    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: In Progress$/m), { timeout: 10_000 })

    // Simulate the agent finishing the work and marking it Done itself, the
    // same way it would via its own `backlog task edit -s Done` call.
    execSync(`backlog task edit ${id} -s Done`, { cwd: repo })
    await vi.waitFor(() => expect(readTaskFile(id)).toMatch(/^status: Done$/m), { timeout: 10_000 })

    // Superior's own run then exits nonzero for something unrelated.
    reportTaskTransition(
      task({ backlogTaskId: id, status: 'failed', exitCode: 1, startedAt, finishedAt, error: undefined }),
      'running'
    )

    await vi.waitFor(
      () => expect(readTaskFile(id)).toMatch(/superior: failed · exit 1 · preset-claude · \d+s/),
      { timeout: 10_000 }
    )
    // The status the agent set survives — it is not demoted back to To Do.
    expect(readTaskFile(id)).toMatch(/^status: Done$/m)
  })
})
