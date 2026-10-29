import { TriangleAlert as AlertTriangle, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n'

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-bad mb-3" />
      <p className="text-sm text-muted mb-4">{message ?? t.errors.loadFailed}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 bg-accent text-white rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          {t.retry}
        </button>
      )}
    </div>
  )
}
