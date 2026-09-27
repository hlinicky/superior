import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editBacklogTask, readBacklogTaskStatus, resetBacklogResolution } from './backlog.service'

// A wedged CLI must not leak a child process forever — editBacklogTask and
// readBacklogTaskStatus both give execFile a timeout. Proving that without
// actually waiting it out means never letting a real child spawn: this
// replaces child_process.execFile with a stub that records the options it was
// given and answers immediately.
const captured: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = []
vi.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
    callback: (err: Error | null, stdout?: string, stderr?: string) => void
  ) => {
    captured.push({ file, args, options })
    callback(null, 'Status: ○ To Do\n', '')
  }
}))

describe('a wedged CLI cannot leak a child process forever', () => {
  let dir: string
  let cliPath: string
  let realOverride: string | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-timeout-'))
    cliPath = path.join(dir, 'fake-cli.js')
    fs.writeFileSync(cliPath, '// never actually run: execFile is stubbed above')
    realOverride = process.env.SUPERIOR_BACKLOG_CLI
    process.env.SUPERIOR_BACKLOG_CLI = cliPath
    captured.length = 0
    resetBacklogResolution()
  })

  afterEach(() => {
    if (realOverride === undefined) delete process.env.SUPERIOR_BACKLOG_CLI
    else process.env.SUPERIOR_BACKLOG_CLI = realOverride
    resetBacklogResolution()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('gives editBacklogTask a bounded timeout', async () => {
    await editBacklogTask({ repoPath: dir, taskId: 'task-1', status: 'Done' })
    expect(captured).toHaveLength(1)
    expect(captured[0].options.timeout).toBe(30_000)
  })

  it('gives readBacklogTaskStatus a bounded timeout too', async () => {
    await readBacklogTaskStatus(dir, 'task-1')
    expect(captured).toHaveLength(1)
    expect(captured[0].options.timeout).toBe(30_000)
  })
})
