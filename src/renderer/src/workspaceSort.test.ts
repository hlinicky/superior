import { describe, expect, it } from 'vitest'
import { CREATE_GRACE_MS, mergeVisibleOrder, sortWorkspaces, type WorkspaceSortContext } from './workspaceSort'
import type { Workspace } from './types'

const HOUR = 60 * 60_000
const now = 100 * HOUR
const ws = (id: string, name: string, createdAt = 0): Workspace => ({ id, name, folderPath: '/p', createdAt })
const ctx = (patch: Partial<WorkspaceSortContext> = {}): WorkspaceSortContext =>
  ({ now, activity: new Map(), agents: new Map(), attention: new Set(), ...patch })
const ids = (list: Workspace[]): string[] => list.map((w) => w.id)

describe('workspace sort', () => {
  const list = [ws('a', 'beta'), ws('b', 'Alpha'), ws('c', 'gamma 10'), ws('d', 'gamma 9')]

  it('Name sorts naturally and ignores case', () => {
    expect(ids(sortWorkspaces(list, 'name', ctx()))).toEqual(['b', 'a', 'd', 'c'])
  })

  it('Recent puts the latest activity first, falling back to creation time and name', () => {
    const activity = new Map([['c', now - HOUR], ['a', now - 2 * HOUR]])
    expect(ids(sortWorkspaces(list, 'recent', ctx({ activity })))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('Recent keeps a brand-new workspace on top during the grace window only', () => {
    const fresh = ws('new', 'zz', now - 60_000)
    const activity = new Map([['a', now - 1_000]])
    expect(ids(sortWorkspaces([...list, fresh], 'recent', ctx({ activity })))[0]).toBe('new')
    const later = ctx({ now: now + CREATE_GRACE_MS, activity: new Map([['a', now + CREATE_GRACE_MS - 1]]) })
    expect(ids(sortWorkspaces([...list, fresh], 'recent', later))[0]).toBe('a')
  })

  it('Smart ranks needs-you, then unseen done, then working, then idle by recency', () => {
    const smart = ctx({
      agents: new Map([['a', 'working'], ['d', 'waiting']]),
      attention: new Set(['c']),
      activity: new Map([['b', now]])
    })
    expect(ids(sortWorkspaces(list, 'smart', smart))).toEqual(['d', 'c', 'a', 'b'])
  })

  it('Manual keeps the dragged order and puts never-placed workspaces on top, newest first', () => {
    const extra = [ws('n1', 'new one', 10), ws('n2', 'new two', 20)]
    const manual = ctx({ manualOrder: ['c', 'a', 'd', 'b'] })
    expect(ids(sortWorkspaces([...list, ...extra], 'manual', manual))).toEqual(['n2', 'n1', 'c', 'a', 'd', 'b'])
  })

  it('merges a filtered reorder back without moving hidden workspaces', () => {
    expect(mergeVisibleOrder(['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b'])
    expect(mergeVisibleOrder(['a', 'b'], ['b', 'a'])).toEqual(['b', 'a'])
  })
})
