import type { Workspace } from './types'

export type WorkspaceSort = 'recent' | 'smart' | 'name' | 'manual'
export const WORKSPACE_SORTS: WorkspaceSort[] = ['recent', 'smart', 'name', 'manual']

/** A new workspace stays on top this long, so other terminals' activity cannot bury it at once. */
export const CREATE_GRACE_MS = 5 * 60_000

export interface WorkspaceSortContext {
  now: number
  /** Last activity per workspace id (terminal start/exit, agent turn events). */
  activity: ReadonlyMap<string, number>
  /** Agent-reported state per workspace id. */
  agents: ReadonlyMap<string, 'waiting' | 'working'>
  /** Workspaces with an unseen finished turn or alert. */
  attention: ReadonlySet<string>
  /** Workspace ids in the order the user dragged them into. */
  manualOrder?: readonly string[]
}

export function recentActivity(ws: Workspace, ctx: WorkspaceSortContext): number {
  const last = Math.max(ctx.activity.get(ws.id) ?? 0, ws.createdAt)
  return ctx.now < ws.createdAt + CREATE_GRACE_MS ? Math.max(last, ws.createdAt + CREATE_GRACE_MS) : last
}

/** Needs you → done (unseen) → working → idle. */
function smartClass(ws: Workspace, ctx: WorkspaceSortContext): number {
  const agent = ctx.agents.get(ws.id)
  if (agent === 'waiting') return 1
  if (ctx.attention.has(ws.id)) return 2
  if (agent === 'working') return 3
  return 4
}

const byName = (a: Workspace, b: Workspace): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** Order the workspaces of one project; projects keep their manual order. */
export function sortWorkspaces(list: Workspace[], mode: WorkspaceSort, ctx: WorkspaceSortContext): Workspace[] {
  const recent = (a: Workspace, b: Workspace): number => recentActivity(b, ctx) - recentActivity(a, ctx)
  const rank = new Map((ctx.manualOrder ?? []).map((id, index) => [id, index]))
  // Workspaces never placed by hand (new ones) sit on top, newest first.
  const manual = (a: Workspace, b: Workspace): number =>
    (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1) || b.createdAt - a.createdAt || byName(a, b)
  const compare = mode === 'manual'
    ? manual
    : mode === 'name'
    ? byName
    : mode === 'smart'
      ? (a: Workspace, b: Workspace) => smartClass(a, ctx) - smartClass(b, ctx) || recent(a, b) || byName(a, b)
      : (a: Workspace, b: Workspace) => recent(a, b) || byName(a, b)
  return [...list].sort(compare)
}

/**
 * Apply a reorder of the visible (possibly filtered) workspaces to the full list:
 * visible ids take their new order in the slots they occupied, hidden ids stay put.
 */
export function mergeVisibleOrder(fullIds: readonly string[], visibleOrder: readonly string[]): string[] {
  const visible = new Set(visibleOrder)
  let next = 0
  return fullIds.map((id) => (visible.has(id) ? visibleOrder[next++] : id))
}
