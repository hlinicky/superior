import { ipcErrorMessage } from '../ipcError'
import { useMemo, useState } from 'react'
import { useI18n, type TFunction } from '../i18n'
import { PresetIcon } from './PresetIcon'
import { Button, IconButton, Select } from './ui'
import type { TaskQueueApi } from '../hooks/useTaskQueue'
import { WORKTREE_ERROR, type AgentTask, type TerminalPreset } from '../types'

interface Props {
  /** The active project folder tasks are queued for (main repo path). */
  folderPath: string | null
  queue: TaskQueueApi
  presets: TerminalPreset[]
  /** Jump to the workspace a task ran/runs in. */
  onJumpTo: (task: AgentTask) => void
}

/** Map an engine failure (stable code, WORKTREE_ERROR, or raw text) to a message. */
function errorMessage(t: TFunction, raw: string): string {
  if (raw.startsWith('setup-failed:')) return ipcErrorMessage(raw.slice('setup-failed:'.length).trim())
  switch (raw) {
    case 'preset-missing':
      return t('tasks.errPresetGone')
    case 'no-workspace':
      return t('tasks.errNoWorkspace')
    case 'worktree-missing':
      return t('tasks.errWorktreeMissing')
    case WORKTREE_ERROR.NOT_A_REPO:
    case WORKTREE_ERROR.INVALID_FOLDER:
      return t('error.notARepo')
    case WORKTREE_ERROR.BRANCH_EXISTS:
      return t('error.branchExists')
    case WORKTREE_ERROR.BRANCH_CHECKED_OUT:
      return t('error.branchCheckedOut')
    default:
      return raw
  }
}

function CrossMark(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function StopMark(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

function JumpMark(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  )
}

function RetryMark(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3v5h-5" />
    </svg>
  )
}

function ArrowMark({ up }: { up: boolean }): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {up ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  )
}

function BranchMark(): React.JSX.Element {
  return (
    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 3-3 4-6 4" />
    </svg>
  )
}

/** The per-status dot shown at the start of every task row. */
function StatusDot({ status }: { status: AgentTask['status'] }): React.JSX.Element {
  const cls =
    status === 'running'
      ? 'bg-accent animate-pulse'
      : status === 'queued'
        ? 'bg-fgmuted'
        : status === 'done'
          ? 'bg-status'
          : 'bg-danger'
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} />
}

/** Section header row matching the Changes view's group style. */
function GroupHead({ label, count }: { label: string; count: number }): React.JSX.Element {
  return (
    <div className="bg-bar px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fgmuted">
      {label} ({count})
    </div>
  )
}

/**
 * The "Tasks" tab of the right panel: the active folder's agent-task queue.
 * Queue one prompt per task; tasks run one at a time — the next starts when
 * the previous task's terminal exits (for interactive CLIs, when you quit
 * them; presets like `claude -p` run headless and advance on their own).
 */
