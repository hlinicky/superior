import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { Button } from './ui'

/** Non-blocking Windows warning: agents inherit the app's administrator token. */
export function ElevationNotice({ onClose, onNever }: { onClose: () => void; onNever: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return createPortal(<div className="pointer-events-none fixed bottom-14 right-4 z-[140] flex w-[calc(100%-2rem)] max-w-md justify-end">
    <div role="alert" aria-live="polite"
      className="solid-surface pointer-events-auto w-full rounded-2xl border border-warnBorder bg-panel p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warnBg text-warn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{t('elevation.title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-fgmuted">{t('elevation.body')}</p>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="mt-2 text-xs font-semibold text-warn hover:underline">
            {open ? '▾' : '▸'} {t('elevation.howTo')}
          </button>
          {open && <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-fgmuted">
            <li>{t('elevation.step1')}</li>
            <li>{t('elevation.step2')}</li>
            <li>{t('elevation.step3')}</li>
          </ol>}
        </div>
        <button type="button" onClick={onClose} aria-label={t('elevation.later')}
          className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-lg text-fgdim hover:bg-hover hover:text-fg">×</button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onNever}>{t('elevation.never')}</Button>
        <Button variant="secondary" size="sm" onClick={onClose}>{t('elevation.later')}</Button>
      </div>
    </div>
  </div>, document.body)
}
