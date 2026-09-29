import { randomUUID } from 'crypto'
import * as net from 'net'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { stopUsageTracking } from './usage.service'
import {
  installedHost,
  markHostBroken,
  relocatedHost,
  socketPath,
  spawnDaemonProcess,
  type DaemonHost
} from './daemonHost'
import {
  FrameDecoder,
  encodeFrame,
  type ClientMessage,
  type DaemonSession,
  type DaemonSessionMeta,
  type DirectSpawn,
  type ServerMessage
} from '@shared/daemon-protocol'

let sock: net.Socket | null = null
let connecting: Promise<net.Socket> | null = null

// How long to wait for a daemon reply before giving up, so a dead daemon can't
// hang the renderer's await forever.
const REQUEST_TIMEOUT_MS = 5000

interface PendingList {
  resolve: (list: DaemonSession[]) => void
  reject: (err: Error) => void
  /** Timed out or flushed; kept in the FIFO so a late reply consumes its own
   *  slot instead of the next caller's. */
  settled: boolean
}
const pendingLists: PendingList[] = []
const pendingSpawns = new Map<
  string,
  { resolve: (res: { pid?: number }) => void; reject: (err: Error) => void }
>()
const pendingKills = new Map<
  string,
  { id: string; resolve: () => void; reject: (err: Error) => void }
>()
interface DaemonExit {
  id: string
  exitCode: number | null
  reason?: 'interrupted'
}
const exitListeners = new Set<(event: DaemonExit) => void>()
// Compatibility with a daemon started by an older app build that does not yet
// tag attach snapshots as replay. The first data frame after attach is the
// synchronous scrollback snapshot (or harmlessly treated as one if empty).
const pendingReplay = new Set<string>()
// Attach state lives per-conn in the daemon, so it dies with the socket. Track
// it here to restore after a reconnect — without that, every mounted terminal
// freezes silently (no data, no exit — 'running' forever) once the daemon or
// the socket drops.
const attachedIds = new Set<string>()
// Ids attached on the previous socket, awaiting re-attach on the next connect.
const toResume = new Set<string>()
// Re-attach snapshots to drop: the terminal already shows that scrollback, so
// replaying it would duplicate everything on screen.
const suppressReplay = new Set<string>()
// Consecutive silent reconnect cycles — bounded so a daemon that dies faster
// than it answers isn't respawned in a tight loop.
let reattachAttempts = 0
const MAX_REATTACH_ATTEMPTS = 3

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Fan an exit out to the renderer and main-side listeners. */
function deliverExit(id: string, exitCode: number | null, reason?: 'interrupted'): void {
  attachedIds.delete(id)
  toResume.delete(id)
  pendingReplay.delete(id)
  suppressReplay.delete(id)
  stopUsageTracking(id)
  // Compatibility: an older daemon does not understand the explicit `killed`
  // acknowledgement, but its real exit event still confirms that the process
  // stopped. Resolve any matching request before broadcasting the exit.
  for (const [requestId, pending] of pendingKills) {
    if (pending.id === id) {
      pendingKills.delete(requestId)
      pending.resolve()
    }
  }
  const message = exitCode === 127
    ? 'command not found. Is it installed and on your PATH?'
    : reason === 'interrupted'
      ? 'Terminal daemon disconnected before the process result was known.'
      : undefined
  const event: DaemonExit = reason ? { id, exitCode, reason } : { id, exitCode }
  broadcast(IPC.AGENT_EXIT, { ...event, message })
  for (const listener of exitListeners) listener(event)
}

