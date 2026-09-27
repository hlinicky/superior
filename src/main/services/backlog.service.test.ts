import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  describeResolvedBacklogCli,
  editBacklogTask,
  isBacklogRepo,
  readBacklogTaskStatus,
  resetBacklogResolution
} from './backlog.service'

/**
 * A stand-in for the backlog CLI that records how it was called. Writes
 * FAKE_CLI_STDOUT to stdout when set, so readBacklogTaskStatus tests can feed
 * it the shape of a real `--plain` reply without spawning the real CLI.
 */
const FAKE_CLI = `
const fs = require('fs')
fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd()
}) + '\\n')
if (process.env.FAKE_CLI_STDOUT) process.stdout.write(process.env.FAKE_CLI_STDOUT)
process.exit(Number(process.env.FAKE_CLI_EXIT || '0'))
`

describe('backlog.service', () => {
  let dir: string
  let cliPath: string
  let logPath: string
  let realPath: string | undefined
  let realAppData: string | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-backlog-'))
    cliPath = path.join(dir, 'fake-cli.js')
    logPath = path.join(dir, 'calls.log')
    fs.writeFileSync(cliPath, FAKE_CLI)
    realPath = process.env.PATH
    realAppData = process.env.APPDATA
    process.env.SUPERIOR_BACKLOG_CLI = cliPath
    process.env.FAKE_CLI_LOG = logPath
    delete process.env.FAKE_CLI_EXIT
    delete process.env.FAKE_CLI_STDOUT
    // The memo outlives a test but the temp CLI it points at does not, so every
    // test starts resolution over.
    resetBacklogResolution()
  })

  afterEach(() => {
    delete process.env.SUPERIOR_BACKLOG_CLI
    delete process.env.FAKE_CLI_LOG
    delete process.env.FAKE_CLI_EXIT
    delete process.env.FAKE_CLI_STDOUT
    if (realPath === undefined) delete process.env.PATH
    else process.env.PATH = realPath
    if (realAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = realAppData
    resetBacklogResolution()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const calls = (): Array<{ argv: string[]; cwd: string }> =>
    fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []

  it('recognises a folder holding a backlog directory', () => {
    const repo = path.join(dir, 'repo')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })
    expect(isBacklogRepo(repo)).toBe(true)
  })

  it('rejects a folder without one', () => {
    const plain = path.join(dir, 'plain')
    fs.mkdirSync(plain, { recursive: true })
    expect(isBacklogRepo(plain)).toBe(false)
  })

  it('runs task edit in the repository with the status as a separate argument', async () => {
    const repo = path.join(dir, 'repo2')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

    await editBacklogTask({ repoPath: repo, taskId: 'task-42', status: 'In Progress' })

    expect(calls()).toHaveLength(1)
    expect(calls()[0].argv).toEqual(['task', 'edit', 'task-42', '-s', 'In Progress'])
    expect(fs.realpathSync(calls()[0].cwd)).toBe(fs.realpathSync(repo))
  })

  it('passes a note through --append-notes alongside the status', async () => {
    const repo = path.join(dir, 'repo3')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

    await editBacklogTask({
      repoPath: repo,
      taskId: 'task-7',
      status: 'Done',
      appendNotes: 'superior: done · claude · 12s · 2026-09-27 14:03 UTC'
    })

    expect(calls()[0].argv).toEqual([
      'task',
      'edit',
      'task-7',
      '-s',
      'Done',
      '--append-notes',
      'superior: done · claude · 12s · 2026-09-27 14:03 UTC'
    ])
  })

  it('rejects when the CLI exits nonzero', async () => {
    process.env.FAKE_CLI_EXIT = '1'
    const repo = path.join(dir, 'repo4')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

    await expect(
      editBacklogTask({ repoPath: repo, taskId: 'task-999', status: 'Done' })
    ).rejects.toThrow()
  })

  it('rejects when no CLI can be found', async () => {
    process.env.SUPERIOR_BACKLOG_CLI = path.join(dir, 'does-not-exist.js')
    resetBacklogResolution()
    const repo = path.join(dir, 'repo5')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

    await expect(
      editBacklogTask({ repoPath: repo, taskId: 'task-1', status: 'Done' })
    ).rejects.toThrow(/backlog CLI/i)
  })

  it('treats an explicit override as the only candidate, never falling through to a real CLI', async () => {
    process.env.SUPERIOR_BACKLOG_CLI = path.join(dir, 'not-installed.js')
    resetBacklogResolution()
    const repo = path.join(dir, 'repo6')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

    await expect(
      editBacklogTask({ repoPath: repo, taskId: 'task-1', status: 'Done' })
    ).rejects.toThrow(/backlog CLI/i)
    // Nothing ran: a fall-through to a CLI on this machine would have logged a call.
    expect(fs.existsSync(logPath)).toBe(false)
  })

  describe('readBacklogTaskStatus', () => {
    // Shapes verified against a real Backlog.md 1.52.0 repository — see
    // backlog-report.service.ts's parseStatusLine comment for the full output.
    it('parses the status text off the icon-prefixed Status line', async () => {
      process.env.FAKE_CLI_STDOUT =
        'Task TASK-1 - Probe task\n==========\n\nStatus: ✔ Done\nOrdinal: 1000\n'
      const repo = path.join(dir, 'repo7')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await expect(readBacklogTaskStatus(repo, 'task-1')).resolves.toBe('Done')
    })

    it('parses a two-word status the same way', async () => {
      process.env.FAKE_CLI_STDOUT = 'Task TASK-1 - Probe task\n==========\n\nStatus: ◒ In Progress\n'
      const repo = path.join(dir, 'repo8')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await expect(readBacklogTaskStatus(repo, 'task-1')).resolves.toBe('In Progress')
    })

    it('resolves null rather than rejecting when the task does not exist', async () => {
      process.env.FAKE_CLI_EXIT = '1'
      process.env.FAKE_CLI_STDOUT = ''
      const repo = path.join(dir, 'repo9')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await expect(readBacklogTaskStatus(repo, 'task-999')).resolves.toBeNull()
    })

    it('resolves null when no CLI can be found, rather than rejecting', async () => {
      process.env.SUPERIOR_BACKLOG_CLI = path.join(dir, 'does-not-exist.js')
      resetBacklogResolution()
      const repo = path.join(dir, 'repo10')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await expect(readBacklogTaskStatus(repo, 'task-1')).resolves.toBeNull()
    })

    it('resolves null when the output has no parseable Status line', async () => {
      process.env.FAKE_CLI_STDOUT = 'Task 999 not found.\n'
      const repo = path.join(dir, 'repo11')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await expect(readBacklogTaskStatus(repo, 'task-1')).resolves.toBeNull()
    })

    it('runs with the id and --plain as separate argv entries', async () => {
      process.env.FAKE_CLI_STDOUT = 'Status: ○ To Do\n'
      const repo = path.join(dir, 'repo12')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await readBacklogTaskStatus(repo, 'task-42')

      expect(calls()[0].argv).toEqual(['task', 'task-42', '--plain'])
    })
  })

  describe('describeResolvedBacklogCli', () => {
    it('is null before any resolution has happened', () => {
      expect(describeResolvedBacklogCli()).toBeNull()
    })

    it('names the CLI a successful resolution found', async () => {
      const repo = path.join(dir, 'repo13')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await editBacklogTask({ repoPath: repo, taskId: 'task-1', status: 'Done' })

      expect(describeResolvedBacklogCli()).toContain(cliPath)
    })

    it('stays null when the only resolution attempt found nothing', async () => {
      process.env.SUPERIOR_BACKLOG_CLI = path.join(dir, 'does-not-exist.js')
      resetBacklogResolution()
      const repo = path.join(dir, 'repo14')
      fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

      await expect(editBacklogTask({ repoPath: repo, taskId: 'task-1', status: 'Done' })).rejects.toThrow()
      expect(describeResolvedBacklogCli()).toBeNull()
    })
  })
})
