import { spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as net from 'net'
import { join, win32 as winPath } from 'path'
import { app } from 'electron'
import {
  FrameDecoder,
  daemonSocketPath,
  encodeFrame,
  type DaemonInfo,
  type ServerMessage
} from '@shared/daemon-protocol'

/**
 * Where the terminal daemon's process image lives, and how it is started.
 *
 * On Windows the NSIS updater force-kills every process whose image sits under
 * the install dir, so a daemon running the installed Superior.exe dies with
 * every update — and, while alive, locks that exe. The packaged Windows app
 * therefore copies a trimmed run-as-node runtime (the app exe verbatim, V8/ICU
 * blobs, the daemon bundle and node-pty) to
 * %LOCALAPPDATA%\Superior\daemon-host\<version>\ and starts the daemon from
 * there. The exe keeps its own file name: a renamed copy of a signed binary
 * reads as masquerading to EDR. Everything here fails open to the installed
 * host, which is the pre-relocation behaviour.
 */

export interface DaemonHost {
  execPath: string
  entryPath: string
  relocated: boolean
}

// Keep in sync with build/installer.nsh, which removes it on a real uninstall.
const HOST_ROOT_NAME = 'Superior'
const HOST_SUBDIR = 'daemon-host'
const MARKER_NAME = '.materialized.json'
/** Written next to a host whose daemon crashed on start, so later launches skip it. */
const BROKEN_NAME = '.broken'
// V8 snapshots + ICU data the Electron bootstrap reads even as plain Node. The
// top-level GPU/media DLLs are never loaded by a windowless run-as-node host.
const RUNTIME_DATA_FILES = ['icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin']
const DAEMON_DIR = 'daemon'
const ENTRY_REL = ['out', 'main', 'daemon.js']
const STDERR_CAP_BYTES = 256_000

export function socketPath(): string {
  return daemonSocketPath(app.getPath('userData'))
}

function logPath(): string {
  return join(app.getPath('userData'), 'daemon.log')
}

/** The daemon bundled with the running app (inside the asar in production). */
export function installedHost(): DaemonHost {
  return {
    execPath: process.execPath,
    entryPath: join(app.getAppPath(), ...ENTRY_REL),
    relocated: false
  }
}

function relocationApplies(): boolean {
  return process.platform === 'win32' && app.isPackaged && app.getAppPath().includes('app.asar')
}

function hostRoot(): string {
  const local = process.env.LOCALAPPDATA
  const base = local ? join(local, HOST_ROOT_NAME) : app.getPath('userData')
  return join(base, HOST_SUBDIR)
}

function hostDir(version = app.getVersion()): string {
  return join(hostRoot(), version)
}

function hostAt(dir: string): DaemonHost {
  return {
    execPath: join(dir, winPath.basename(process.execPath)),
    entryPath: join(dir, DAEMON_DIR, ...ENTRY_REL),
    relocated: true
  }
}

/** Case-insensitive, separator-aware "is `path` inside `dir`" (Windows paths). */
export function isInsideDir(path: string, dir: string): boolean {
  const rel = winPath.relative(winPath.resolve(dir), winPath.resolve(path))
  return rel !== '' && !rel.startsWith('..') && !winPath.isAbsolute(rel)
}

/** node-pty's runtime files: drop sources, symbols, build intermediates and other arches. */
export function isRuntimeNodePtyPath(packageRel: string, arch = process.arch): boolean {
  const p = packageRel.split(winPath.sep).join('/').toLowerCase()
  if (p === '') return true
  const top = p.split('/')[0]
  if (['deps', 'src', 'scripts', 'typings', 'node-addon-api'].includes(top)) return false
  if (/\.(pdb|obj|lib|ilk|iobj|ipdb|exp|tlog|cc|h|gyp|mk)$/.test(p)) return false
  if (p.startsWith('build/') && /\/obj(\/|$)/.test(p)) return false
  const prebuild = p.match(/^prebuilds\/([^/]+)/)
  if (prebuild) return prebuild[1] === `win32-${arch}`
  const conpty = p.match(/^third_party\/conpty\/[^/]+\/([^/]+)/)
  if (conpty) return conpty[1] === `win10-${arch}`
  return true
}

function hostComplete(dir: string): boolean {
  try {
    const marker = JSON.parse(fs.readFileSync(join(dir, MARKER_NAME), 'utf8')) as { version?: string }
    if (marker.version !== app.getVersion()) return false
  } catch {
    return false
  }
  const host = hostAt(dir)
  return (
    !fs.existsSync(join(dir, BROKEN_NAME)) &&
    fs.existsSync(host.execPath) &&
    fs.existsSync(host.entryPath) &&
    fs.existsSync(join(dir, DAEMON_DIR, 'node_modules', 'node-pty', 'package.json'))
  )
}

/** Copy a directory read through Electron's asar-aware sync fs (fs.cp can't read asar). */
function copyAsarDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    if (fs.statSync(from).isDirectory()) copyAsarDir(from, to)
    else fs.writeFileSync(to, fs.readFileSync(from))
  }
}

