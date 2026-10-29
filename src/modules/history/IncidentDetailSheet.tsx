import { useState, useEffect, useCallback } from 'react'

import { Loader as Loader2, X, Trash2, Camera, Video } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { formatDateTime } from '@/lib/format'
import { toApiError } from '@/lib/errors'
import { toast, errorMessage } from '@/lib/toast'
import { MediaViewer } from './MediaViewer'
import { deleteIncidentRecord, removeStorageFiles } from './api'
import type { SvApartmentIncidentRow } from './types'
import type { IncidentKind, IncidentStatus } from '@/lib/database.types'

interface Props {
  incident: SvApartmentIncidentRow
  canDelete: boolean
  onClose: () => void
  onDeleted: () => void
}

function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'mp4' || ext === 'mov' || ext === 'webm'
}

export function IncidentDetailSheet({ incident, canDelete, onClose, onDeleted }: Props) {
  const { t, n } = useI18n()
  const { itemName } = useCatalogName()
  const [showMedia, setShowMedia] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  const kindLabels: Record<IncidentKind, string> = {
    breakdown: t.incidents.kindBreakdown,
    broken: t.incidents.kindBroken,
    damaged: t.incidents.kindDamaged,
    lost: t.incidents.kindLost,
    other: t.incidents.kindOther,
  }
  const statusLabels: Record<IncidentStatus, string> = {
    new: t.incidents.statusNew,
    in_progress: t.incidents.statusInProgress,
    confirmed: t.incidents.statusConfirmed,
    rejected: t.incidents.statusRejected,
  }

  const mediaPaths = incident.photo_paths ?? []
  const photoCount = mediaPaths.filter((p) => !isVideoPath(p)).length
  const videoCount = mediaPaths.filter((p) => isVideoPath(p)).length

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showMedia) return
      if (confirmDelete) { setConfirmDelete(false); setReason(''); return }
      onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showMedia, confirmDelete, onClose])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const paths = await deleteIncidentRecord(incident.id, reason.trim())
      if (paths.length > 0) {
        try { await removeStorageFiles('incident-photos', paths) }
        catch { toast(t.history.fileCleanupWarning, 'info') }
      }
      toast(t.history.deleted, 'success')
      setConfirmDelete(false)
      onDeleted()
    } catch (e) {
      const apiError = toApiError(e)
      toast(apiError.code === '42501' ? t.errors.noPrivilege : errorMessage(e), 'error')
    } finally {
      setDeleting(false)
    }
  }, [incident.id, reason, t, onDeleted])

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[65] anim-scrim" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-[440px] bg-surface z-[66] overflow-auto border-l border-line anim-drawer" data-testid="incident-detail">
        <div className="sticky top-0 bg-surface border-b border-line px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">{t.history.incidentDetail}</h2>
          <button onClick={onClose} className="p-2 -mr-1 rounded-lg hover:bg-app"><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <span className="text-sm font-medium text-ink">{n(formatDateTime(incident.created_at))}</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
              incident.status === 'new' ? 'bg-warn-soft text-warn' :
              incident.status === 'in_progress' ? 'bg-accent-soft text-accent' :
              incident.status === 'confirmed' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'
            }`}>
              {statusLabels[incident.status]}
            </span>
          </div>
          {incident.author_name && <DetailRow label={t.qr.detailAuthor} value={incident.author_name} />}
          <DetailRow label={t.qr.detailKind} value={kindLabels[incident.kind]} />
          {incident.item_name && <DetailRow label={t.qr.detailItem} value={itemName(incident.item_name)} />}
          {incident.free_text && <DetailRow label={t.incidents.freeText} value={incident.free_text} />}
          <DetailRow label={t.qr.detailQty} value={n(String(incident.qty))} />
          {incident.comment && <DetailRow label={t.qr.detailComment} value={incident.comment} />}
          {incident.resolved_at && <DetailRow label={t.qr.detailResolvedAt} value={n(formatDateTime(incident.resolved_at))} />}
          {incident.resolved_by_name && <DetailRow label={t.qr.detailResolvedBy} value={incident.resolved_by_name} />}
          {incident.resolution_note && <DetailRow label={t.qr.detailResolutionNote} value={incident.resolution_note} />}

          {mediaPaths.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t.qr.detailPhotos}</h3>
              <button onClick={() => setShowMedia(true)} className="flex gap-2 flex-wrap">
                {mediaPaths.slice(0, 6).map((path) => {
                  const isVideo = isVideoPath(path)
                  return (
                    <div key={path} className="w-20 h-20 bg-app rounded-xl border border-line flex items-center justify-center">
                      {isVideo ? <Video className="w-6 h-6 text-muted" /> : <Camera className="w-6 h-6 text-muted" />}
                    </div>
                  )
                })}
              </button>
              <p className="text-xs text-muted mt-1">{photoCount} {t.qr.photo} / {videoCount} {t.qr.video}</p>
            </div>
          )}

          {canDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              data-testid="incident-delete-btn"
              className="w-full bg-bad-soft text-bad rounded-xl py-3 font-medium text-sm flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {t.history.delete}
            </button>
          )}
        </div>
      </aside>

      {showMedia && mediaPaths.length > 0 && (
        <MediaViewer bucket="incident-photos" paths={mediaPaths} onClose={() => setShowMedia(false)} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/45 z-[75] flex items-center justify-center anim-scrim" onClick={() => { setConfirmDelete(false); setReason('') }}>
          <div className="bg-surface rounded-2xl p-5 max-w-sm w-full mx-4 border border-line" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-muted mb-3">{t.history.deleteWarning}</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.history.deleteReason}
              data-testid="delete-reason"
              rows={3}
              className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none mb-4 resize-none"
            />
            <div className="flex gap-3">
              <button onClick={() => { setConfirmDelete(false); setReason('') }} className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm" disabled={deleting}>
                {t.cleaning.cancel}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || !reason.trim()}
                data-testid="confirm-delete"
                className="flex-1 bg-bad text-white rounded-lg py-3 font-medium text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t.history.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs text-muted shrink-0">{label}:</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  )
}
