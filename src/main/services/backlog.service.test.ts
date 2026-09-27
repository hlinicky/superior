import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editBacklogTask, isBacklogRepo, resetBacklogResolution } from './backlog.service'

/** A stand-in for the backlog CLI that records how it was called. */
const FAKE_CLI = `
const fs = require('fs')
fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd()
}) + '\\n')
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
    // The memo outlives a test but the temp CLI it points at does not, so every
    // test starts resolution over.
    resetBacklogResolution()
  })

  afterEach(() => {
    delete process.env.SUPERIOR_BACKLOG_CLI
    delete process.env.FAKE_CLI_LOG
    delete process.env.FAKE_CLI_EXIT
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
    // This machine really does have backlog on PATH, so an override pointing at
    // nothing is not enough — resolution would simply find the real one and the
    // test would pass for the wrong reason. Take away every place it looks.
    process.env.SUPERIOR_BACKLOG_CLI = path.join(dir, 'does-not-exist.js')
    process.env.PATH = ''
    delete process.env.APPDATA
    resetBacklogResolution()
    const repo = path.join(dir, 'repo5')
    fs.mkdirSync(path.join(repo, 'backlog'), { recursive: true })

    await expect(
      editBacklogTask({ repoPath: repo, taskId: 'task-1', status: 'Done' })
    ).rejects.toThrow(/backlog CLI/i)
  })
})