async function stageHost(staging: string): Promise<void> {
  const appDir = winPath.dirname(process.execPath)
  await fs.promises.mkdir(staging, { recursive: true })
  await fs.promises.copyFile(process.execPath, join(staging, winPath.basename(process.execPath)))
  for (const name of RUNTIME_DATA_FILES) {
    await fs.promises.copyFile(join(appDir, name), join(staging, name)).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    })
  }
  // The whole out/main tree: daemon.js requires its shared chunks by relative path.
  copyAsarDir(join(app.getAppPath(), 'out', 'main'), join(staging, DAEMON_DIR, 'out', 'main'))
  // Plain CommonJS regardless of any package.json further up the tree.
  await fs.promises.writeFile(join(staging, DAEMON_DIR, 'package.json'), '{"type":"commonjs"}\n')
  const nodePty = join(`${app.getAppPath()}.unpacked`, 'node_modules', 'node-pty')
  await fs.promises.cp(nodePty, join(staging, DAEMON_DIR, 'node_modules', 'node-pty'), {
    recursive: true,
    dereference: true,
    filter: (src) => isRuntimeNodePtyPath(winPath.relative(nodePty, src))
  })
  // Marker last: an interrupted copy never looks complete.
  await fs.promises.writeFile(
    join(staging, MARKER_NAME),
    JSON.stringify({ version: app.getVersion(), completedAt: new Date().toISOString() })
  )
}

async function materialize(): Promise<DaemonHost | null> {
  if (!relocationApplies()) return null
  const dest = hostDir()
  if (hostComplete(dest)) return hostAt(dest)
  if (fs.existsSync(join(dest, BROKEN_NAME))) return null
  const staging = `${dest}.staging-${randomBytes(6).toString('hex')}`
  try {
    await stageHost(staging)
    // A live daemon already running from `dest` (same-version reinstall) makes
    // this throw — Windows won't delete a running image — and we fail open.
    await fs.promises.rm(dest, { recursive: true, force: true })
    await fs.promises.rename(staging, dest)
    return hostComplete(dest) ? hostAt(dest) : null
  } catch (err) {
    console.warn('[daemon] relocating the daemon host failed; using the installed one:', err)
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    return null
  }
}

let materializing: Promise<DaemonHost | null> | null = null

/** The relocated host for this version, copying it on first use. Never rejects. */
export function relocatedHost(): Promise<DaemonHost | null> {
  materializing ??= materialize().catch(() => null)
  return materializing
}

/** Record that the relocated host can't run a daemon, so launches stop trying it. */
export function markHostBroken(host: DaemonHost): void {
  if (!host.relocated) return
  try {
    fs.writeFileSync(join(winPath.dirname(host.execPath), BROKEN_NAME), new Date().toISOString())
  } catch {
    /* best effort — the in-memory fallback still applies this run */
  }
  materializing = Promise.resolve(null)
}

