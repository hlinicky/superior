import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../components/ui'
import { useI18n } from '../i18n'
import { taskExitOutcome } from '../taskExit'
import { ipcErrorMessage } from '../ipcError'
import { newQueuedTask, retriedQueuedTask } from '../taskQueueShape'
import type {
  AgentSession,
  AgentTask,
  StartAgentResult,
  TerminalPreset,
  Workspace,
  WorkspaceState
} from '../types'

interface Deps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  sessionsRestored: boolean
  sessions: AgentSession[]
  presets: TerminalPreset[]
  /** Adopt a WorkspaceState returned by main (worktree creation). */
  applyState: (state: WorkspaceState) => void
  /** Start a preset command in a workspace without stealing focus. */
  launchSessionIn: (args: {
    preset: TerminalPreset
    workspaceId: string
    cwd: string
    command?: string
    nickname?: string
  }) => Promise<StartAgentResult>
}

export interface TaskQueueApi {
  tasks: AgentTask[]
  paused: boolean
  addTask: (args: {
    folderPath: string
    prompt: string
    presetId: string
    useWorktree: boolean
  }) => Promise<void>
  /** Delete a queued/finished task (running tasks must be canceled instead). */
  deleteTask: (id: string) => Promise<void>
  /** Kill a running task's terminal and mark it canceled. */
  cancelTask: (id: string) => Promise<void>
  /** Re-enqueue a copy of a failed/canceled task. */
  retryTask: (id: string) => Promise<void>
  /** Move a queued task up/down within its folder's queue. */
  moveTask: (id: string, direction: -1 | 1) => Promise<void>
  clearFinished: (folderPath: string) => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
}

/** Quote a prompt as a single shell argument for the daemon's launch shell
 *  (`$SHELL -l -c …` on POSIX, `cmd.exe /c …` on Windows). */
