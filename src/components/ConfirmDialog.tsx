import { useEffect, useRef } from 'react'
import { useI18n } from '@/i18n'
import { TriangleAlert as AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'bad' | 'warn'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'bad',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    confirmRef.current?.focus()
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  const toneColor = tone === 'bad' ? 'text-bad' : 'text-warn'
  const toneBg = tone === 'bad' ? 'bg-bad' : 'bg-warn'

  return (
    <div
      className="fixed inset-0 bg-black/45 z-[70] flex items-center justify-center anim-scrim"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="bg-surface rounded-2xl p-5 max-w-sm w-full mx-4 border border-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className={`w-5 h-5 ${toneColor} mt-0.5 shrink-0`} />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {message && <p className="text-sm text-muted mt-1">{message}</p>}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm"
          >
            {cancelLabel ?? t.cleaning.cancel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`flex-1 ${toneBg} text-white rounded-lg py-3 font-medium text-sm`}
          >
            {confirmLabel ?? t.common.ok}
          </button>
        </div>
      </div>
    </div>
  )
}
