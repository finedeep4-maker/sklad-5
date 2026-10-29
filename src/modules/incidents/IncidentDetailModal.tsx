import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { createSignedUrls } from '@/modules/qr/api'
import { useI18n } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { X, Wrench, Package, CircleAlert as AlertCircle, Image as ImageIcon } from 'lucide-react'
import type { Incident, IncidentKind, IncidentStatus } from '@/lib/database.types'
import { friendlyMessage } from '@/lib/errors'

const kindIcons: Record<IncidentKind, React.ComponentType<{ className?: string }>> = {
  breakdown: Wrench,
  broken: AlertCircle,
  damaged: AlertCircle,
  lost: Package,
  other: AlertCircle,
}

const statusColors: Record<IncidentStatus, string> = {
  new: 'bg-warn-soft text-warn',
  in_progress: 'bg-accent-soft text-accent',
  confirmed: 'bg-ok-soft text-ok',
  rejected: 'bg-bad-soft text-bad',
}

function kindLabel(kind: IncidentKind, t: ReturnType<typeof useI18n>['t']): string {
  switch (kind) {
    case 'breakdown': return t.incidents.kindBreakdown
    case 'broken': return t.incidents.kindBroken
    case 'damaged': return t.incidents.kindDamaged
    case 'lost': return t.incidents.kindLost
    default: return t.incidents.kindOther
  }
}

function statusLabel(status: IncidentStatus, t: ReturnType<typeof useI18n>['t']): string {
  switch (status) {
    case 'new': return t.incidents.statusNew
    case 'in_progress': return t.incidents.statusInProgress
    case 'confirmed': return t.incidents.statusConfirmed
    default: return t.incidents.statusRejected
  }
}

function isFileImage(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')
}

export interface IncidentDetailModalProps {
  incident: Incident
  apartmentCode?: string
  authorName?: string | null
  resolverName?: string | null
  onClose: () => void
}

export function IncidentDetailModal({
  incident,
  apartmentCode,
  authorName,
  resolverName,
  onClose,
}: IncidentDetailModalProps) {
  const { t, n } = useI18n()
  const [fileUrls, setFileUrls] = useState<Map<string, string>>(new Map())
  const [urlError, setUrlError] = useState<string | null>(null)
  const Icon = kindIcons[incident.kind]

  useEffect(() => {
    if (incident.photo_paths.length === 0) return
    let cancelled = false
    setUrlError(null)
    createSignedUrls(incident.photo_paths)
      .then((urls) => { if (!cancelled) setFileUrls(urls) })
      .catch((e) => { if (!cancelled) setUrlError(friendlyMessage(e)) })
    return () => { cancelled = true }
  }, [incident.photo_paths])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 anim-scrim" onClick={onClose} />
      <div className="relative bg-surface w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line anim-drawer">
        <div className="sticky top-0 bg-surface border-b border-line px-4 py-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{t.qr.incidentsTab}</h3>
          <button onClick={onClose} className="p-1 -mr-1">
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-app rounded-lg flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-ink">{kindLabel(incident.kind, t)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 ${statusColors[incident.status]}`}>
                {statusLabel(incident.status, t)}
              </span>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-line">
            {apartmentCode && (
              <div>
                <span className="text-xs text-muted block mb-0.5">{t.qr.detailApartment}</span>
                <span className="text-sm text-ink">{apartmentCode}</span>
              </div>
            )}
            <div>
              <span className="text-xs text-muted block mb-0.5">{t.qr.detailDate}</span>
              <span className="text-sm text-ink">{n(formatDateTime(incident.created_at))}</span>
            </div>
            {authorName && (
              <div>
                <span className="text-xs text-muted block mb-0.5">{t.qr.detailAuthor}</span>
                <span className="text-sm text-ink">{authorName}</span>
              </div>
            )}
            {incident.free_text && (
              <div>
                <span className="text-xs text-muted block mb-0.5">{t.qr.detailItem}</span>
                <span className="text-sm text-ink">{incident.free_text}</span>
              </div>
            )}
            <div>
              <span className="text-xs text-muted block mb-0.5">{t.qr.detailQty}</span>
              <span className="text-sm text-ink">{n(String(incident.qty))} {t.common.units.pcs}</span>
            </div>
            {incident.comment && (
              <div>
                <span className="text-xs text-muted block mb-0.5">{t.qr.detailComment}</span>
                <span className="text-sm text-ink whitespace-pre-wrap">{incident.comment}</span>
              </div>
            )}
          </div>

          {incident.photo_paths.length > 0 && (
            <div className="pt-2 border-t border-line">
              <span className="text-xs text-muted block mb-1.5">{t.qr.detailPhotos}</span>
              {urlError && <p className="text-xs text-bad mb-2">{urlError}</p>}
              <div className="space-y-2">
                {incident.photo_paths.map((path) => {
                  const url = fileUrls.get(path)
                  const isImg = isFileImage(path)
                  return (
                    <div key={path}>
                      {url && isImg && <img src={url} alt="" className="rounded-xl w-full max-h-96 object-contain bg-app" />}
                      {url && !isImg && <video src={url} controls className="rounded-xl w-full max-h-96" />}
                      {!url && (
                        <div className="rounded-xl w-full h-32 bg-app flex items-center justify-center">
                          <ImageIcon className="w-6 h-6 text-muted" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {(incident.resolved_at || incident.resolution_note || resolverName) && (
            <div className="space-y-2 pt-2 border-t border-line">
              {resolverName && (
                <div>
                  <span className="text-xs text-muted block mb-0.5">{t.qr.detailResolvedBy}</span>
                  <span className="text-sm text-ink">{resolverName}</span>
                </div>
              )}
              {incident.resolved_at && (
                <div>
                  <span className="text-xs text-muted block mb-0.5">{t.qr.detailResolvedAt}</span>
                  <span className="text-sm text-ink">{n(formatDateTime(incident.resolved_at))}</span>
                </div>
              )}
              {incident.resolution_note && (
                <div>
                  <span className="text-xs text-muted block mb-0.5">{t.qr.detailResolutionNote}</span>
                  <span className="text-sm text-ink whitespace-pre-wrap">{incident.resolution_note}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export async function fetchProfileName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single()
  if (error) return null
  return data?.full_name ?? null
}