function onServerMessage(msg: ServerMessage): void {
  reattachAttempts = 0 // the daemon is answering — a future drop starts fresh
  switch (msg.t) {
    case 'data': {
      const expectedReplay = pendingReplay.delete(msg.id)
      const replay = msg.replay === true || expectedReplay
      // A re-attach snapshot would duplicate scrollback already on screen.
      if (replay && suppressReplay.delete(msg.id)) break
      broadcast(IPC.AGENT_DATA, { id: msg.id, data: msg.data, replay })
      break
    }
    case 'exit':
      deliverExit(msg.id, msg.exitCode)
      break
    case 'sessions': {
      // One reply per request, in order: a late reply for a timed-out request
      // consumes its own settled slot rather than the next caller's.
      const entry = pendingLists.shift()
      if (entry && !entry.settled) {
        entry.settled = true
        entry.resolve(msg.list)
      }
      break
    }
    case 'spawned': {
      const entry = pendingSpawns.get(msg.id)
      if (entry) {
        entry.resolve({ pid: msg.pid })
        pendingSpawns.delete(msg.id)
      }
      break
    }
    case 'killed': {
      const entry = pendingKills.get(msg.requestId)
      if (entry) {
        pendingKills.delete(msg.requestId)
        entry.resolve()
      }
      break
    }
    case 'error':
      if (msg.id && pendingSpawns.has(msg.id)) {
        pendingSpawns.get(msg.id)?.reject(new Error(msg.message || 'spawn failed'))
        pendingSpawns.delete(msg.id)
      } else if (msg.id && pendingReplay.delete(msg.id)) {
        // A failed attach (the only id-tagged error besides spawn): the session
        // is gone — it exited while unattached, under a daemon predating
        // exit-to-all-clients. Synthesize an exit (code unknowable) so the
        // terminal and the task queue don't wait forever.
        deliverExit(msg.id, null, 'interrupted')
      }
      break
  }
}

/** Unblock every in-flight request (daemon went away): reject spawns and lists
 * so callers surface an error instead of mistaking the outage for no sessions. */
function flushPending(): void {
  for (const { reject } of pendingSpawns.values()) {
    reject(new Error('Terminal daemon disconnected.'))
  }
  pendingSpawns.clear()
  for (const { reject } of pendingKills.values()) {
    reject(new Error('Terminal daemon disconnected.'))
  }
  pendingKills.clear()
  for (const entry of pendingLists.splice(0)) {
    if (!entry.settled) {
      entry.settled = true
      entry.reject(new Error('Terminal daemon disconnected.'))
    }
  }
  pendingReplay.clear()
  suppressReplay.clear()
}

/** Give up on re-attaching: synthesize exits so terminals and the task queue
 * unfreeze into restartable cells instead of waiting forever. */
function abandonAttached(): void {
  reattachAttempts = 0
  toResume.clear()
  for (const id of [...attachedIds]) deliverExit(id, null, 'interrupted')
}

/** After a socket drop, restore streaming for mounted terminals. Bounded: give
 * up (with synthetic exits) when the daemon keeps dying without answering. */
function scheduleReattach(): void {
  if (attachedIds.size === 0) {
    toResume.clear()
    return
  }
  if (reattachAttempts >= MAX_REATTACH_ATTEMPTS) {
    abandonAttached()
    return
  }
  reattachAttempts += 1
  setTimeout(() => {
    if (attachedIds.size === 0) return
    ensureDaemon().catch(() => abandonAttached())
  }, 500)
}

function setupSocket(s: net.Socket): void {
  const decoder = new FrameDecoder<ServerMessage>()
  s.on('data', (chunk) => {
    try {
      // This binary protocol must not be decoded by net.Socket. Node's newer
      // typings correctly model a string here when an encoding is configured;
      // reject that unexpected state rather than corrupting terminal bytes.
      if (typeof chunk === 'string') throw new Error('daemon socket received decoded data')
      for (const msg of decoder.push(chunk)) onServerMessage(msg)
    } catch (err) {
      console.error('[daemon] malformed server frame:', err)
      s.destroy()
    }
  })
  s.on('close', () => {
    if (sock === s) sock = null
    // Remember what was attached so the next connect can restore it; explicit
    // attach() calls during the gap opt back into a fresh replay instead.
    for (const id of attachedIds) toResume.add(id)
    flushPending()
    scheduleReattach()
  })
  s.on('error', () => {
    /* surfaced via close */
  })
  s.write(encodeFrame({ t: 'hello' }))
  // Restore attach state from the previous conn: resumed sessions stream again
  // (their snapshot suppressed — that scrollback is already on screen), and ids
  // the daemon no longer knows error out into synthetic exits above.
  for (const id of toResume) {
    if (!attachedIds.has(id)) continue
    pendingReplay.add(id)
    suppressReplay.add(id)
    s.write(encodeFrame({ t: 'attach', id }))
  }
  toResume.clear()
}