export function TasksView({ folderPath, queue, presets, onJumpTo }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [prompt, setPrompt] = useState('')
  const activePresets = useMemo(() => presets.filter((p) => p.active), [presets])
  const [presetId, setPresetId] = useState('')
  const [useWorktree, setUseWorktree] = useState(false)
  const [adding, setAdding] = useState(false)

  const folderTasks = useMemo(
    () => queue.tasks.filter((task) => task.folderPath === folderPath),
    [queue.tasks, folderPath]
  )
  const running = folderTasks.filter((task) => task.status === 'running')
  const queued = folderTasks
    .filter((task) => task.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
  const finished = folderTasks
    .filter((task) => task.status !== 'queued' && task.status !== 'running')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))

  if (!folderPath) {
    return <div className="px-3 py-4 text-xs text-fgmuted">{t('tasks.noFolder')}</div>
  }

  const effectivePresetId = presetId || activePresets[0]?.id || ''
  const canAdd = prompt.trim().length > 0 && !!effectivePresetId && !adding

  const doAdd = async (): Promise<void> => {
    if (!canAdd) return
    setAdding(true)
    await queue.addTask({
      folderPath,
      prompt,
      presetId: effectivePresetId,
      useWorktree
    })
    setAdding(false)
    setPrompt('')
  }

  const presetOf = (task: AgentTask): TerminalPreset | undefined =>
    presets.find((p) => p.id === task.presetId)

  const statusLabel = (task: AgentTask): string => {
    switch (task.status) {
      case 'running':
        return t('tasks.statusRunning')
      case 'queued':
        return t('tasks.statusQueued')
      case 'done':
        return t('tasks.statusDone')
      case 'canceled':
        return t('tasks.statusCanceled')
      case 'failed':
        return task.exitCode != null && task.exitCode !== 0
          ? `${t('tasks.statusFailed')} · ${t('tasks.exitCode', { code: task.exitCode })}`
          : t('tasks.statusFailed')
    }
  }

  const row = (task: AgentTask, queueIndex?: number, queueLength?: number): React.JSX.Element => {
    const preset = presetOf(task)
    return (
      <div key={task.id} className="group flex items-start gap-2 border-b border-edge/50 px-2 py-2">
        <StatusDot status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="wrap-break-word text-xs text-fg" title={task.prompt}>
            {task.prompt.length > 160 ? `${task.prompt.slice(0, 160)}…` : task.prompt}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-fgmuted">
            <span className="inline-flex items-center gap-1">
              <PresetIcon iconType={preset?.iconType} icon={preset?.icon} className="h-3 w-3 text-[10px]" />
              {preset?.name ?? task.presetId}
            </span>
            {(task.branch || task.useWorktree) && (
              <span className="inline-flex items-center gap-1 font-mono" title={t('tasks.worktree')}>
                <BranchMark />
                {task.branch ?? t('tasks.worktree')}
              </span>
            )}
            {task.backlogTaskId && (
              <span className="font-mono" title={t('tasks.backlogLinked')}>
                {task.backlogTaskId}
              </span>
            )}
            <span className={task.status === 'failed' ? 'text-danger' : ''}>
              {statusLabel(task)}
            </span>
          </div>
          {task.status === 'failed' && task.error && (
            <div className="mt-0.5 wrap-break-word text-[10px] text-danger" title={errorMessage(t, task.error)}>
              {errorMessage(t, task.error)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          {task.status === 'queued' && queueIndex !== undefined && queueLength !== undefined && (
            <>
              <IconButton
                size="sm"
                label={t('tasks.moveUp')}
                disabled={queueIndex === 0}
                onClick={() => void queue.moveTask(task.id, -1)}
              >
                <ArrowMark up />
              </IconButton>
              <IconButton
                size="sm"
                label={t('tasks.moveDown')}
                disabled={queueIndex === queueLength - 1}
                onClick={() => void queue.moveTask(task.id, 1)}
              >
                <ArrowMark up={false} />
              </IconButton>
            </>
          )}
          {(task.status === 'failed' || task.status === 'canceled') && (
            <IconButton size="sm" label={t('tasks.retry')} onClick={() => void queue.retryTask(task.id)}>
              <RetryMark />
            </IconButton>
          )}
          {task.workspaceId && task.status !== 'queued' && (
            <IconButton size="sm" label={t('tasks.goTo')} onClick={() => onJumpTo(task)}>
              <JumpMark />
            </IconButton>
          )}
          {task.status === 'running' ? (
            <IconButton size="sm" label={t('tasks.cancel')} onClick={() => void queue.cancelTask(task.id)}>
              <StopMark />
            </IconButton>
          ) : (
            <IconButton size="sm" label={t('tasks.delete')} onClick={() => void queue.deleteTask(task.id)}>
              <CrossMark />
            </IconButton>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: pause/resume the whole queue + clear this folder's finished tasks. */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-xs">
        <span className="min-w-0 truncate font-medium text-fgdim">
          {queue.paused ? t('tasks.paused') : t('tasks.title')}
        </span>
        <span className="ml-auto shrink-0" />
        {finished.length > 0 && (
          <button
            onClick={() => void queue.clearFinished(folderPath)}
            className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-fgdim transition hover:bg-hover hover:text-fg"
          >
            {t('tasks.clearFinished')}
          </button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-6! shrink-0 px-1.5! text-[11px]!"
          onClick={() => void queue.setPaused(!queue.paused)}
        >
          {queue.paused ? t('tasks.resume') : t('tasks.pause')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {folderTasks.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-fgmuted">{t('tasks.empty')}</div>
        ) : (
          <>
            {running.length > 0 && (
              <>
                <GroupHead label={t('tasks.statusRunning')} count={running.length} />
                {running.map((task) => row(task))}
              </>
            )}
            {queued.length > 0 && (
              <>
                <GroupHead label={t('tasks.statusQueued')} count={queued.length} />
                {queued.map((task, i) => row(task, i, queued.length))}
              </>
            )}
            {finished.length > 0 && (
              <>
                <GroupHead label={t('tasks.finishedGroup')} count={finished.length} />
                {finished.map((task) => row(task))}
              </>
            )}
          </>
        )}
      </div>

      {/* Enqueue box — prompt + preset + optional fresh worktree workspace. */}
      <div className="shrink-0 space-y-1.5 border-t border-edge p-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void doAdd()
          }}
          rows={2}
          placeholder={t('tasks.promptPlaceholder')}
          className="w-full resize-none rounded-md border border-edge bg-bar px-2 py-1.5 text-xs text-fg placeholder:text-fgmuted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
        />
        <div className="flex items-center gap-2">
          <Select
            value={effectivePresetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="h-7! flex-1 text-xs!"
          >
            {activePresets.length === 0 && <option value="">{t('launcher.noPresets')}</option>}
            {activePresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <label
            className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-fgdim"
            title={t('tasks.worktreeHint')}
          >
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
              className="h-3.5 w-3.5 accent-(--c-accent-solid)"
            />
            {t('tasks.worktree')}
          </label>
        </div>
        <Button size="sm" className="w-full" disabled={!canAdd} onClick={() => void doAdd()}>
          {t('tasks.add')}
        </Button>
        <p className="px-0.5 text-[10px] leading-snug text-fgmuted">{t('tasks.hint')}</p>
      </div>
    </div>
  )
}
