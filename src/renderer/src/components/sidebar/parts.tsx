import type { TFunction } from '../../i18n'
import type { UpdateController } from '../../hooks/useUpdateCheck'
import type { WorkspaceGitStat } from '../../hooks/useWorkspaceGitStats'
import { FolderIcon } from '../ui'
import type { Folder } from '../../types'

export function initial(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase()
}

/** Tooltip/label for the update button, reflecting the current download phase. */
export function updateTitle(update: UpdateController, t: TFunction): string {
  switch (update.progress.phase) {
    case 'downloading':
      return t('update.downloading', { percent: String(update.progress.percent ?? 0) })
    case 'downloaded':
      return t('update.restart')
    case 'error':
      return t('update.failed')
    default:
      return t('update.available', { version: update.info?.latestVersion ?? '' })
  }
}

/** Display label for a folder — its user-chosen name, falling back to the basename. */
export function folderLabel(folder: Folder): string {
  return folder.displayName?.trim() || folder.name
}

export function folderTitle(folder: Folder): string {
  return folder.kind === 'remote' && folder.remote
    ? `${folder.remote.host}:${folder.remote.path}`
    : folder.path
}

/** A folder's custom icon when set, else the default folder glyph. `size` is px. */
export function FolderGlyph({ folder, size = 14 }: { folder: Folder; size?: number }): React.JSX.Element {
  if (folder.icon) {
    return (
      <img
        src={folder.icon}
        alt=""
        aria-hidden
        className="shrink-0 rounded-xs object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  if (folder.kind === 'remote') return <RemoteGlyph size={size} />
  return <FolderIcon className="shrink-0" />
}

function RemoteGlyph({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <rect x="4" y="3" width="16" height="6" rx="1.5" />
      <rect x="4" y="15" width="16" height="6" rx="1.5" />
      <path d="M8 9v6M16 9v6M8 6h.01M8 18h.01" />
    </svg>
  )
}

export function RunningBadge({ count, title }: { count: number; title: string }): React.JSX.Element {
  return (
    <span
      title={title}
      aria-label={`${title}: ${count}`}
      className="flex h-5 shrink-0 items-center justify-center gap-1 rounded px-1 text-[11px] font-medium leading-none tabular-nums text-fgdim"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="m7 9 3 3-3 3m6 0h4" />
      </svg>
      {count}
    </span>
  )
}

/**
 * Compact +added / −removed line counts from git, shown beside a workspace
 * name. Renders nothing when the tree is clean so unchanged workspaces stay
 * uncluttered. Only the non-zero side(s) appear.
 */
export function DiffStat({
  stat,
  title
}: {
  stat: WorkspaceGitStat
  title: string
}): React.JSX.Element | null {
  if (!stat.isRepository || (stat.additions === 0 && stat.deletions === 0)) return null
  return (
    <span
      title={title}
      className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium leading-4 tabular-nums"
    >
      {stat.additions > 0 && <span className="text-status">+{stat.additions}</span>}
      {stat.deletions > 0 && <span className="text-danger">−{stat.deletions}</span>}
    </span>
  )
}

/** Download-style glyph for the "update available" affordance. */
export function UpdateGlyph({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? 'h-4 w-4'}`}
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

/** A small spinning ring shown while a workspace's terminals are working. */
export function WorkingSpinner({
  title,
  className
}: {
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`shrink-0 animate-spin text-status ${className ?? 'h-3.5 w-3.5'}`}
      aria-hidden
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function RemoteBadge({ title }: { title: string }): React.JSX.Element {
  return (
    <span
      title={title}
      className="flex min-w-0 items-center gap-1 text-[11px] leading-4 font-semibold uppercase tracking-wide text-accent"
    >
      SSH
    </span>
  )
}

export function WorkspaceGlyph(): React.JSX.Element {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 9v12" />
    </svg>
  )
}
