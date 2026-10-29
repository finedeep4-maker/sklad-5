import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { History as HistoryIcon, Wrench, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAuth } from '@/modules/core/store'
import { CleaningHistoryList } from '@/modules/history/CleaningHistoryList'
import { IncidentHistoryList } from '@/modules/history/IncidentHistoryList'
import { fetchApartments } from '@/modules/apartments/api'
import { friendlyMessage, toApiError } from '@/lib/errors'
import { ErrorState } from '@/components/ErrorState'
import type { SvApartment } from '@/lib/database.types'

type Tab = 'cleaning' | 'incidents'

export function QrHistoryPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const profile = useAuth((s) => s.profile)
  const profileId = profile?.id
  const validId = id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined
  const [apartment, setApartment] = useState<SvApartment | null>(null)
  const [tab, setTab] = useState<Tab>('cleaning')
  const [loading, setLoading] = useState(validId != null)
  const [error, setError] = useState<string | null>(validId == null ? t.qr.notFound : null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (validId == null || !profileId) return
    setLoading(true)
    setError(null)
    fetchApartments(profileId)
      .then((all) => {
        setApartment(all.find((a) => a.id === validId) ?? null)
      })
      .catch((e) => {
        if (toApiError(e).isNetwork) {
          setOffline(true)
        } else {
          setError(friendlyMessage(e))
        }
      })
      .finally(() => setLoading(false))
  }, [validId, profileId])

  const handleRetry = () => {
    if (validId == null || !profile) return
    setOffline(false)
    setError(null)
    setLoading(true)
    fetchApartments(profile.id)
      .then((all) => {
        setApartment(all.find((a) => a.id === validId) ?? null)
      })
      .catch((e) => {
        if (toApiError(e).isNetwork) {
          setOffline(true)
        } else {
          setError(friendlyMessage(e))
        }
      })
      .finally(() => setLoading(false))
  }

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }

  if (offline) {
    return (
      <div className="px-4 pt-8 text-center">
        <p className="text-sm text-muted mb-4">{t.qr.historyOffline}</p>
        <button
          onClick={handleRetry}
          className="inline-flex items-center gap-2 bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          {t.retry}
        </button>
      </div>
    )
  }

  if (error) {
    return <ErrorState message={error} onRetry={validId == null ? undefined : handleRetry} />
  }

  return (
    <div className="px-4 pt-4 pb-28">
      {apartment && (
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-ink">{apartment.code}</h1>
          <p className="text-xs text-muted">{apartment.building}</p>
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-line">
        <TabButton active={tab === 'cleaning'} onClick={() => setTab('cleaning')} icon={HistoryIcon} label={t.history.cleaningTab} testId="tab-cleaning" />
        <TabButton active={tab === 'incidents'} onClick={() => setTab('incidents')} icon={Wrench} label={t.history.incidentsTab} testId="tab-incidents" />
      </div>

      {tab === 'cleaning' && <CleaningHistoryList apartmentId={validId} canDelete={false} />}
      {tab === 'incidents' && <IncidentHistoryList apartmentId={validId} canDelete={false} />}
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
