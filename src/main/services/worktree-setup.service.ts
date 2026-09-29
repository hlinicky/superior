import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { stripVTControlCharacters } from 'util'
import type { Workspace } from '@shared/types'
import { validateSetupConfig, type WorktreeSetupConfig, type WorktreeSetupState } from '@shared/worktree-setup'
import { userDataFile, writeJsonFile } from '../lib/jsonStore'

const OUTPUT_LIMIT = 64_000
const COMMAND_TIMEOUT = 15 * 60_000
const active = new Map<string, { state: WorktreeSetupState; promise: Promise<void>; cancel: () => void }>()
const persistenceFailures = new Map<string, WorktreeSetupState>()
const emptyConfig = (): WorktreeSetupConfig => ({ commands: [], copyFiles: [] })

function storePath(kind: string, key: string): string {
  const dir = userDataFile('worktree-setup')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${kind}-${createHash('sha256').update(key).digest('hex')}.json`)
}

export function getSetupConfig(folder: string): WorktreeSetupConfig {
  const file = storePath('project', folder)
  if (!fs.existsSync(file)) return emptyConfig()
  return validateSetupConfig(JSON.parse(fs.readFileSync(file, 'utf8')))
}

export function saveSetupConfig(folder: string, config: unknown): void {
  writeJsonFile(storePath('project', folder), validateSetupConfig(config), 'worktree setup configuration')
}

function persist(ws: Workspace, state: WorktreeSetupState): void {
  writeJsonFile(storePath('workspace', ws.id), state, 'worktree setup')
}

export function getSetupState(ws: Workspace): WorktreeSetupState | null {
  if (!ws.worktreePath) return null
  const failed = persistenceFailures.get(ws.id)
  if (failed) return { ...failed }
  const live = active.get(ws.id)
  if (live) return { ...live.state }
  const file = storePath('workspace', ws.id)
  // Worktrees created before setup support remain usable until explicitly prepared.
  if (!fs.existsSync(file)) return null
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as WorktreeSetupState
  if (!state || !['pending', 'running', 'ready', 'failed'].includes(state.status) ||
      typeof state.output !== 'string' || typeof state.step !== 'string') {
    throw new Error('Invalid saved worktree setup state.')
  }
  if (state.status === 'running' || state.status === 'pending') {
    return { ...state, status: 'failed', error: 'Setup was interrupted. Review the output and retry.', finishedAt: Date.now() }
  }
  return state
}

/** Called before publishing a newly created workspace. */
export function initializeSetup(ws: Workspace): void {
  persist(ws, { status: 'pending', step: '', output: '' })
}

/** Reject symlinks on both sides, including intermediate directories. Never copy Git metadata. */
export function copySetupFile(sourceRoot: string, targetRoot: string, relative: string): void {
  validateSetupConfig({ commands: [], copyFiles: [relative] })
  function safePath(root: string, createParents: boolean): string {
    let current = fs.realpathSync(root)
    const parts = relative.split('/')
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i])
      if (!fs.existsSync(current) && createParents && i < parts.length - 1) fs.mkdirSync(current)
      try {
        const stat = fs.lstatSync(current)
        if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${relative}`)
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Not a directory: ${relative}`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        if (!createParents || i < parts.length - 1) throw err
      }
    }
    return current
  }
  const source = safePath(sourceRoot, false)
  const target = safePath(targetRoot, true)
  if (!fs.statSync(source).isFile()) throw new Error(`Copy expects a file: ${relative}`)
  // Existing files belong to the checkout/user. Retries must not overwrite them.
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
    fs.chmodSync(target, fs.statSync(source).mode & 0o777)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
}

function terminate(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', () => child.kill())
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL')
    }
  }
}

/** Single flight per workspace: all launchers wait for the same preparation. */
export function runSetup(ws: Workspace): Promise<void> {
  const existing = active.get(ws.id)
  if (existing) return existing.promise
  if (!ws.worktreePath) return Promise.resolve()
  const cwd = ws.worktreePath
  let child: ChildProcess | undefined
  let canceled = false
  const state: WorktreeSetupState = { status: 'running', step: '', output: '', startedAt: Date.now() }
  const append = (text: string): void => { state.output = (state.output + stripVTControlCharacters(text)).slice(-OUTPUT_LIMIT) }
  const job = {
    state,
    promise: Promise.resolve(),
    cancel: () => { canceled = true; if (child) terminate(child) }
  }
  persistenceFailures.delete(ws.id)
  active.set(ws.id, job)
  // Defer so the single-flight entry is installed even for a no-command setup.
  job.promise = Promise.resolve().then(async () => {
    let writeFailure: Error | undefined
    const flush = setInterval(() => {
      try { persist(ws, state) } catch (err) {
        writeFailure = err as Error
        job.cancel()
      }
    }, 1000)
    try {
      persist(ws, state)
      const config = getSetupConfig(ws.folderPath)
      for (const file of config.copyFiles) {
        if (canceled) throw new Error('Setup canceled.')
        state.step = `Copy ${file}`
        append(`\n${state.step}\n`)
        copySetupFile(ws.folderPath, cwd, file)
      }
      for (const [index, command] of config.commands.entries()) {
        if (canceled) throw new Error('Setup canceled.')
        state.step = `${index + 1}/${config.commands.length}: ${command}`
        append(`\n$ ${command}\n`)
        persist(ws, state)
        await new Promise<void>((resolve, reject) => {
          const windows = process.platform === 'win32'
          // cmd.exe does not understand Node's \" argument escaping; quote verbatim like `shell: true` does.
          child = spawn(windows ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash'),
            windows ? ['/d', '/s', '/c', `"${command}"`] : ['-l', '-c', command], {
              cwd, detached: !windows, windowsHide: true, windowsVerbatimArguments: windows, stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env, SUPERIOR_PROJECT_ROOT: ws.folderPath, SUPERIOR_WORKTREE_PATH: cwd }
            })
          let timedOut = false
          const timer = setTimeout(() => { timedOut = true; if (child) terminate(child) }, COMMAND_TIMEOUT)
          child.stdout?.setEncoding('utf8').on('data', append)
          child.stderr?.setEncoding('utf8').on('data', append)
          child.once('error', (err) => { clearTimeout(timer); reject(err) })
          child.once('close', (code) => {
            clearTimeout(timer)
            child = undefined
            if (canceled) reject(new Error('Setup canceled.'))
            else if (timedOut) reject(new Error('Setup command exceeded 15 minutes.'))
            else if (code !== 0) reject(new Error(`Setup command exited with code ${code ?? 'unknown'}.`))
            else resolve()
          })
        })
      }
      if (canceled) throw new Error('Setup canceled.')
      state.status = 'ready'
      state.step = ''
      append('\nWorktree ready.\n')
    } catch (err) {
      state.status = 'failed'
      state.error = (writeFailure ?? err as Error).message
      append(`\n${state.error}\n`)
    } finally {
      clearInterval(flush)
      state.finishedAt = Date.now()
      try {
        persist(ws, state)
      } catch (err) {
        state.status = 'failed'
        state.error = (err as Error).message
        persistenceFailures.set(ws.id, { ...state })
        throw err
      } finally { active.delete(ws.id) }
    }
  })
  return job.promise
}

export async function ensureSetupReady(ws: Workspace): Promise<void> {
  if (!ws.worktreePath) return
  const running = active.get(ws.id)
  if (running) await running.promise
  const state = getSetupState(ws)
  if (state && state.status !== 'ready') {
    throw new Error(`Worktree setup is not ready. ${state.error ?? 'Run setup first.'}`)
  }
}

export async function cancelSetup(id: string): Promise<void> {
  const job = active.get(id)
  if (!job) return
  job.cancel()
  await job.promise
}

export async function stopAllSetups(): Promise<void> {
  await Promise.all([...active.keys()].map(cancelSetup))
}
