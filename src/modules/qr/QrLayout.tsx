import { useI18n, useDocumentDir } from '@/i18n'
import { useAuth } from '@/modules/core/store'
import { LangSwitcher } from '@/components/LangSwitcher'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { getOutboxSummary } from '@/lib/outbox'
import { LogOut, Shield } from 'lucide-react'
import { useState } from 'react'

export function QrLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  useDocumentDir()
  const profile = useAuth((s) => s.profile)
  const signOut = useAuth((s) => s.signOut)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Unsent outbox entries stay on the device, but nothing is uploaded until the same user signs in again.
  const handleLogout = async () => {
    try {
      if (profile) {
        const s = await getOutboxSummary(profile.id)
        if (s.pending + s.failed + s.mediaPending + s.mediaFailed > 0) {
          setConfirmOpen(true)
          return
        }
      }
    } catch { /* storage unavailable: sign out as before */ }
    void signOut()
  }

  return (
    <div className="min-h-screen bg-app flex flex-col">
      {profile?.role === 'admin' && (
        <div className="bg-warn-soft text-warn text-center text-sm py-2 font-medium flex items-center justify-center gap-2">
          <Shield className="w-4 h-4" />
          {t.qr.adminNotice}
        </div>
      )}
      <div className="flex items-center justify-between px-4 h-11 bg-surface border-b border-line sticky top-0 z-30 max-w-lg mx-auto w-full">
        <span className="font-semibold text-ink text-sm">{t.app.name}</span>
        <div className="flex items-center gap-3">
          <LangSwitcher compact />
          <button onClick={handleLogout} className="text-muted hover:text-bad">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      <main className="flex-1 pb-20 max-w-lg mx-auto w-full">{children}</main>
      <ConfirmDialog
        open={confirmOpen}
        title={t.qr.logoutUnsentTitle}
        message={t.qr.logoutUnsentMessage}
        confirmLabel={t.qr.logoutAnyway}
        tone="warn"
        onConfirm={() => { setConfirmOpen(false); void signOut() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
