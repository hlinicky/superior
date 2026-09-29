import { useEffect, useState, type RefObject } from 'react'

export interface WorkspaceDrag {
  folderPath: string
  id: string
  /** Live order of the project's visible workspace ids while dragging. */
  order: string[]
}

/**
 * Pointer-based drag-to-reorder for workspace rows inside one project, like the
 * folder drag: the list reorders live, Escape cancels. The whole row is the
 * handle, so a drag only starts after a few pixels and the click that ends a
 * drag is swallowed; plain clicks still select the workspace.
 */
export function useWorkspaceDrag(
  navRef: RefObject<HTMLElement | null>,
  onCommit: (folderPath: string, order: string[]) => void
): { drag: WorkspaceDrag | null; begin: (folderPath: string, id: string, visibleIds: string[]) => (e: React.PointerEvent<HTMLElement>) => void } {
  const [drag, setDrag] = useState<WorkspaceDrag | null>(null)

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging])

  const begin = (folderPath: string, id: string, visibleIds: string[]) => (e: React.PointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || visibleIds.length < 2) return
    if ((e.target as HTMLElement).closest('button, input')) return
    const nav = navRef.current
    const pointerId = e.pointerId
    const startY = e.clientY
    let order = visibleIds
    let active = false

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId || !nav) return
      if (!active && Math.abs(ev.clientY - startY) < 4) return
      if (!active) {
        // Capture only once it is a drag, so a plain click still reaches the row.
        try { nav.setPointerCapture(pointerId) } catch { /* window listeners suffice */ }
      }
      const box = nav.getBoundingClientRect()
      if (ev.clientY < box.top + 24) nav.scrollTop -= 8
      else if (ev.clientY > box.bottom - 24) nav.scrollTop += 8
      const project = Array.from(nav.querySelectorAll<HTMLElement>('[data-folder-path]'))
        .find((el) => el.dataset.folderPath === folderPath)
      const others = Array.from(project?.querySelectorAll<HTMLElement>('[data-workspace-id]') ?? [])
        .filter((el) => el.dataset.workspaceId !== id)
      let index = 0
      for (const el of others) {
        const r = el.getBoundingClientRect()
        if (ev.clientY > r.top + r.height / 2) index++
      }
      const next = order.filter((item) => item !== id)
      next.splice(index, 0, id)
      if (active && next.join('\n') === order.join('\n')) return
      active = true
      order = next
      setDrag({ folderPath, id, order: next })
    }

    const swallowClick = (ev: MouseEvent): void => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    const teardown = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      try { nav?.releasePointerCapture(pointerId) } catch { /* already released */ }
      if (active) {
        // The click that ends a drag must not also select the row.
        window.addEventListener('click', swallowClick, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)
      }
      setDrag(null)
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      const changed = active && order.join('\n') !== visibleIds.join('\n')
      teardown()
      if (changed) onCommit(folderPath, order)
    }
    const cancel = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId) teardown()
    }
    const key = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      active = false
      teardown()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }

  return { drag, begin }
}
