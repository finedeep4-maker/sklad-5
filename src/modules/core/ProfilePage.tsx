import { useAuth } from '@/modules/core/store'
import { useI18n } from '@/i18n'
import { Package, LogOut } from 'lucide-react'

export function ProfilePage() {
  const { t } = useI18n()
  const profile = useAuth((s) => s.profile)
  const signOut = useAuth((s) => s.signOut)
  if (!profile) return null
  const roleLabel = profile.role === 'admin' ? t.profile.roleAdmin : t.profile.roleSupervisor

  return (
    <div className="px-4 pt-8 pb-28">
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mb-3">
          <Package className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-xl font-semibold text-ink">{profile.full_name}</h1>
        <span className="text-sm text-muted mt-1">{roleLabel}</span>
      </div>
      <div className="bg-surface rounded-xl border border-line divide-y divide-[var(--line)]">
        <Row label={t.profile.name} value={profile.full_name} />
        <Row label={t.profile.login} value={profile.login} />
        <Row label={t.profile.role} value={roleLabel} />
      </div>
      <button onClick={signOut}
        className="w-full mt-6 bg-surface border border-line text-bad rounded-xl py-3 font-medium flex items-center justify-center gap-2 transition-colors hover:bg-bad-soft">
        <LogOut className="w-5 h-5" />
        {t.profile.logout}
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm text-ink font-medium">{value}</span>
    </div>
  )
}
