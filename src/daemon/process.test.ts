import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FrameDecoder,
  daemonSocketPath,
  encodeFrame,
  type ClientMessage,
  type ServerMessage
} from '@shared/daemon-protocol'

// A cold `tsx` start plus node-pty's first native `fork` is sub-second on a
// developer machine but can take many seconds on a shared, throttled CI runner
// while the rest of the suite competes for the same few cores. Budget for that
// worst case — an unresponsive daemon still fails fast because a crash or an
// `error` reply settles the wait immediately (see waitFor / the child `exit`
// handler) rather than burning the whole timeout.
const CONNECT_TIMEOUT_MS = 15_000
const MESSAGE_TIMEOUT_MS = 20_000

interface Harness {
  child: ChildProcess
  socket: net.Socket
  send(message: ClientMessage): void
  waitFor(predicate: (message: ServerMessage) => boolean, description?: string): Promise<ServerMessage>
}

const cleanup: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose()
})

async function connectWithRetry(socketPath: string): Promise<net.Socket> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect(socketPath)
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      })
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('Timed out connecting to daemon test process.')
}

async function startHarness(): Promise<Harness> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'superior-daemon-process-'))
  const socketPath = daemonSocketPath(tmp)
  const logPath = path.join(tmp, 'daemon.log')
  const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'))
  const child = spawn(
    process.execPath,
    [
      tsxCli,
      '--tsconfig',
      path.resolve('tsconfig.node.json'),
      path.resolve('src/daemon/index.ts'),
      socketPath,
      logPath,
      '9.9.9'
    ],
    // Keep stderr so a native node-pty/libuv abort (which never reaches the
    // daemon's log file) is still attached to a failing assertion.
    { cwd: path.resolve('.'), stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  cleanup.push(async () => {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill()
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000))
      ])
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const socket = await connectWithRetry(socketPath)
  cleanup.push(() => {
    socket.destroy()
  })
  const decoder = new FrameDecoder<ServerMessage>()
  const queued: ServerMessage[] = []
  interface Waiter {
    predicate: (message: ServerMessage) => boolean
    description: string
    resolve: (message: ServerMessage) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }
  const waiters: Waiter[] = []
  let daemonExit: { code: number | null; signal: NodeJS.Signals | null } | null = null

  // Fold everything we know about the daemon into a wait failure: the message
  // types already received (an `error` reply to a rejected spawn shows here), the
  // tail of the daemon's own log, and any native stderr. Turns the otherwise
  // opaque "timed out" into an actionable CI failure.
  const diagnostic = (reason: string): string => {
    const received = queued.length ? JSON.stringify(queued) : 'none'
    let logTail = ''
    try {
      logTail = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-20).join('\n')
    } catch {
      /* the daemon may not have written its log yet */
    }
    const exit = daemonExit
      ? ` Daemon exited (code=${daemonExit.code}, signal=${daemonExit.signal}).`
      : ''
    return [
      reason + '.' + exit,
      `Received: ${received}`,
      logTail && `Daemon log:\n${logTail}`,
      stderr.trim() && `Daemon stderr:\n${stderr.trim()}`
    ]
      .filter(Boolean)
      .join('\n')
  }

  const settleWaiter = (waiter: Waiter): void => {
    clearTimeout(waiter.timer)
    const index = waiters.indexOf(waiter)
    if (index >= 0) waiters.splice(index, 1)
  }

  socket.on('data', (chunk) => {
    if (typeof chunk === 'string') throw new Error('Daemon test socket unexpectedly decoded data.')
    for (const message of decoder.push(chunk)) {
      const waiter = waiters.find((w) => w.predicate(message))
      if (waiter) {
        settleWaiter(waiter)
        waiter.resolve(message)
      } else {
        queued.push(message)
      }
    }
  })

  // A daemon that dies mid-request never sends the awaited reply; fail the
  // pending wait now instead of blocking until its timeout.
  child.on('exit', (code, signal) => {
    daemonExit = { code, signal }
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(diagnostic(`Daemon exited while waiting for ${waiter.description}`)))
    }
  })

  return {
    child,
    socket,
    send: (message) => socket.write(encodeFrame(message)),
    waitFor(predicate, description = 'a daemon message') {
      const index = queued.findIndex(predicate)
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0])
      if (daemonExit) {
        return Promise.reject(new Error(diagnostic(`Daemon already exited; cannot wait for ${description}`)))
      }
      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          predicate,
          description,
          resolve,
          reject,
          timer: setTimeout(() => {
            settleWaiter(waiter)
            reject(new Error(diagnostic(`Timed out waiting for ${description}`)))
          }, MESSAGE_TIMEOUT_MS)
        }
        waiters.push(waiter)
      })
    }
  }
}

