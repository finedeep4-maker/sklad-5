import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchApartments } from '@/modules/apartments/api'
import { getOutboxSummary, getOutboxEntries, subscribe, flushOutbox, deleteFailedEntry, retryFailedEntry, retryMediaEntry, discardMediaEntry, type OutboxEntry } from '@/lib/outbox'
import type { SvApartment, AptType } from '@/lib/database.types'
import { useAuth } from '@/modules/core/store'
import { useI18n } from '@/i18n'
import { isToday } from '@/lib/format'
import { Search, CircleCheck as CheckCircle2, ChevronRight, RefreshCw, Trash2, TriangleAlert as AlertTriangle } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { friendlyMessage } from '@/lib/errors'
import { useLiveRefresh } from '@/lib/realtime'
import { OwnerBadge } from '@/components/OwnerBadge'

const typeOrder: AptType[] = ['studio', '1br', '2br']

type TypeFilter = 'all' | AptType

export function ApartmentList() {
  const { t, n } = useI18n()
  const typeLabels: Record<AptType, string> = {
    studio: t.apartments.typeStudio,
    '1br': t.apartments.type1br,
    '2br': t.apartments.type2br,
  }
  const navigate = useNavigate()
  const profile = useAuth((s) => s.profile)
  const profileId = profile?.id
  const [apartments, setApartments] = useState<SvApartment[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [mediaFailedCount, setMediaFailedCount] = useState(0)
  const [mediaPendingCount, setMediaPendingCount] = useState(0)
  const [failedEntries, setFailedEntries] = useState<OutboxEntry[]>([])
  const [mediaFailedEntries, setMediaFailedEntries] = useState<OutboxEntry[]>([])
  const [retrying, setRetrying] = useState(false)
  const [confirmMediaDeleteId, setConfirmMediaDeleteId] = useState<string | null>(null)
  const [confirmFailedDeleteId, setConfirmFailedDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!profileId) return
    fetchApartments(profileId)
      .then(setApartments)
      .catch((e) => setLoadError(friendlyMessage(e)))
      .finally(() => setLoading(false))

    const refresh = () => {
      getOutboxSummary(profileId).then((s) => {
        setPendingCount(s.pending)
        setFailedCount(s.failed)
        setMediaFailedCount(s.mediaFailed)
        setMediaPendingCount(s.mediaPending)
      })
      getOutboxEntries(profileId).then((entries) => {
        setFailedEntries(entries.filter((e) => e.status === 'failed'))
        setMediaFailedEntries(entries.filter((e) => (e.mediaStatus ?? 'none') === 'failed'))
      })
    }
    refresh()
    const unsub = subscribe(refresh)
    return unsub
  }, [profileId])

  useLiveRefresh(['apartments', 'cleaning_events', 'norm_rules'], () => {
    if (profile) fetchApartments(profile.id).then(setApartments).catch(() => {})
  })

  const handleRetry = async () => {
    if (!profile) return
    setRetrying(true)
    try {
      await flushOutbox(profile.id)
    } finally {
      setRetrying(false)
    }
  }

  const handleRetryFailed = async (id: string) => {
    await retryFailedEntry(id)
    if (profile) await flushOutbox(profile.id)
  }

  const handleDeleteFailed = async (id: string) => {
    await deleteFailedEntry(id)
    setConfirmFailedDeleteId(null)
  }

  const handleRetryMedia = async (id: string) => {
    await retryMediaEntry(id)
    if (profile) await flushOutbox(profile.id)
  }

  const handleDeleteMedia = async (id: string) => {
    await discardMediaEntry(id)
    setConfirmMediaDeleteId(null)
  }

  const grouped = useMemo(() => {
    const filtered = apartments.filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false
      if (search.trim() && !a.code.toLowerCase().includes(search.toLowerCase().trim())) return false
      return true
    })
    const map = new Map<AptType, SvApartment[]>()
    for (const a of filtered) {
      const list = map.get(a.type) ?? []
      list.push(a)
      map.set(a.type, list)
    }
    return typeOrder
      .filter((tp) => map.has(tp))
      .map((tp) => [tp, map.get(tp)!] as const)
  }, [apartments, search, typeFilter])

  return (
    <div className="px-4 pt-6">
      <div className="flex gap-2.5 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.apartments.search}
            className="w-full bg-surface rounded-xl pl-10 pr-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="bg-surface rounded-xl px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
        >
          <option value="all">{t.apartments.typeAll}</option>
          {typeOrder.map((tp) => (
            <option key={tp} value={tp}>{typeLabels[tp]}</option>
          ))}
        </select>
      </div>

      {(pendingCount > 0 || mediaPendingCount > 0) && (
        <div className="mb-3 bg-warn-soft border border-line rounded-xl px-4 py-2.5 text-sm text-warn flex items-center justify-between">
          <span>{t.errors.outboxQueued}: {n(String(pendingCount))}{mediaPendingCount > 0 ? ` · ${t.errors.outboxMediaPending}: ${n(String(mediaPendingCount))}` : ''}</span>
          <button onClick={handleRetry} disabled={retrying} className="flex items-center gap-1 text-xs font-medium text-warn disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
            {t.errors.outboxRetry}
          </button>
        </div>
      )}

      {mediaFailedCount > 0 && (
        <div className="mb-3 bg-bad-soft border border-line rounded-xl px-4 py-2.5 space-y-2">
          <div className="flex items-center gap-2 text-sm text-bad">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.errors.outboxMediaFailed}: {n(String(mediaFailedCount))}</span>
          </div>
          {mediaFailedEntries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 text-xs text-bad bg-surface rounded-lg px-3 py-2">
              <span className="truncate flex-1">{entry.mediaError ?? 'Error'}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleRetryMedia(entry.id)} disabled={retrying} className="font-medium text-warn disabled:opacity-40">
                  {t.errors.outboxMediaRetry}
                </button>
                <button onClick={() => setConfirmMediaDeleteId(entry.id)} className="font-medium text-bad">
                  {t.errors.outboxMediaDelete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {failedCount > 0 && (
        <div className="mb-3 bg-bad-soft border border-line rounded-xl px-4 py-2.5 space-y-2">
          <div className="flex items-center gap-2 text-sm text-bad">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.errors.outboxFailed}: {n(String(failedCount))}</span>
          </div>
          {failedEntries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 text-xs text-bad bg-surface rounded-lg px-3 py-2">
              <span className="truncate flex-1">{entry.lastError ?? 'Error'}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleRetryFailed(entry.id)} disabled={retrying} className="font-medium text-warn disabled:opacity-40">
                  {t.errors.outboxRetry}
                </button>
                <button onClick={() => setConfirmFailedDeleteId(entry.id)} className="font-medium text-bad">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-center text-muted mt-8">{t.app.loading}</p>
      ) : loadError ? (
        <ErrorState onRetry={() => { if (profile) { setLoading(true); setLoadError(null); fetchApartments(profile.id).then(setApartments).catch((e) => setLoadError(friendlyMessage(e))).finally(() => setLoading(false)) } }} />
      ) : (
        <div className="space-y-6">
          {grouped.map(([type, apts]) => (
            <div key={type}>
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 px-1">
                {typeLabels[type]}
              </h2>
              <div className="space-y-2">
                {apts.map((apt) => {
                  const cleaned = isToday(apt.last_cleaned_at)
                  return (
                    <button
                      key={apt.id}
                      onClick={() => navigate(`/sv/apartments/${apt.id}`)}
                      className="w-full bg-surface rounded-xl px-4 py-3 flex items-center justify-between border border-line hover:border-accent transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-ink">{apt.code}</span>
                        {apt.is_owner && <OwnerBadge />}
                        <span className="text-xs text-muted">{apt.building}</span>
                        {cleaned && (
                          <span className="flex items-center gap-1 text-xs text-ok bg-ok-soft px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            {t.apartments.cleanedToday}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted" />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmMediaDeleteId && (
        <ConfirmDialog
          open={true}
          title={t.errors.outboxMediaDelete}
          message={t.errors.outboxMediaDeleteConfirm}
          onConfirm={() => handleDeleteMedia(confirmMediaDeleteId)}
          onCancel={() => setConfirmMediaDeleteId(null)}
        />
      )}
      {confirmFailedDeleteId && (
        <ConfirmDialog
          open={true}
          title={t.errors.outboxDelete}
          message={t.errors.outboxDeleteConfirm}
          onConfirm={() => handleDeleteFailed(confirmFailedDeleteId)}
          onCancel={() => setConfirmFailedDeleteId(null)}
        />
      )}
    </div>
  )
}