function quoteArg(text: string, platform = window.api.platform): string {
  if (platform === 'win32') {
    // cmd.exe: double quotes; literal " doubled, trailing \ would eat the close quote.
    return `"${text.replace(/"/g, '""').replace(/\\$/, '\\\\')}"`
  }
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function hasFlag(command: string, flag: string): boolean {
  return new RegExp(`(?:^|\\s)${flag}(?:\\s|$)`).test(command)
}

/**
 * Build a command that represents exactly one queue item. Claude and Codex
 * normally remain interactive after handling a prompt, so Tasks uses their
 * one-shot modes and then advances when the process exits.
 */
export function buildTaskCommand(
  command: string,
  prompt: string,
  platform = window.api.platform
): string {
  const trimmed = command.trim()
  const quotedPrompt = quoteArg(prompt, platform)

  if (/^codex(?:\s|$)/.test(trimmed) && !/^codex\s+exec(?:\s|$)/.test(trimmed)) {
    return `codex exec${trimmed.slice('codex'.length)} ${quotedPrompt}`.trim()
  }

  if (/^claude(?:\s|$)/.test(trimmed) && !hasFlag(trimmed, '-p') && !hasFlag(trimmed, '--print')) {
    return `${trimmed} --print ${quotedPrompt}`.trim()
  }

  return `${trimmed} ${quotedPrompt}`.trim()
}

/** Filesystem/ref-safe branch slug from a prompt's first words. */
function promptSlug(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return slug || 'task'
}

/** Short human label for sidebar/nickname use. */
function promptExcerpt(prompt: string): string {
  const line = prompt.trim().split('\n')[0]
  return line.length > 32 ? `${line.slice(0, 32)}…` : line
}

/**
 * The task-queue engine. Tasks persist in main (tasks.json); this hook mirrors
 * that state and drives execution: per folder it runs one task at a time,
 * spawning `<preset command> '<prompt>'` in the target workspace (optionally a
 * freshly created worktree workspace) and starting the next queued task when
 * the previous task's terminal exits. Lives in the renderer because tabs and
 * session state are owned here.
 */
export function useTaskQueue(deps: Deps): TaskQueueApi {
  const toast = useToast()
  const { t } = useI18n()
  // Toasts fire from long-lived callbacks whose deps deliberately exclude `t`;
  // read it through a ref so a language switch is reflected at fire time.
  const tRef = useRef(t)
  tRef.current = t
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [paused, setPausedState] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Set once stale 'running' tasks from a previous run were reconciled against
  // surviving daemon sessions; the engine only starts tasks after this.
  const [ready, setReady] = useState(false)

  // The engine's async callbacks always read current state through refs, so
  // exit events arriving between renders never act on stale tasks/deps.
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const depsRef = useRef(deps)
  depsRef.current = deps
  // Tasks currently mid-start (worktree creation + spawn are async).
  const startingRef = useRef(new Set<string>())
  // Tasks whose 'running' save is still in flight, keyed by session id: a bad
  // command can exit within the saveTask round-trip, and that exit must still
  // find its task or it stays 'running' forever, blocking its folder's queue.
  const inFlightRef = useRef(new Map<string, AgentTask>())

  const adopt = useCallback((state: { tasks: AgentTask[]; paused: boolean }) => {
    // Sync the ref before the state lands: exit events fire between renders
    // and must see the freshly saved tasks, not the previous render's.
    tasksRef.current = state.tasks
    setTasks(state.tasks)
    setPausedState(state.paused)
  }, [])

  const persistTask = useCallback(
    async (task: AgentTask) => {
      adopt(await window.api.saveTask(task))
    },
    [adopt]
  )

  useEffect(() => {
    let active = true
    let retryTimer: number | undefined
    let attempts = 0
    let notified = false
    const load = (): void => {
      window.api.listTasks()
        .then((state) => {
          if (!active) return
          adopt(state)
          setLoaded(true)
        })
        .catch((err) => {
          if (!active) return
          if (!notified) {
            notified = true
            toast.error(ipcErrorMessage(err))
          }
          attempts += 1
          retryTimer = window.setTimeout(load, Math.min(250 * 2 ** attempts, 5_000))
        })
    }
    load()
    return () => {
      active = false
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [adopt, toast])

  // Reconcile tasks stored as 'running' by a previous app run: a task whose
  // session survived in the daemon keeps running (its exit is caught below);
  // one whose session is gone finished unobserved — close it with an unknown
  // exit code rather than blocking its folder's queue forever.
  const reconciledRef = useRef(false)
  useEffect(() => {
    if (!loaded || !deps.sessionsRestored || reconciledRef.current) return
    reconciledRef.current = true
    ;(async () => {
      for (const task of tasksRef.current) {
        if (task.status !== 'running') continue
        const session = depsRef.current.sessions.find((s) => s.id === task.sessionId)
        if (session && session.status === 'running') continue
        const exitCode = session?.exitCode ?? null
        const outcome = taskExitOutcome(exitCode)
        await persistTask({
          ...task,
          ...outcome,
          exitCode,
          finishedAt: Date.now()
        })
      }
    })()
      .catch((err) => console.error('[tasks] reconcile failed:', err))
      // Even a failed reconcile must not stall the queue forever.
      .finally(() => setReady(true))
  }, [loaded, deps.sessionsRestored, persistTask])

  // Close a task out with its exit code — shared by the exit listener and the
  // already-exited path in startTask.
  const finishTask = useCallback(
    (task: AgentTask, exitCode: number | null) => {
      const outcome = taskExitOutcome(exitCode)
      const failed = outcome.status === 'failed'
      if (failed) toast.error(tRef.current('tasks.failedToast', { prompt: promptExcerpt(task.prompt) }))
      return persistTask({
        ...task,
        ...outcome,
        exitCode,
        finishedAt: Date.now()
      })
    },
    [persistTask, toast]
  )

  // Terminal exits drive queue progress: finish the matching running task.
  // Failures surface as a toast too — the Tasks panel may not be open.
  useEffect(() => {
    return window.api.onAgentExit(({ id, exitCode }) => {
      const task =
        tasksRef.current.find((tk) => tk.sessionId === id && tk.status === 'running') ??
        inFlightRef.current.get(id)
      if (!task) return
      void finishTask(task, exitCode)
    })
  }, [finishTask])

  const failTask = useCallback(
    (task: AgentTask, error: string) => {
      toast.error(tRef.current('tasks.failedToast', { prompt: promptExcerpt(task.prompt) }))
      return persistTask({ ...task, status: 'failed', error, finishedAt: Date.now() })
    },
    [persistTask, toast]
  )

  const startTask = useCallback(
    async (task: AgentTask) => {
      const d = depsRef.current
      const preset = d.presets.find((p) => p.id === task.presetId)
      if (!preset) {
        await failTask(task, 'preset-missing')
        return
      }

      let workspaceId: string
      let cwd: string
      let branch: string | undefined

      const retained = task.workspaceId ? d.workspaces.find(w => w.id === task.workspaceId) : undefined
      if (task.useWorktree && retained?.worktreePath) {
        workspaceId = retained.id
        cwd = retained.worktreePath
        branch = retained.branch
        const setup = await window.api.getWorktreeSetup(workspaceId)
        if (setup.state?.status === 'failed') await window.api.retryWorktreeSetup(workspaceId)
      } else if (task.useWorktree) {
        branch = `task/${promptSlug(task.prompt)}-${task.id.slice(0, 4)}`
        const res = await window.api.addWorktreeWorkspace({
          folderPath: task.folderPath,
          name: promptExcerpt(task.prompt),
          branch,
          createBranch: true
        })
        if ('error' in res) {
          await failTask(task, res.error)
          return
        }
        const created = res.workspaces.find(
          (w) => w.folderPath === task.folderPath && w.branch === branch
        )
        if (!created?.worktreePath) {
          await failTask(task, 'worktree-missing')
          return
        }
        // Creating a worktree workspace activates it in main; queued tasks run
        // in the background, so put the user's selection back before adopting.
        const prevActive = d.activeWorkspaceId
        const state =
          prevActive && prevActive !== res.activeWorkspaceId
            ? await window.api.setActiveWorkspace(prevActive)
            : res
        d.applyState(state)
        workspaceId = created.id
        cwd = created.worktreePath
      } else {
        // Run in the folder's current context: the active workspace when it
        // belongs to this folder, else the folder's first workspace.
        const ws =
          d.workspaces.find(
            (w) => w.id === d.activeWorkspaceId && w.folderPath === task.folderPath
          ) ?? d.workspaces.find((w) => w.folderPath === task.folderPath)
        if (!ws) {
          await failTask(task, 'no-workspace')
          return
        }
        workspaceId = ws.id
        cwd = ws.worktreePath ?? task.folderPath
      }

      // Mark running before the spawn resolves so the engine can't double-start.
      const running: AgentTask = {
        ...task,
        status: 'running',
        workspaceId,
        branch,
        startedAt: Date.now()
      }
      await persistTask(running)
      // Preparation has its own wait so cancel/reload cannot leave a deferred
      // agent launch in main. A failed setup retains this task's checkout.
      try {
        await window.api.waitWorktreeSetup(workspaceId)
      } catch (err) {
        if (tasksRef.current.find(t => t.id === task.id)?.status === 'running') {
          await failTask(running, `setup-failed: ${ipcErrorMessage(err)}`)
        }
        return
      }
      if (tasksRef.current.find(t => t.id === task.id)?.status !== 'running') return
      const command = buildTaskCommand(preset.command, task.prompt)
      const res = await depsRef.current.launchSessionIn({
        preset,
        workspaceId,
        cwd,
        command,
        nickname: promptExcerpt(task.prompt)
      })
      if (tasksRef.current.find(t => t.id === task.id)?.status !== 'running') {
        if (!('error' in res)) await window.api.killAgent(res.session.id)
        return
      }
      if ('error' in res) {
        await failTask(running, res.error)
        return
      }
      const started: AgentTask = { ...running, sessionId: res.session.id }
      if (res.session.status !== 'running') {
        // Died before the spawn reply landed: the exit event fired before this
        // task knew its session id, so no listener will ever finish it. Main
        // reports the final state on the session — close the task from that.
        await finishTask(started, res.session.exitCode ?? null)
        return
      }
      inFlightRef.current.set(res.session.id, started)
      try {
        await persistTask(started)
      } finally {
        inFlightRef.current.delete(res.session.id)
      }
    },
    [failTask, finishTask, persistTask]
  )

  // The pump: whenever the queue can make progress, start the oldest queued
  // task of every folder that has nothing running (one at a time per folder).
  useEffect(() => {
    if (!ready || paused) return
    const busyFolders = new Set(
      tasks.filter((t) => t.status === 'running').map((t) => t.folderPath)
    )
    for (const id of startingRef.current) {
      const t = tasks.find((x) => x.id === id)
      if (t) busyFolders.add(t.folderPath)
    }
    const next = new Map<string, AgentTask>()
    for (const t of tasks) {
      if (t.status !== 'queued' || busyFolders.has(t.folderPath)) continue
      const cur = next.get(t.folderPath)
      if (!cur || t.createdAt < cur.createdAt) next.set(t.folderPath, t)
    }
    for (const task of next.values()) {
      startingRef.current.add(task.id)
      void startTask(task).catch(async (err) => {
        const current = tasksRef.current.find(t => t.id === task.id)
        if (current && current.status !== 'canceled') await failTask(current, ipcErrorMessage(err))
      }).finally(() => startingRef.current.delete(task.id))
    }
  }, [tasks, paused, ready, startTask, failTask])

  const addTask = useCallback(
    async (args: {
      folderPath: string
      prompt: string
      presetId: string
      useWorktree: boolean
    }) => {
      await persistTask(
        newQueuedTask({
          id: crypto.randomUUID(),
          folderPath: args.folderPath,
          prompt: args.prompt,
          presetId: args.presetId,
          useWorktree: args.useWorktree,
          createdAt: Date.now()
        })
      )
    },
    [persistTask]
  )

  const deleteTask = useCallback(
    async (id: string) => {
      adopt(await window.api.deleteTask(id))
    },
    [adopt]
  )

  const cancelTask = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id)
      if (!task || task.status !== 'running') return
      // Mark canceled first so the exit event of the kill is ignored.
      await persistTask({ ...task, status: 'canceled', finishedAt: Date.now() })
      if (task.sessionId) await window.api.killAgent(task.sessionId)
      else if (task.workspaceId) await window.api.cancelWorktreeSetup(task.workspaceId)
    },
    [persistTask]
  )

  const retryTask = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((tk) => tk.id === id)
      if (!task || (task.status !== 'failed' && task.status !== 'canceled')) return
      await persistTask(retriedQueuedTask(task, crypto.randomUUID(), Date.now()))
    },
    [persistTask]
  )

  // Queue order is createdAt — swapping the timestamps of two adjacent queued
  // tasks reorders them without a schema change.
  const moveTask = useCallback(
    async (id: string, direction: -1 | 1) => {
      const all = tasksRef.current
      const task = all.find((tk) => tk.id === id)
      if (!task || task.status !== 'queued') return
      const queue = all
        .filter((tk) => tk.folderPath === task.folderPath && tk.status === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt)
      const idx = queue.findIndex((tk) => tk.id === id)
      const other = queue[idx + direction]
      if (!other) return
      await window.api.saveTask({ ...task, createdAt: other.createdAt })
      adopt(await window.api.saveTask({ ...other, createdAt: task.createdAt }))
    },
    [adopt]
  )

  const clearFinished = useCallback(
    async (folderPath: string) => {
      adopt(await window.api.clearFinishedTasks(folderPath))
    },
    [adopt]
  )

  const setPaused = useCallback(
    async (value: boolean) => {
      adopt(await window.api.setTasksPaused(value))
    },
    [adopt]
  )

  return {
    tasks,
    paused,
    addTask,
    deleteTask,
    cancelTask,
    retryTask,
    moveTask,
    clearFinished,
    setPaused
  }
}
