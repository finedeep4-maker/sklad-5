import { Shield } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAuth } from '@/modules/core/store'

interface Props {
  /** Go back to the welcome screen, where the apartment scanner lives. */
  onScanner: () => void
}

/** Shown in the main app to signed-in users who are not administrators. */
export function AdminOnlyScreen({ onScanner }: Props) {
  const { t } = useI18n()
  const signOut = useAuth((s) => s.signOut)

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center px-6 text-center" data-theme="dark">
      <div className="w-14 h-14 bg-warn-soft rounded-2xl flex items-center justify-center mb-4">
        <Shield className="w-7 h-7 text-warn" />
      </div>
      <h1 className="text-lg font-semibold text-ink mb-2">{t.welcome.adminOnlyTitle}</h1>
      <p className="text-sm text-muted max-w-xs mb-6">{t.welcome.adminOnlyText}</p>
      <button
        onClick={onScanner}
        className="w-full max-w-xs min-h-[48px] bg-accent text-white rounded-xl px-4 py-3 text-sm font-medium transition-opacity hover:opacity-90"
      >
        {t.welcome.toScanner}
      </button>
      <button onClick={() => void signOut()} className="mt-4 text-sm text-muted underline underline-offset-2">
        {t.qr.logout}
      </button>
    </div>
  )
}