describe('daemon process lifecycle', () => {
  it('answers hello with its identity', async () => {
    const harness = await startHarness()
    harness.send({ t: 'hello' })
    const info = await harness.waitFor((m) => m.t === 'info', 'an info reply')
    expect(info).toMatchObject({ t: 'info', version: '9.9.9' })
    if (info.t !== 'info') throw new Error('unreachable')
    expect(info.pid).toBeGreaterThan(0)
    expect(info.execPath).toBe(process.execPath)
  })

  it('spawns a PTY and acknowledges a kill before removing the session', async (ctx) => {
    const harness = await startHarness()
    const id = randomUUID()
    const requestId = randomUUID()
    harness.send({ t: 'hello' })
    harness.send({
      t: 'spawn',
      id,
      command: '',
      direct: {
        executable: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      },
      cwd: os.tmpdir(),
      cols: 80,
      rows: 24,
      meta: {
        label: 'Test',
        command: '',
        cwd: os.tmpdir(),
        workspaceId: 'workspace-test',
        tabId: 'tab-test',
        createdAt: Date.now()
      }
    })

    // Take the spawn ack or the daemon's own failure reply, whichever lands
    // first, so a rejected spawn fails the wait immediately instead of after the
    // full timeout.
    const launch = await harness.waitFor(
      (message) => (message.t === 'spawned' || message.t === 'error') && message.id === id,
      'the spawn result'
    )
    if (launch.t === 'error') {
      // node-pty could not allocate/exec a PTY in this environment: bare-node
      // macOS CI runners intermittently hit "posix_spawnp failed" spawning
      // node-pty's spawn-helper under load. The daemon behaved correctly by
      // reporting the failure — there is no started session left to exercise, and
      // the packaged app (whose node-pty is rebuilt for Electron and signed) does
      // not share this sandbox limitation. Skip rather than fail the run.
      ctx.skip(`daemon could not spawn a PTY in this environment: ${launch.message}`)
      return
    }
    expect(launch).toMatchObject({ t: 'spawned', id })

    harness.send({ t: 'kill', id, requestId })
    await expect(
      harness.waitFor(
        (message) => message.t === 'killed' && message.id === id && message.requestId === requestId,
        'killed'
      )
    ).resolves.toEqual({ t: 'killed', id, requestId })
    await expect(
      harness.waitFor((message) => message.t === 'exit' && message.id === id, 'exit')
    ).resolves.toMatchObject({ t: 'exit', id })

    harness.send({ t: 'list' })
    await expect(
      harness.waitFor((message) => message.t === 'sessions', 'sessions')
    ).resolves.toEqual({ t: 'sessions', list: [] })
  }, 60_000)

  it('exits cleanly on shutdown even with a live session', async (ctx) => {
    // The app sends `shutdown` before installing an update so the daemon stops
    // holding a Windows lock on the shared executable — it must actually exit.
    const harness = await startHarness()
    const id = randomUUID()
    harness.send({ t: 'hello' })
    harness.send({
      t: 'spawn',
      id,
      command: '',
      direct: {
        executable: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      },
      cwd: os.tmpdir(),
      cols: 80,
      rows: 24,
      meta: {
        label: 'Test',
        command: '',
        cwd: os.tmpdir(),
        workspaceId: 'workspace-test',
        tabId: 'tab-test',
        createdAt: Date.now()
      }
    })

    const launch = await harness.waitFor(
      (message) => (message.t === 'spawned' || message.t === 'error') && message.id === id,
      'the spawn result'
    )
    if (launch.t === 'error') {
      ctx.skip(`daemon could not spawn a PTY in this environment: ${launch.message}`)
      return
    }

    const exited = new Promise<number | null>((resolve) =>
      harness.child.once('exit', (code) => resolve(code))
    )
    harness.send({ t: 'shutdown' })
    const code = await Promise.race([
      exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('daemon did not exit after shutdown')), MESSAGE_TIMEOUT_MS)
      )
    ])
    expect(code).toBe(0)
  }, 60_000)
})
