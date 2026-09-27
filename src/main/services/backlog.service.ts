// Wrapper around the Backlog.md CLI.
//
// The only file in Superior that knows Backlog.md exists. It shells out; it
// never imports the package, and it never parses task markdown. Arguments are
// always an argv array with shell:false — no string is ever interpolated into
// a command line.
//
// Resolution is deliberately duplicated from Minas's runner/lib/backlog.js
// rather than shared. The two live in separate repositories with no common
// package, and inventing one to share forty lines would cost more than the
// duplication does.

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import * as path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

interface BacklogCommand {
  command: string
  prefixArgs: string[]
  /**
   * True when `command` is this process's own binary. Under Electron that is
   * the Electron executable, which only behaves as Node with this set — without
   * it the spawn opens a second app window instead of running the CLI.
   */
  runAsNode: boolean
  describe: string
}

/** A folder is a Backlog project when it holds a `backlog` directory. */
export function isBacklogRepo(folderPath: string): boolean {
  try {
    return existsSync(path.join(folderPath, 'backlog'))
  } catch {
    return false
  }
}

/**
 * Work out how to run the backlog CLI on this machine.
 *
 * On Windows the npm global shim is `backlog.cmd`, which cannot be spawned
 * without a shell — so we find the package's `cli.js` and run it with the
 * current binary instead. That keeps shell:false everywhere.
 */
function resolve(): BacklogCommand {
  // An explicit override is authoritative: if someone names a CLI, resolution
  // uses that one or fails. Falling through to a different CLI on the machine
  // would be a worse outcome than a clear error, and it is what makes the
  // "no CLI can be found" case testable at all.
  const override = process.env.SUPERIOR_BACKLOG_CLI
  const candidates: string[] = []
  if (override) {
    candidates.push(override)
  } else {
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'backlog.md', 'cli.js'))
    }
    candidates.push('/usr/local/lib/node_modules/backlog.md/cli.js')
    candidates.push('/usr/lib/node_modules/backlog.md/cli.js')

    const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue
      for (const ext of exts) candidates.push(path.join(dir, `backlog${ext}`))
    }
  }

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue

    if (/\.(js|cjs|mjs)$/.test(candidate)) {
      return {
        command: process.execPath,
        prefixArgs: [candidate],
        runAsNode: true,
        describe: `node ${candidate}`
      }
    }

    // A .cmd/.bat shim needs a shell; find the JS it points at instead.
    if (/\.(cmd|bat|ps1)$/.test(candidate)) {
      const sibling = path.join(path.dirname(candidate), 'node_modules', 'backlog.md', 'cli.js')
      if (existsSync(sibling)) {
        return {
          command: process.execPath,
          prefixArgs: [sibling],
          runAsNode: true,
          describe: `node ${sibling}`
        }
      }
      continue
    }

    if (process.platform !== 'win32' || candidate.endsWith('.exe')) {
      return { command: candidate, prefixArgs: [], runAsNode: false, describe: candidate }
    }
  }

  throw new Error(
    'Could not find the backlog CLI. Install it with `npm i -g backlog.md`, or set ' +
      'SUPERIOR_BACKLOG_CLI to the path of its cli.js.'
  )
}

let memo: BacklogCommand | null = null

/** Clears the memo so a test can change what resolution will find. */
export function resetBacklogResolution(): void {
  memo = null
}

function resolved(): BacklogCommand {
  if (!memo) memo = resolve()
  return memo
}

/**
 * What CLI the last successful resolution found, for diagnostic messages only.
 * Null before anything has resolved, or after the only attempt found nothing —
 * there is nothing to name in that case, and the "could not find" error already
 * says so.
 */
export function describeResolvedBacklogCli(): string | null {
  return memo?.describe ?? null
}

// A spawn that never exits would leak a child process forever, one per
// transition. The measured healthy round trip is ~550ms; 30s is generous
// headroom for a slow disk without letting a wedged CLI pile up children.
const SPAWN_TIMEOUT_MS = 30_000

/**
 * Edit one task in one repository. Rejects on anything going wrong — a missing
 * CLI, an unknown task id, a folder that no longer exists. Callers decide what
 * a failure means; nothing here is swallowed, so nothing here is hidden.
 */
export async function editBacklogTask(args: {
  repoPath: string
  taskId: string
  status?: string
  appendNotes?: string
}): Promise<void> {
  const cli = resolved()
  const argv = [...cli.prefixArgs, 'task', 'edit', args.taskId]
  if (args.status) argv.push('-s', args.status)
  if (args.appendNotes) argv.push('--append-notes', args.appendNotes)

  await execFileAsync(cli.command, argv, {
    cwd: args.repoPath,
    shell: false,
    windowsHide: true,
    timeout: SPAWN_TIMEOUT_MS,
    env: cli.runAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
  })
}

/** The status text on an icon-prefixed `Status:` line, e.g. `✔ Done` -> `Done`. */
function parseStatusLine(stdout: string): string | null {
  const match = /^Status:\s*\S+\s+(.+?)\s*$/m.exec(stdout)
  return match ? match[1] : null
}

/**
 * Current Backlog status of one task, or null when it cannot be read — no CLI,
 * an unknown id, unparsable output. Callers treat null as "proceed as if this
 * check was never made": this is a best-effort read guarding a demotion, not a
 * condition anything should fail on.
 *
 * Parses `backlog task <id> --plain`, verified against a real Backlog.md 1.52.0
 * repository:
 *
 *   Task TASK-1 - Probe task
 *   ==================================================
 *
 *   Status: ✔ Done
 *   Ordinal: 1000
 *   Created: 2026-09-27 22:24 (UTC)
 */
export async function readBacklogTaskStatus(repoPath: string, taskId: string): Promise<string | null> {
  try {
    const cli = resolved()
    const argv = [...cli.prefixArgs, 'task', taskId, '--plain']
    const { stdout } = await execFileAsync(cli.command, argv, {
      cwd: repoPath,
      shell: false,
      windowsHide: true,
      timeout: SPAWN_TIMEOUT_MS,
      env: cli.runAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
    })
    return parseStatusLine(stdout)
  } catch {
    return null
  }
}
