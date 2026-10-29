import { useState, useEffect } from 'react'
import { History as HistoryIcon, Wrench } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAuth } from '@/modules/core/store'
import { fetchApartments } from '@/modules/apartments/api'
import { friendlyMessage } from '@/lib/errors'
import { ErrorState } from '@/components/ErrorState'
import type { SvApartment } from '@/lib/database.types'
import { CleaningHistoryList } from './CleaningHistoryList'
import { IncidentHistoryList } from './IncidentHistoryList'

type Tab = 'cleaning' | 'incidents'

export function HistoryPage() {
  const { t } = useI18n()
  const profile = useAuth((s) => s.profile)
  const profileId = profile?.id
  const isAdmin = profile?.role === 'admin'
  const [apartments, setApartments] = useState<SvApartment[]>([])
  const [aptId, setAptId] = useState<number | ''>('')
  const [tab, setTab] = useState<Tab>('cleaning')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    fetchApartments(profileId)
      .then(setApartments)
      .catch((e) => setError(friendlyMessage(e)))
      .finally(() => setLoading(false))
  }, [profileId])

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (error) return <ErrorState onRetry={() => { if (profile) { setLoading(true); fetchApartments(profile.id).then(setApartments).catch((e) => setError(friendlyMessage(e))).finally(() => setLoading(false)) } }} />

  const selectedAptId = aptId === '' ? undefined : aptId

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.history.title}</h1>

      <div className="mb-4">
        <label className="block text-sm font-medium text-ink mb-1.5">{t.qr.detailApartment}</label>
        <select
          value={aptId}
          onChange={(e) => setAptId(e.target.value ? Number(e.target.value) : '')}
          className="w-full bg-surface rounded-xl px-4 py-3 text-sm border border-line focus:border-accent focus:outline-none"
        >
          <option value="">{t.history.allApartments}</option>
          {apartments.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
        </select>
      </div>

      <div className="flex gap-1 mb-4 border-b border-line">
        <TabButton active={tab === 'cleaning'} onClick={() => setTab('cleaning')} icon={HistoryIcon} label={t.history.cleaningTab} testId="tab-cleaning" />
        <TabButton active={tab === 'incidents'} onClick={() => setTab('incidents')} icon={Wrench} label={t.history.incidentsTab} testId="tab-incidents" />
      </div>

      {tab === 'cleaning' && <CleaningHistoryList apartmentId={selectedAptId} canDelete={isAdmin} />}
      {tab === 'incidents' && <IncidentHistoryList apartmentId={selectedAptId} canDelete={isAdmin} />}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label, testId }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${active ? 'border-accent text-accent font-medium' : 'border-transparent text-muted'}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}
