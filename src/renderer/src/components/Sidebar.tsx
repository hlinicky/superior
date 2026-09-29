import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '../i18n'
import { useAttentionColor } from '../attentionColor'
import {
  onWorkspaceActivity,
  primeWorkspaceActivity,
  useAgentWorkspaceStates,
  useAttentionWorkspaces,
  useBusyWorkspaces,
  useWorkspaceActivity
} from '../activityStore'
import { WORKSPACE_SORTS, mergeVisibleOrder, sortWorkspaces, type WorkspaceSort } from '../workspaceSort'
import { useWorkspaceDrag } from './sidebar/useWorkspaceDrag'
import {
  CheckIcon,
  ExternalLinkIcon,
  GearIcon,
  GripIcon,
  Menu,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
  StarIcon,
  TrashIcon,
  type MenuItem
} from './ui'
import { useShortcutTitle } from '../shortcuts'
import {
  DiffStat,
  FolderGlyph,
  RemoteBadge,
  RunningBadge,
  WorkingSpinner,
  folderLabel,
  folderTitle,
  initial
} from './sidebar/parts'
import { SidebarUpdate } from './sidebar/SidebarUpdate'
import { WorktreeSetup } from './WorktreeSetup'
import { WorkspaceCreateModal } from './sidebar/WorkspaceCreateModal'
import { FolderEditModal } from './sidebar/FolderEditModal'
import type { UpdateController } from '../hooks/useUpdateCheck'
import type { WorkspaceGitStat } from '../hooks/useWorkspaceGitStats'
import type { Folder, FolderUpdate, Workspace, WorktreeAddArgs } from '../types'