function tryConnect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(socketPath())
    s.once('connect', () => resolve(s))
    s.once('error', reject)
  })
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Start a daemon from `host` and wait for its socket. Resolves null when the
 * child died on start (non-zero exit) or never came up, so the caller can fall
 * back. Exit 0 is a daemon that found another one already listening — keep
 * connecting, that one answers.
 */
async function launchAndConnect(host: DaemonHost): Promise<net.Socket | null> {
  const child = spawnDaemonProcess(host)
  let crashed = false
  child.once('exit', (code) => {
    if (code !== 0) crashed = true
  })
  child.once('error', () => {
    crashed = true
  })
  for (let i = 0; i < 20 && !crashed; i++) {
    await delay(Math.min(50 + i * 30, 500))
    try {
      return await tryConnect()
    } catch {
      /* keep retrying */
    }
  }
  if (crashed) {
    console.error(`[daemon] daemon from ${host.execPath} exited on start`)
    markHostBroken(host)
  }
  return null
}

async function connectOrSpawn(): Promise<net.Socket> {
  try {
    return await tryConnect()
  } catch {
    // Prefer the relocated host (Windows): it survives app updates. Fail open
    // to the installed one, which every platform can run.
    const relocated = await relocatedHost()
    for (const host of relocated ? [relocated, installedHost()] : [installedHost()]) {
      const s = await launchAndConnect(host)
      if (s) return s
    }
    throw new Error('Terminal daemon is unavailable.')
  }
}

async function ensureDaemon(): Promise<net.Socket> {
  if (sock && !sock.destroyed) return sock
  if (!connecting) {
    connecting = connectOrSpawn()
      .then((s) => {
        setupSocket(s)
        sock = s
        return s
      })
      .finally(() => {
        connecting = null
      })
  }
  return connecting
}

async function send(msg: ClientMessage): Promise<void> {
  const s = await ensureDaemon()
  s.write(encodeFrame(msg))
}

/** Fire-and-forget send: an unreachable daemon must not surface as an
 * unhandled rejection on every keystroke/resize. */
function post(msg: ClientMessage): void {
  send(msg).catch((err) => console.error('[daemon] send failed:', err))
}

