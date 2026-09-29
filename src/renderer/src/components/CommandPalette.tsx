import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { useDismiss } from './ui'
import { SearchIcon } from './ui/icons'
import { filterCommands, type Command } from '../commands'

interface Props {
  commands: Command[]
  onClose: () => void
}

/**
 * ⌘K command palette: fuzzy-search every currently available action —
 * workspaces, presets, prompts, panels, git — grouped by section, driven
 * entirely by the keyboard (↑↓ move, Enter runs, Escape closes).
 */
export function CommandPalette({ commands, onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape must close the palette even when focus left the input (Tab onto a
  // row); the backdrop handles outside clicks itself.
  useDismiss(panelRef, true, onClose, { outside: false })

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query])

  useEffect(() => {
    setIndex(0)
  }, [query])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (cmd: Command | undefined): void => {
    if (!cmd) return
    onClose()
    cmd.run()
  }

  // Group rows by section, preserving rank order within each group.
  const grouped = useMemo(() => {
    const bySection = new Map<string, Command[]>()
    for (const cmd of filtered) {
      const list = bySection.get(cmd.section) ?? []
      list.push(cmd)
      bySection.set(cmd.section, list)
    }
    return [...bySection.entries()]
  }, [filtered])

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="solid-surface flex max-h-[min(38rem,76vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl"
      >
        <div className="p-3">
          <label className="flex items-center gap-3 rounded-xl border border-edge bg-bar px-4 py-3 transition focus-within:border-accentBorder">
            <SearchIcon className="h-5 w-5 shrink-0 text-fgmuted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') onClose()
                else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setIndex((i) => Math.min(i + 1, filtered.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setIndex((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  run(filtered[index])
                }
              }}
              placeholder={t('palette.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-base text-fg placeholder:text-fgmuted focus:outline-hidden"
            />
          </label>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {filtered.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-fgmuted">
              {t('palette.noResults')}
            </div>
          )}
          {grouped.map(([section, cmds]) => (
            <div key={section}>
              <div className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-fgmuted">
                {section}
              </div>
              {cmds.map((cmd) => {
                const i = filtered.indexOf(cmd)
                return (
                  <button
                    key={cmd.id}
                    data-active={i === index || undefined}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(cmd)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm text-fg transition ${
                      i === index ? 'border-edge bg-hover' : 'border-transparent'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{cmd.title}</span>
                    {cmd.hint && <Kbd>{cmd.hint}</Kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-2.5 text-xs text-fgmuted">
          <Kbd>Enter</Kbd><span className="mr-2">{t('palette.open')}</span>
          <Kbd>Esc</Kbd><span className="mr-2">{t('palette.close')}</span>
          <Kbd>↑↓</Kbd><span>{t('palette.move')}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="shrink-0 rounded-md border border-edge bg-bar px-1.5 py-0.5 font-sans text-[11px] font-medium text-fg2">
      {children}
    </kbd>
  )
}
