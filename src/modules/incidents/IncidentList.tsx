import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchMyIncidents } from '@/modules/incidents/api'
import { fetchApartments } from '@/modules/apartments/api'
import { useAuth } from '@/modules/core/store'
import type { Incident, SvApartment, IncidentStatus, IncidentKind } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { friendlyMessage } from '@/lib/errors'
import { ErrorState } from '@/components/ErrorState'
import { Plus, Wrench, Package, CircleAlert as AlertCircle, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { IncidentDetailModal, fetchProfileName } from '@/modules/incidents/IncidentDetailModal'
import { useLiveRefresh } from '@/lib/realtime'

const statusColors: Record<IncidentStatus, string> = {
  new: 'bg-warn-soft text-warn',
  in_progress: 'bg-accent-soft text-accent',
  confirmed: 'bg-ok-soft text-ok',
  rejected: 'bg-bad-soft text-bad',
}

const kindIcons: Record<IncidentKind, React.ComponentType<{ className?: string }>> = {
  breakdown: Wrench,
  broken: AlertCircle,
  damaged: AlertCircle,
  lost: Package,
  other: AlertCircle,
}

export function IncidentList() {
  const { t, n } = useI18n()
  const statusLabels: Record<IncidentStatus, string> = {
    new: t.incidents.statusNew,
    in_progress: t.incidents.statusInProgress,
    confirmed: t.incidents.statusConfirmed,
    rejected: t.incidents.statusRejected,
  }
  const kindLabels: Record<IncidentKind, string> = {
    breakdown: t.incidents.kindBreakdown,
    broken: t.incidents.kindBroken,
    damaged: t.incidents.kindDamaged,
    lost: t.incidents.kindLost,
    other: t.incidents.kindOther,
  }
  const navigate = useNavigate()
  const profile = useAuth((s) => s.profile)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [apartments, setApartments] = useState<SvApartment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Incident | null>(null)

  const loadAll = (silent?: boolean) => {
    if (!profile) return
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    Promise.all([fetchMyIncidents(profile.id), fetchApartments(profile.id)])
      .then(([inc, apts]) => { setIncidents(inc); setApartments(apts) })
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])
  useLiveRefresh(['incidents', 'apartments'], () => loadAll(true))

  const aptMap = new Map(apartments.map((a) => [a.id, a.code]))

  return (
    <div className="px-4 pt-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.incidents.myIncidents}</h1>
        <button onClick={() => navigate('/sv/incidents/new')} className="bg-accent text-white rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          {t.incidents.title}
        </button>
      </div>
      {loading ? (
        <p className="text-center text-muted mt-8">{t.app.loading}</p>
      ) : loadError ? (
        <ErrorState onRetry={loadAll} />
      ) : incidents.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-16 text-muted">
          <Wrench className="w-10 h-10 mb-3" />
          <p className="text-sm">{t.incidents.noIncidents}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => {
            const Icon = kindIcons[inc.kind]
            const hasPhotos = inc.photo_paths.length > 0
            return (
              <button
                key={inc.id}
                onClick={() => setSelected(inc)}
                className="w-full text-left bg-surface rounded-xl border border-line px-4 py-3 transition-colors hover:bg-app active:bg-app"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-app rounded-lg flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-ink">{aptMap.get(inc.apartment_id) ?? `#${n(String(inc.apartment_id))}`}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[inc.status]}`}>{statusLabels[inc.status]}</span>
                    </div>
                    <p className="text-sm text-ink line-clamp-2">{inc.item_id ? `#${n(String(inc.item_id))}` : inc.free_text ?? '—'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted">{kindLabels[inc.kind]}</span>
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted">{n(String(inc.qty))} {t.common.units.pcs}</span>
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted">{n(formatDateTime(inc.created_at))}</span>
                    </div>
                    {inc.comment && <p className="text-xs text-muted mt-1.5 bg-app rounded-lg px-2.5 py-1.5 line-clamp-2">{inc.comment}</p>}
                    {hasPhotos && (
                      <div className="flex items-center gap-1 mt-1.5 text-xs text-muted">
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>{inc.photo_paths.length}</span>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted shrink-0 mt-1" />
                </div>
              </button>
            )
          })}
        </div>
      )}
      {selected && (
        <IncidentDetailModalWithNames
          incident={selected}
          apartmentCode={aptMap.get(selected.apartment_id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function IncidentDetailModalWithNames({
  incident,
  apartmentCode,
  onClose,
}: {
  incident: Incident
  apartmentCode?: string
  onClose: () => void
}) {
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [resolverName, setResolverName] = useState<string | null>(null)

  useEffect(() => {
    if (incident.created_by) fetchProfileName(incident.created_by).then(setAuthorName)
    if (incident.resolved_by) fetchProfileName(incident.resolved_by).then(setResolverName)
  }, [incident.created_by, incident.resolved_by])

  return (
    <IncidentDetailModal
      incident={incident}
      apartmentCode={apartmentCode}
      authorName={authorName}
      resolverName={resolverName}
      onClose={onClose}
    />
  )
}