export const daemonClient = {
  ensure: ensureDaemon,

  async spawn(payload: {
    id: string
    command: string
    direct?: DirectSpawn
    cwd: string
    cols: number
    rows: number
    meta: DaemonSessionMeta
    env?: Record<string, string>
  }): Promise<{ pid?: number }> {
    const s = await ensureDaemon()
    const result = new Promise<{ pid?: number }>((resolve, reject) => {
      pendingSpawns.set(payload.id, { resolve, reject })
      setTimeout(() => {
        if (pendingSpawns.delete(payload.id)) {
          // A slow (not dead) daemon may still spawn the pty after we gave up
          // — reap it (kill of an unknown id is a no-op) so it can't linger as
          // a ghost session in the next list/restore.
          post({ t: 'kill', id: payload.id })
          reject(new Error('Timed out waiting for the terminal daemon.'))
        }
      }, REQUEST_TIMEOUT_MS)
    })
    s.write(encodeFrame({ t: 'spawn', ...payload }))
    return result
  },

  /** Rejects on timeout/disconnect — the caller must not mistake an
   * unreachable daemon for one with no sessions. */
  async list(): Promise<DaemonSession[]> {
    const s = await ensureDaemon()
    const result = new Promise<DaemonSession[]>((resolve, reject) => {
      const entry: PendingList = { resolve, reject, settled: false }
      pendingLists.push(entry)
      setTimeout(() => {
        if (!entry.settled) {
          entry.settled = true
          reject(new Error('Timed out waiting for the terminal daemon.'))
        }
      }, REQUEST_TIMEOUT_MS)
    })
    s.write(encodeFrame({ t: 'list' }))
    return result
  },

  attach(id: string): void {
    attachedIds.add(id)
    toResume.delete(id) // an explicit (re)mount wants the replay snapshot
    pendingReplay.add(id)
    post({ t: 'attach', id })
  },
  detach(id: string): void {
    attachedIds.delete(id)
    pendingReplay.delete(id)
    post({ t: 'detach', id })
  },
  updateMeta(id: string, meta: Partial<DaemonSessionMeta>): void {
    post({ t: 'update', id, meta })
  },
  /** Batch input propagates connection/write failures to its caller. */
  async inputChecked(id: string, data: string): Promise<void> {
    const s = await ensureDaemon()
    await new Promise<void>((resolve, reject) => {
      s.write(encodeFrame({ t: 'input', id, data }), (error) => error ? reject(error) : resolve())
    })
  },
  input(id: string, data: string): void {
    post({ t: 'input', id, data })
  },
  resize(id: string, cols: number, rows: number): void {
    post({ t: 'resize', id, cols, rows })
  },
  async kill(id: string): Promise<void> {
    const s = await ensureDaemon()
    const requestId = randomUUID()
    const result = new Promise<void>((resolve, reject) => {
      pendingKills.set(requestId, { id, resolve, reject })
      setTimeout(() => {
        if (pendingKills.delete(requestId)) {
          reject(new Error('Timed out waiting for the terminal daemon to acknowledge the kill.'))
        }
      }, REQUEST_TIMEOUT_MS)
    })
    s.write(encodeFrame({ t: 'kill', id, requestId }))
    return result
  },

  onExit(listener: (event: DaemonExit) => void): () => void {
    exitListeners.add(listener)
    return () => exitListeners.delete(listener)
  },

  /** Drop the connection without killing sessions (used on app quit). */
  disconnect(): void {
    // Intentional: sessions keep running unobserved — no re-attach cycle.
    attachedIds.clear()
    toResume.clear()
    if (sock) {
      sock.destroy()
      sock = null
    }
  }
}

/**
 * Kill the daemon (and its ptys), waiting until it actually exits. Used before
 * an app update installs when the daemon runs from the install dir (a fallback
 * or pre-relocation daemon; see daemonHost.ts): it then runs the app's own
 * executable, so a lingering instance keeps a Windows lock on the file the NSIS updater must
 * overwrite ("Superior cannot be closed. Please close it manually…"). Clearing
 * the attach set first stops the socket-close handler from respawning it, and a
 * missing daemon is a no-op (never spawn one just to kill it). Bounded so a
 * daemon that won't answer can't stall the update.
 */
export async function shutdownDaemon(timeoutMs = 3000): Promise<void> {
  attachedIds.clear()
  toResume.clear()
  let s = sock
  if (!s || s.destroyed) {
    // Not currently attached; reach a still-alive daemon without spawning one.
    try {
      s = await tryConnect()
    } catch {
      return // nothing listening — no daemon to bring down
    }
  }
  const target = s
  await new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      resolve()
    }
    target.once('close', finish)
    target.once('error', finish)
    const timer = setTimeout(finish, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      target.write(encodeFrame({ t: 'shutdown' }))
    } catch {
      finish()
    }
  })
  if (sock === target) sock = null
  try {
    target.destroy()
  } catch {
    /* already closed */
  }
}