/** Reopen stderr capture, truncating a log that has grown past its cap. */
function openStderrLog(): number | 'ignore' {
  const file = join(app.getPath('userData'), 'daemon-stderr.log')
  try {
    const big = fs.existsSync(file) && fs.statSync(file).size > STDERR_CAP_BYTES
    return fs.openSync(file, big ? 'w' : 'a')
  } catch {
    return 'ignore'
  }
}

/**
 * Start a detached daemon from `host`. stderr goes to a file (not a pipe, which
 * would break once the app exits) so a crash on start leaves evidence behind;
 * cwd is userData so the daemon never pins a worktree or the install dir.
 */
export function spawnDaemonProcess(host: DaemonHost): ChildProcess {
  const stderr = openStderrLog()
  try {
    const child = spawn(host.execPath, [host.entryPath, socketPath(), logPath(), app.getVersion()], {
      cwd: app.getPath('userData'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', stderr]
    })
    child.on('error', (err) => console.error('[daemon] failed to start:', err))
    child.unref()
    return child
  } finally {
    if (typeof stderr === 'number') fs.closeSync(stderr)
  }
}

/**
 * Ask a running daemon who it is, without spawning one. Resolves null when
 * nothing listens; `{ info: null }` when a daemon answers but predates `info`.
 */
export function probeDaemon(timeoutMs = 1500): Promise<{ info: DaemonInfo | null } | null> {
  return new Promise((resolve) => {
    const s = net.connect(socketPath())
    const decoder = new FrameDecoder<ServerMessage>()
    let connected = false
    const finish = (result: { info: DaemonInfo | null } | null): void => {
      clearTimeout(timer)
      s.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish(connected ? { info: null } : null), timeoutMs)
    s.once('connect', () => {
      connected = true
      s.write(encodeFrame({ t: 'hello' }))
    })
    s.on('data', (chunk) => {
      if (typeof chunk === 'string') return
      try {
        for (const msg of decoder.push(chunk)) {
          if (msg.t === 'info') {
            const { pid, execPath, version } = msg
            return finish({ info: { pid, execPath, version } })
          }
        }
      } catch {
        finish({ info: null })
      }
    })
    s.once('error', () => finish(connected ? { info: null } : null))
  })
}

/**
 * Whether the running daemon holds a lock on the install dir's exe (Windows
 * updates must bring it down first). A daemon too old to say is assumed to.
 */
export async function daemonLocksInstall(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const probe = await probeDaemon()
  if (!probe) return false
  if (!probe.info) return true
  return isInsideDir(probe.info.execPath, winPath.dirname(process.execPath))
}

/**
 * Remove relocated hosts of other versions that no daemon runs from. The live
 * daemon's dir is skipped outright; any other dir must survive a rename first,
 * which Windows refuses while an image inside it is running.
 */
export async function pruneDaemonHosts(): Promise<void> {
  if (!relocationApplies()) return
  const root = hostRoot()
  const current = app.getVersion()
  const live = (await probeDaemon().catch(() => null))?.info?.execPath
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === current) continue
    const dir = join(root, entry.name)
    if (live && isInsideDir(live, dir)) continue
    const trash = `${dir}.trash-${randomBytes(4).toString('hex')}`
    try {
      if (!entry.name.includes('.trash-')) await fs.promises.rename(dir, trash)
      await fs.promises.rm(entry.name.includes('.trash-') ? dir : trash, { recursive: true, force: true })
    } catch {
      /* in use or locked — retried on a later launch */
    }
  }
}

/** Launch-time background work: copy this version's host early, then tidy old ones. */
export function prepareDaemonHost(): void {
  if (!relocationApplies()) return
  void relocatedHost()
    .then(() => pruneDaemonHosts())
    .catch(() => undefined)
}
