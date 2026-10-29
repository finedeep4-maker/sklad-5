import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useI18n } from '@/i18n'
import { useAuth } from '@/modules/core/store'
import { getOutboxSummary } from '@/lib/outbox'
import { RefreshCw } from 'lucide-react'

export function PWAUpdateBanner() {
  const { t } = useI18n()
  const profile = useAuth((s) => s.profile)
  const profileId = profile?.id
  const [outboxBlocked, setOutboxBlocked] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError() {},
  })

  useEffect(() => {
    if (!needRefresh || !profileId) return
    let active = true
    const check = async () => {
      const summary = await getOutboxSummary(profileId)
      if (active) setOutboxBlocked(summary.pending > 0 || summary.failed > 0)
    }
    check()
    const interval = setInterval(check, 5000)
    return () => { active = false; clearInterval(interval) }
  }, [needRefresh, profileId])

  if (!needRefresh || outboxBlocked) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[80] bg-accent text-white px-4 py-3 flex items-center justify-between gap-3 anim-slide-up">
      <span className="text-sm font-medium">{t.pwaUpdate}</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        {t.pwaReload}
      </button>
    </div>
  )
}