interface Props {
  folders: Folder[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  /** running-terminal count per workspace id */
  counts: Record<string, number>
  /** git +/- line totals per workspace id, for the diff badge next to each name */
  gitStats: Record<string, WorkspaceGitStat>
  /** update notification + in-app download/install controller */
  update: UpdateController
  collapsed: boolean
  /** Expand the rail (used when a collapsed-rail action needs the full sidebar). */
  onExpand: () => void
  /** Open the "open or clone a project" modal (local folder or git forge). */
  onOpenProject: () => void
  /** Open the settings view. Its button is pinned to the bottom of the rail. */
  onOpenSettings: () => void
  onRemoveFolder: (path: string) => void
  /** Persist a new folder order after a drag-to-reorder in the sidebar. */
  onReorderFolders: (orderedPaths: string[]) => void
  /** Update a folder's display name / custom icon (its path is immutable). */
  onUpdateFolder: (folderPath: string, patch: FolderUpdate) => void
  onAddWorkspace: (folderPath: string, name: string) => Promise<string | null>
  /** Create a worktree-backed workspace; resolves with a localized error or null. */
  onAddWorktreeWorkspace: (args: WorktreeAddArgs) => Promise<string | null>
  onRenameWorkspace: (id: string, name: string) => void
  onRemoveWorkspace: (id: string) => void
  onSelectWorkspace: (id: string) => void
}

/** Anchor for a shared kebab/context menu: an element (kebab) or a point (right-click). */
type MenuAnchor = HTMLElement | { x: number; y: number }

export const Sidebar = memo(function Sidebar({
  folders,
  workspaces,
  activeWorkspaceId,
  counts,
  gitStats,
  update,
  collapsed,
  onExpand,
  onOpenProject,
  onOpenSettings,
  onRemoveFolder,
  onReorderFolders,
  onUpdateFolder,
  onAddWorkspace,
  onAddWorktreeWorkspace,
  onRenameWorkspace,
  onRemoveWorkspace,
  onSelectWorkspace
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const shortcutTitle = useShortcutTitle()
  // Live activity signals, subscribed here (not in App) so per-chunk terminal
  // output only ever re-renders the sidebar — and only on real transitions.
  const busyWorkspaceIds = useBusyWorkspaces()
  const attentionWorkspaceIds = useAttentionWorkspaces()
  const { attentionColor } = useAttentionColor()
  // Editors: which workspace is being renamed and which folder is creating a workspace.
  const [setupWorkspaceId, setSetupWorkspaceId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // The one open folder menu (kebab or right-click — same items either way).
  const [folderMenu, setFolderMenu] = useState<{ path: string; anchor: MenuAnchor } | null>(null)
  // The one open workspace menu.
  const [wsMenu, setWsMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null)
  // The folder currently open in the edit dialog.
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [favoriteWorkspaceIds, setFavoriteWorkspaceIds] = useState<Set<string>>(new Set())
  const [recentWorkspaceIds, setRecentWorkspaceIds] = useState<string[]>([])
  const [workspaceToolsVisible, setWorkspaceToolsVisible] = useState(false)
  const [sortMode, setSortMode] = useState<WorkspaceSort>('recent')
  const [sortMenu, setSortMenu] = useState<HTMLElement | null>(null)
  const [manualOrder, setManualOrder] = useState<string[]>([])
  const workspaceActivity = useWorkspaceActivity()
  const agentWorkspaceStates = useAgentWorkspaceStates()
  // Re-rank once a minute so a new workspace's grace period can expire.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const sortContext = useMemo(
    () => ({
      now: Math.max(now, Date.now()),
      activity: workspaceActivity,
      agents: agentWorkspaceStates,
      attention: attentionWorkspaceIds,
      manualOrder
    }),
    [now, workspaceActivity, agentWorkspaceStates, attentionWorkspaceIds, manualOrder]
  )
  const sortedProject = (folderPath: string, include: (w: Workspace) => boolean = () => true): Workspace[] =>
    sortWorkspaces(workspaces.filter((w) => w.folderPath === folderPath && include(w)), sortMode, sortContext)

  // Dropping a dragged workspace pins the exact order and switches to Manual, like Orca.
  const commitWorkspaceOrder = (folderPath: string, visibleOrder: string[]): void => {
    const ids = (path: string): string[] => sortedProject(path).map((w) => w.id)
    const next = folders.flatMap((f) => (f.path === folderPath ? mergeVisibleOrder(ids(f.path), visibleOrder) : ids(f.path)))
    setManualOrder(next)
    setSortMode('manual')
    void window.api.setUiState({ workspaceSort: 'manual', workspaceOrder: next })
  }
  const navRef = useRef<HTMLElement | null>(null)
  const { drag: workspaceDrag, begin: beginWorkspaceDrag } = useWorkspaceDrag(navRef, commitWorkspaceOrder)
  const projectWorkspaces = (folderPath: string, include: (w: Workspace) => boolean = () => true): Workspace[] => {
    const list = sortedProject(folderPath, include)
    if (workspaceDrag?.folderPath !== folderPath) return list
    const rank = new Map(workspaceDrag.order.map((id, index) => [id, index]))
    return [...list].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  }

  // Persist activity so Recent survives restarts; only existing workspaces are kept.
  const workspaceIdsRef = useRef(new Set<string>())
  workspaceIdsRef.current = new Set(workspaces.map((w) => w.id))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onWorkspaceActivity((activity) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const entries = [...activity].filter(([id]) => workspaceIdsRef.current.has(id))
        void window.api.setUiState({ workspaceActivity: Object.fromEntries(entries) })
      }, 2_000)
    })
    return () => { off(); clearTimeout(timer) }
  }, [])

  useEffect(() => {
    void window.api.getSettings().then((settings) => {
      setFavoriteWorkspaceIds(new Set(settings.ui.favoriteWorkspaceIds ?? []))
      setRecentWorkspaceIds(settings.ui.recentWorkspaceIds ?? [])
      setWorkspaceToolsVisible(settings.ui.sidebarWorkspaceTools)
      setSortMode(settings.ui.workspaceSort ?? 'recent')
      setManualOrder(settings.ui.workspaceOrder ?? [])
      primeWorkspaceActivity(settings.ui.workspaceActivity ?? {})
    })
  }, [])

  const persistWorkspaceUi = (favorites: Set<string>, recent: string[]): void => {
    void window.api.setUiState({
      favoriteWorkspaceIds: [...favorites],
      recentWorkspaceIds: recent.slice(0, 12)
    })
  }

  const selectWorkspace = (id: string): void => {
    onSelectWorkspace(id)
    setRecentWorkspaceIds((previous) => {
      const next = [id, ...previous.filter((item) => item !== id)].slice(0, 12)
      persistWorkspaceUi(favoriteWorkspaceIds, next)
      return next
    })
  }

  const toggleFavorite = (id: string): void => {
    setFavoriteWorkspaceIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistWorkspaceUi(next, recentWorkspaceIds)
      return next
    })
  }

  const normalizedQuery = workspaceQuery.trim().toLowerCase()
  const filteredWorkspaceIds = useMemo(() => {
    const result = new Set<string>()
    for (const workspace of workspaces) {
      const folder = folders.find((item) => item.path === workspace.folderPath)
      const haystack = `${workspace.name} ${workspace.branch ?? ''} ${folder?.name ?? ''} ${folder?.displayName ?? ''}`.toLowerCase()
      if ((!normalizedQuery || haystack.includes(normalizedQuery)) && (!favoritesOnly || favoriteWorkspaceIds.has(workspace.id))) {
        result.add(workspace.id)
      }
    }
    return result
  }, [workspaces, folders, normalizedQuery, favoritesOnly, favoriteWorkspaceIds])
  const recentWorkspaces = useMemo(
    () =>
      recentWorkspaceIds
        .map((id) => workspaces.find((workspace) => workspace.id === id))
        .filter((workspace): workspace is Workspace => !!workspace && filteredWorkspaceIds.has(workspace.id))
        .slice(0, 3),
    [recentWorkspaceIds, workspaces, filteredWorkspaceIds]
  )
  // Drag-to-reorder for folders, pointer-based (not HTML5 DnD): the list
  // reorders live while dragging so the drop position is always visible, and
  // Escape cancels. All tracking runs on window listeners registered at drag
  // start — never on the grip element itself, whose DOM node React MOVES on
  // every live reorder, which would silently kill its pointer capture (and
  // with it the whole drag). The pointer is captured by the <nav> (a node
  // that never moves) so events keep flowing even outside the sidebar.
  const [folderDrag, setFolderDrag] = useState<{
    path: string
    /** live working order of folder paths, applied to rendering while dragging */
    order: string[]
  } | null>(null)

  const beginFolderDrag =
    (path: string) =>
    (e: React.PointerEvent<HTMLElement>): void => {
      // Left button / primary touch only; keep the click from toggling collapse.
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const nav = navRef.current
      const pointerId = e.pointerId
      const startY = e.clientY
      // Capture on the nav (it never remounts/moves), so moves outside the
      // window still arrive and the drag can't be silently dropped.
      try {
        nav?.setPointerCapture(pointerId)
      } catch {
        /* capture is an enhancement — the window listeners work without it */
      }

      // Mutable drag bookkeeping lives in this closure; state only drives paint.
      let order = folders.map((f) => f.path)
      let active = false

      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return
        // A few px of slack so a plain click on the grip never counts as a drag.
        if (!active && Math.abs(ev.clientY - startY) < 4) return
        if (!nav) return
        // Keep long lists reachable: nudge the scroll when hugging an edge.
        const box = nav.getBoundingClientRect()
        if (ev.clientY < box.top + 24) nav.scrollTop -= 8
        else if (ev.clientY > box.bottom - 24) nav.scrollTop += 8
        // Insertion index = how many other folder blocks sit above the pointer
        // (by their vertical midpoint), clamped to the list by construction.
        const others = Array.from(nav.querySelectorAll<HTMLElement>('[data-folder-path]')).filter(
          (el) => el.dataset.folderPath !== path
        )
        let index = 0
        for (const el of others) {
          const r = el.getBoundingClientRect()
          if (ev.clientY > r.top + r.height / 2) index++
        }
        const next = order.filter((p) => p !== path)
        next.splice(index, 0, path)
        const changed = next.join('\n') !== order.join('\n')
        if (active && !changed) return
        active = true
        order = next
        setFolderDrag({ path, order: next })
      }

      const teardown = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key, true)
        try {
          nav?.releasePointerCapture(pointerId)
        } catch {
          /* already released */
        }
        setFolderDrag(null)
      }

      const up = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return
        const changed = active && order.join('\n') !== folders.map((f) => f.path).join('\n')
        teardown()
        if (changed) onReorderFolders(order)
      }

      // Cancelled gesture / Escape: restore the original order.
      const cancel = (ev: PointerEvent): void => {
        if (ev.pointerId === pointerId) teardown()
      }
      const key = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') {
          ev.stopPropagation()
          teardown()
        }
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key, true)
    }

  // While a drag is live, force the grabbing cursor and disable text selection
  // everywhere (the pointer is captured, so the cursor must be set globally).
  const isDraggingFolder = folderDrag !== null
  useEffect(() => {
    if (!isDraggingFolder) return
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [isDraggingFolder])

  // Folders in their live drag order while dragging, persisted order otherwise.
  const displayFolders = folderDrag
    ? (folderDrag.order
        .map((p) => folders.find((f) => f.path === p))
        .filter(Boolean) as Folder[])
    : folders

  // Persist the expand/collapse state on the folder so it survives a restart.
  const toggleFolder = (folder: Folder): void =>
    onUpdateFolder(folder.path, { collapsed: !folder.collapsed })

  const startRename = (ws: Workspace): void => {
    setAddingFor(null)
    setEditingId(ws.id)
    setDraft(ws.name)
  }
  const commitRename = (): void => {
    if (editingId) onRenameWorkspace(editingId, draft)
    setEditingId(null)
  }
  const startAdd = (folderPath: string): void => {
    setEditingId(null)
    setAddingFor(folderPath)
  }

  /** The folder actions offered by both the kebab and the right-click menu. */
  const folderMenuItems = (folder: Folder): MenuItem[] => [
    {
      id: 'edit',
      label: t('folder.edit'),
      icon: <PencilIcon size={13} />,
      onSelect: () => setEditingFolder(folder)
    },
    {
      id: 'add-workspace',
      label: t('sidebar.addWorkspace'),
      icon: <span className="text-sm leading-none">+</span>,
      onSelect: () => startAdd(folder.path)
    },
    'separator',
    {
      id: 'remove',
      label: t('sidebar.removeFolder'),
      icon: <TrashIcon size={13} />,
      tone: 'danger',
      onSelect: () => onRemoveFolder(folder.path)
    }
  ]

  const sortLabels: Record<WorkspaceSort, string> = {
    recent: t('sidebar.sortRecent'),
    smart: t('sidebar.sortSmart'),
    name: t('sidebar.sortName'),
    manual: t('sidebar.sortManual')
  }
  const sortMenuItems: MenuItem[] = WORKSPACE_SORTS.map((mode) => ({
    id: mode,
    label: sortLabels[mode],
    icon: mode === sortMode ? <CheckIcon size={13} /> : <span className="inline-block w-[13px]" />,
    onSelect: () => {
      setSortMode(mode)
      void window.api.setUiState({ workspaceSort: mode })
    }
  }))

  /** The workspace actions offered by both the kebab and the right-click menu. */
  const wsMenuItems = (ws: Workspace): MenuItem[] => [
    ...(folders.find(f => f.path === ws.folderPath)?.kind !== 'remote' ? [{
      id: 'setup',
      label: t('setup.configure'),
      icon: <GearIcon size={13} />,
      onSelect: () => setSetupWorkspaceId(ws.id)
    }] : []),
    {
      id: 'rename',
      label: t('sidebar.renameWorkspaceAction'),
      icon: <PencilIcon size={13} />,
      onSelect: () => startRename(ws)
    },
    ...(ws.worktreePath
      ? [
          {
            id: 'reveal',
            label: t('worktree.revealInFinder'),
            icon: <ExternalLinkIcon size={13} />,
            onSelect: () => void window.api.openPath(ws.worktreePath as string)
          } as const
        ]
      : []),
    'separator',
    {
      id: 'remove',
      label: t('sidebar.removeWorkspace'),
      icon: <TrashIcon size={13} />,
      tone: 'danger',
      onSelect: () => onRemoveWorkspace(ws.id)
    }
  ]

  // Menus + dialogs shared between the collapsed rail and the expanded sidebar.
  const menuFolder = folderMenu ? folders.find((f) => f.path === folderMenu.path) ?? null : null
  const menuWs = wsMenu ? workspaces.find((w) => w.id === wsMenu.id) ?? null : null
  const addingFolder = addingFor ? folders.find((f) => f.path === addingFor) ?? null : null
  const setupWorkspace = workspaces.find(w => w.id === setupWorkspaceId && folders.find(f => f.path === w.folderPath)?.kind !== 'remote')
  const overlays = (
    <>
      {setupWorkspace && <WorktreeSetup key={setupWorkspace.id} workspace={setupWorkspace} onClose={() => setSetupWorkspaceId(null)} />}
      {folderMenu && menuFolder && (
        <Menu
          items={folderMenuItems(menuFolder)}
          anchor={folderMenu.anchor}
          onClose={() => setFolderMenu(null)}
        />
      )}
      {sortMenu && <Menu items={sortMenuItems} anchor={sortMenu} onClose={() => setSortMenu(null)} />}
      {wsMenu && menuWs && (
        <Menu items={wsMenuItems(menuWs)} anchor={wsMenu.anchor} onClose={() => setWsMenu(null)} />
      )}
      {editingFolder && (
        <FolderEditModal
          folder={editingFolder}
          onCancel={() => setEditingFolder(null)}
          onSave={(patch) => onUpdateFolder(editingFolder.path, patch)}
        />
      )}
      {addingFolder && (
        <WorkspaceCreateModal
          folder={addingFolder}
          existingNames={workspaces
            .filter((w) => w.folderPath === addingFolder.path)
            .map((w) => w.name)}
          onCancel={() => setAddingFor(null)}
          onCreateStandard={onAddWorkspace}
          onCreateWorktree={onAddWorktreeWorkspace}
        />
      )}
    </>
  )

  // Collapsed: workspace initials with the same activity and selection cues.
  if (collapsed) {
    return (
      <aside
        className="superior-sidebar flex w-14 shrink-0 select-none flex-col items-stretch overflow-hidden bg-bar transition-[width] duration-200 ease-out"
      >
        {overlays}
        <div className="flex flex-col items-center gap-1 border-b border-edge p-2">
          <button
            onClick={onOpenProject}
            title={t('sidebar.openProject')}
            aria-label={t('sidebar.openProject')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-fgdim transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            +
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto py-2">
          <div className="flex flex-col items-center gap-2">
            {folders.map((folder, i) => {
              const folderWorkspaces = projectWorkspaces(folder.path)
              const folderBusy = folderWorkspaces.some((w) => busyWorkspaceIds.has(w.id))
              const folderAttn = folderWorkspaces.some((w) => attentionWorkspaceIds.has(w.id))
              return (
                <div key={folder.path} className="flex w-full flex-col items-center gap-1.5">
                  {i > 0 && <div className="my-1 h-px w-6 bg-edge" />}

                  {/* Project marker — folder glyph; jumps to its first workspace.
                      With no workspaces it expands the sidebar instead of no-oping. */}
                  <button
                    onClick={() => {
                      if (folderWorkspaces[0]) selectWorkspace(folderWorkspaces[0].id)
                      else onExpand()
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setFolderMenu({ path: folder.path, anchor: { x: e.clientX, y: e.clientY } })
                    }}
                    title={folderTitle(folder)}
                    aria-label={folderLabel(folder)}
                    style={folder.color ? { color: folder.color } : undefined}
                    className="relative flex h-7 w-8 items-center justify-center rounded-md text-fgmuted transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <FolderGlyph folder={folder} />
                    {folderAttn ? (
                      <span
                        style={{ '--attn': attentionColor } as CSSProperties}
                        className="attention-pulse-dot absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-bar"
                      />
                    ) : folderBusy ? (
                      <WorkingSpinner className="absolute -right-0.5 -top-0.5 h-3 w-3" />
                    ) : null}
                  </button>

                  {/* Workspaces — square initial badges */}
                  {folderWorkspaces.map((ws) => {
                    const active = ws.id === activeWorkspaceId
                    const busy = busyWorkspaceIds.has(ws.id)
                    const attn = attentionWorkspaceIds.has(ws.id)
                    return (
                      <button
                        key={ws.id}
                        onClick={() => selectWorkspace(ws.id)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setWsMenu({ id: ws.id, anchor: { x: e.clientX, y: e.clientY } })
                        }}
                        aria-current={active || undefined}
                        title={`${folderLabel(folder)} / ${ws.name}${ws.branch ? ` · ${ws.branch}` : ''}`}
                        style={attn ? ({ '--attn': attentionColor } as CSSProperties) : undefined}
                        className={`relative flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50 ${
                          active
                            ? 'bg-accentBg text-accent ring-1 ring-inset ring-accentBorder'
                            : 'text-fgdim hover:bg-hover hover:text-fg'
                        }`}
                      >
                        {initial(ws.name)}
                        {active && <span aria-hidden className="absolute inset-y-2 -left-2 w-0.5 rounded-full bg-accent" />}
                        {attn ? (
                          <span
                            style={{ '--attn': attentionColor } as CSSProperties}
                            className="attention-pulse-dot absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-bar"
                          />
                        ) : busy ? (
                          <WorkingSpinner className="absolute -right-1 -top-1 h-3.5 w-3.5" />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </nav>
        <SidebarUpdate update={update} collapsed />
        <div className="shrink-0 border-t border-edge p-2">
          <button
            onClick={onOpenSettings}
            title={shortcutTitle(t('sidebar.settings'), 'openSettings')}
            aria-label={t('sidebar.settings')}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-fgdim transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <GearIcon size={18} />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className="superior-sidebar flex w-64 shrink-0 select-none flex-col overflow-hidden bg-bar transition-[width] duration-200 ease-out"
    >
      {overlays}
      <div className="px-3 pb-1 pt-2.5">
        <div className="flex h-7 items-center justify-between pl-2">
          <span className="flex-1 text-xs font-semibold text-fgmuted">
            {t('palette.sectionWorkspaces')}
          </span>
          <button
            type="button"
            onClick={(e) => setSortMenu(e.currentTarget)}
            title={`${t('sidebar.sortBy')}: ${sortLabels[sortMode]}`}
            aria-label={t('sidebar.sortBy')}
            aria-haspopup="menu"
            className="grid h-6 w-6 place-items-center rounded-md text-fgmuted transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <SlidersIcon size={14} />
          </button>
          <button
            onClick={onOpenProject}
            title={t('sidebar.openProject')}
            aria-label={t('sidebar.openProject')}
            className="grid h-6 w-6 place-items-center rounded-md text-fgmuted transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <PlusIcon size={15} />
          </button>
        </div>
        {workspaceToolsVisible && (
          <div className="mt-2 space-y-1.5">
            <div className="relative">
              <SearchIcon
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fgmuted"
              />
              <input
                value={workspaceQuery}
                onChange={(event) => setWorkspaceQuery(event.target.value)}
                placeholder={t('sidebar.searchWorkspaces')}
                aria-label={t('sidebar.searchWorkspaces')}
                className="h-8 w-full rounded-full border border-edge bg-panel pl-8 pr-7 text-xs text-fg shadow-xs placeholder:text-fgmuted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
              />
              {workspaceQuery && (
                <button
                  type="button"
                  onClick={() => setWorkspaceQuery('')}
                  aria-label={t('sidebar.clearSearch')}
                  title={t('sidebar.clearSearch')}
                  className="absolute right-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-fgmuted hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFavoritesOnly((value) => !value)}
                aria-pressed={favoritesOnly}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50 ${favoritesOnly ? 'bg-accentBg text-accent' : 'text-fgmuted hover:bg-hover hover:text-fg'}`}
              >
                <StarIcon size={12} className={favoritesOnly ? 'fill-current' : ''} />
                {t('sidebar.filterFavorites')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkspaceQuery('')
                  setFavoritesOnly(false)
                }}
                className="rounded px-1.5 py-1 text-[11px] text-fgmuted hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                {t('sidebar.showAll')}
              </button>
            </div>
          </div>
        )}
      </div>

      <nav ref={navRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {folders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
            <p className="text-xs leading-5 text-fgmuted">{t('sidebar.noWorkspaces')}</p>
            <button
              onClick={onOpenProject}
              className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {t('sidebar.openProject')}
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {workspaceToolsVisible &&
              !workspaceQuery &&
              !favoritesOnly &&
              recentWorkspaces.length > 0 && (
              <div className="border-b border-edge px-3 pb-2">
                <div className="mb-1 px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-fgmuted">
                  {t('sidebar.recentlyVisited')}
                </div>
                <div className="space-y-0.5">
                  {recentWorkspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => selectWorkspace(workspace.id)}
                      className="flex min-h-7 w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-fgdim transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {filteredWorkspaceIds.size === 0 ? (
              <div className="px-3 py-8 text-center text-xs leading-5 text-fgmuted">
                {t('sidebar.noMatches')}
              </div>
            ) : (
            displayFolders.map((folder) => {
              const folderWorkspaces = projectWorkspaces(folder.path, (w) => filteredWorkspaceIds.has(w.id))
              const open = !folder.collapsed
              const folderRunning = folderWorkspaces.reduce((a, w) => a + (counts[w.id] ?? 0), 0)
              const folderActive = folderWorkspaces.some((w) => w.id === activeWorkspaceId)
              const beingDragged = folderDrag?.path === folder.path
              if (folderWorkspaces.length === 0) return null
              return (
                <div
                  key={folder.path}
                  data-folder-path={folder.path}
                  className={beingDragged ? 'rounded-lg opacity-60 ring-1 ring-accentBorder' : undefined}
                >
                  {/* Folder header — click to collapse / expand; the grip drags to reorder */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleFolder(folder)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleFolder(folder)
                      } else if (e.key === 'ArrowLeft' && open) {
                        e.preventDefault()
                        toggleFolder(folder)
                      } else if (e.key === 'ArrowRight' && !open) {
                        e.preventDefault()
                        toggleFolder(folder)
                      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                        e.preventDefault()
                        setFolderMenu({ path: folder.path, anchor: e.currentTarget })
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setFolderMenu({ path: folder.path, anchor: { x: e.clientX, y: e.clientY } })
                    }}
                    title={folderTitle(folder)}
                    aria-haspopup="menu"
                    className="group relative flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-fg transition hover:bg-hover/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <span style={folder.color ? { color: folder.color } : undefined} className="text-fgdim">
                      <FolderGlyph folder={folder} size={15} />
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] ${
                      folderActive ? 'text-fg' : 'text-fg2'
                    }`}>
                      {folderLabel(folder)}
                    </span>
                    {(!open || folderWorkspaces.length > 1) && (
                      <span className="mr-1 shrink-0 px-1 text-[11px] font-medium tabular-nums text-fgdim transition group-hover:opacity-0 group-focus-within:opacity-0">
                        {folderWorkspaces.length}
                      </span>
                    )}
                    {!open && folderRunning > 0 && (
                      <RunningBadge count={folderRunning} title={t('sidebar.runningTerminals')} />
                    )}
                    {/* Drag handle — the drag itself runs on window listeners
                        (see beginFolderDrag), the list live-reorders under the pointer. */}
                    <span className="absolute right-1 flex items-center rounded-md bg-panel opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      <span
                        title={t('sidebar.reorderFolder')}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={beginFolderDrag(folder.path)}
                        className={`flex h-5 w-4 shrink-0 touch-none items-center justify-center text-fgmuted ${
                          beingDragged ? 'cursor-grabbing' : 'cursor-grab'
                        }`}
                      >
                        <GripIcon size={12} />
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          startAdd(folder.path)
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-fgdim transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
                        aria-label={t('sidebar.addWorkspace')}
                        title={t('sidebar.addWorkspace')}
                      >
                        <PlusIcon size={13} />
                      </button>
                    </span>
                  </div>

                  {/* Workspaces — compact, indented rows under their project. */}
                  {open && (
                    <ul className="mt-0.5 space-y-px">
                      {folderWorkspaces.map((ws) => {
                        const active = ws.id === activeWorkspaceId
                        const draggingThis = workspaceDrag?.id === ws.id
                        const attn = attentionWorkspaceIds.has(ws.id)
                        const busy = busyWorkspaceIds.has(ws.id)
                        const runningCount = counts[ws.id] ?? 0
                        const stat = gitStats[ws.id]
                        const hasDiff = !!stat?.isRepository && (stat.additions > 0 || stat.deletions > 0)
                        // Two-line rows align the status dot with the name, not the row centre.
                        const twoLines = folder.kind === 'remote' || !!ws.branch || hasDiff
                        return (
                          <li key={ws.id} data-workspace-id={ws.id}>
                            <div
                              role="button"
                              tabIndex={0}
                              aria-current={active || undefined}
                              onPointerDown={beginWorkspaceDrag(folder.path, ws.id, folderWorkspaces.map((w) => w.id))}
                              onClick={() => selectWorkspace(ws.id)}
                              onKeyDown={(e) => {
                                if (editingId === ws.id || e.target !== e.currentTarget) return
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  selectWorkspace(ws.id)
                                } else if (e.key === 'F2') {
                                  e.preventDefault()
                                  startRename(ws)
                                } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                                  e.preventDefault()
                                  setWsMenu({ id: ws.id, anchor: e.currentTarget })
                                }
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setWsMenu({ id: ws.id, anchor: { x: e.clientX, y: e.clientY } })
                              }}
                              style={attn ? ({ '--attn': attentionColor } as CSSProperties) : undefined}
                              className={`group relative flex cursor-pointer items-center gap-2 rounded-md py-1 pl-4 pr-1.5 transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
                                draggingThis ? 'opacity-60 ring-1 ring-accentBorder ' : ''
                              }${
                                active
                                  ? 'bg-accentBg text-fg'
                                  : 'text-fg2 hover:bg-hover/70'
                              }`}
                            >
                              <span className={`flex h-4 w-3.5 shrink-0 items-center justify-center ${twoLines ? 'self-start' : ''}`}>
                                {attn ? (
                                  <span
                                    role="img"
                                    aria-label={t('terminal.statusFinished')}
                                    title={t('terminal.statusFinished')}
                                    style={{ '--attn': attentionColor } as CSSProperties}
                                    className="attention-pulse-dot h-2 w-2 rounded-full"
                                  />
                                ) : busy ? (
                                  <span role="img" aria-label={t('sidebar.workingTerminals')} title={t('sidebar.workingTerminals')}>
                                    <WorkingSpinner className="h-3 w-3" />
                                  </span>
                                ) : (
                                  <span
                                    aria-hidden
                                    className={`h-2 w-2 rounded-full ${runningCount > 0 ? 'bg-status' : 'bg-fgmuted/45'}`}
                                  />
                                )}
                              </span>
                              {editingId === ws.id ? (
                                <input
                                  autoFocus
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={commitRename}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitRename()
                                    else if (e.key === 'Escape') setEditingId(null)
                                  }}
                                  className="min-w-0 flex-1 select-text rounded-sm border border-edge bg-panel px-1.5 py-0.5 text-sm text-fg focus:border-accent focus:outline-hidden"
                                />
                              ) : (
                                // Two-line row: name on top; branch + diff stat on a
                                // second, smaller line so nothing overlaps at 224px.
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span
                                    onDoubleClick={(e) => {
                                      e.stopPropagation()
                                      startRename(ws)
                                    }}
                                    className={`truncate text-[13px] leading-4 ${
                                      active ? 'font-semibold text-fg' : 'font-medium text-fg2'
                                    }`}
                                    // The tooltip shows the workspace itself (its branch/
                                    // path live only on the collapsed rail otherwise);
                                    // rename stays discoverable via the kebab menu.
                                    title={
                                      ws.branch ? `${ws.name} · ${ws.branch}` : ws.name
                                    }
                                  >
                                    {ws.name}
                                  </span>
                                  {twoLines && (
                                    <span className="flex min-w-0 items-center gap-2">
                                      {folder.kind === 'remote' && (
                                        <RemoteBadge title={folderTitle(folder)} />
                                      )}
                                      {ws.branch && (
                                        <span
                                          title={t('sidebar.worktreeBadge')}
                                          className="min-w-0 truncate text-[11px] leading-4 text-fgmuted"
                                        >
                                          {ws.branch}
                                        </span>
                                      )}
                                      {hasDiff && (
                                        <DiffStat
                                          stat={stat}
                                          title={t('sidebar.diffStat')}
                                        />
                                      )}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Setup and workspace actions live in the right-click menu. */}
                              {editingId !== ws.id && workspaceToolsVisible && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleFavorite(ws.id)
                                  }}
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-fgmuted transition hover:bg-edge hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50 ${
                                    favoriteWorkspaceIds.has(ws.id)
                                      ? 'text-accent opacity-100'
                                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                                  }`}
                                  aria-label={
                                    favoriteWorkspaceIds.has(ws.id)
                                      ? t('sidebar.unfavorite')
                                      : t('sidebar.favorite')
                                  }
                                  title={
                                    favoriteWorkspaceIds.has(ws.id)
                                      ? t('sidebar.unfavorite')
                                      : t('sidebar.favorite')
                                  }
                                  aria-pressed={favoriteWorkspaceIds.has(ws.id)}
                                >
                                  <StarIcon
                                    size={12}
                                    className={favoriteWorkspaceIds.has(ws.id) ? 'fill-current' : ''}
                                  />
                                </button>
                              )}

                              {editingId !== ws.id && runningCount > 0 && (
                                <span className="ml-auto shrink-0">
                                  <RunningBadge count={runningCount} title={t('sidebar.runningTerminals')} />
                                </span>
                              )}
                            </div>
                          </li>
                        )
                      })}

                    </ul>
                  )}
                </div>
              )
            })
            )}
          </div>
        )}
      </nav>
      <SidebarUpdate update={update} />
      <div className="shrink-0 border-t border-edge p-2">
        <button
          onClick={onOpenSettings}
          title={shortcutTitle(t('sidebar.settings'), 'openSettings')}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-fgdim transition hover:bg-hover hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="flex h-5 w-5 items-center justify-center">
            <GearIcon size={17} />
          </span>
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
})
