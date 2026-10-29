import { useState, useEffect, useCallback } from 'react'
import { Loader as Loader2, X, Trash2, Camera, Video, RotateCcw } from 'lucide-react'

import { useI18n } from '@/i18n'
import { formatDateTime, formatQty } from '@/lib/format'
import { friendlyMessage, toApiError } from '@/lib/errors'
import { toast, errorMessage } from '@/lib/toast'
import { MediaViewer } from './MediaViewer'
import { fetchCleaningLines, deleteCleaningEvent, removeStorageFiles } from './api'
import type { SvCleaningEventRow, SvCleaningEventLineRow } from './types'
import type { NormType } from '@/lib/database.types'

interface Props {
  event: SvCleaningEventRow
  canDelete: boolean
  onClose: () => void
  onDeleted: () => void
  onRecalculate?: (eventId: string) => void
  onReverse?: (eventId: string) => void
}

function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'mp4' || ext === 'mov' || ext === 'webm'
}

export function CleaningDetailSheet({ event, canDelete, onClose, onDeleted, onRecalculate, onReverse }: Props) {
  const { t, n } = useI18n()
  const [lines, setLines] = useState<SvCleaningEventLineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showMedia, setShowMedia] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  const loadLines = useCallback(async () => {
    setLoading(true)
    try {
      setLines(await fetchCleaningLines(event.id))
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [event.id])

  useEffect(() => { loadLines() }, [loadLines])

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

  const normTypeLabels: Record<NormType, string> = {
    asset_standing: t.apartments.normInventory,
    turnover_replenish: t.apartments.normTurnover,
    cleaning_consumption: t.apartments.normCleaning,
  }

  const mediaPaths = event.media_paths ?? []
  const photoCount = mediaPaths.filter((p) => !isVideoPath(p)).length
  const videoCount = mediaPaths.filter((p) => isVideoPath(p)).length

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const paths = await deleteCleaningEvent(event.id, reason.trim())
      if (paths.length > 0) {
        try { await removeStorageFiles('cleaning-media', paths) }
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
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[65] anim-scrim" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-[440px] bg-surface z-[66] overflow-auto border-l border-line anim-drawer" data-testid="cleaning-detail">
        <div className="sticky top-0 bg-surface border-b border-line px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">{t.history.cleaningDetail}</h2>
          <button onClick={onClose} className="p-2 -mr-1 rounded-lg hover:bg-app"><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <span className="text-sm font-medium text-ink">{n(formatDateTime(event.cleaned_at))}</span>
            {event.status === 'done' && event.posting_status === 'pending' ? (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-warn-soft text-warn">
                {t.admin.apartments.pendingApproval}
              </span>
            ) : (
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${event.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
                {event.status === 'done' ? t.admin.apartments.done : t.admin.apartments.reversed}
              </span>
            )}
          </div>
          {event.author_name && <DetailRow label={t.qr.detailAuthor} value={event.author_name} />}
          {event.lead_staff_name && <DetailRow label={t.cleaning.leadStaff} value={event.lead_staff_name} />}
          {event.staff_names && <DetailRow label={t.qr.detailStaff} value={event.staff_names} />}
          <DetailRow label={t.admin.apartments.revision} value={n(String(event.revision))} />
          {event.note && <DetailRow label={t.qr.detailNote} value={event.note} />}
          {event.status === 'reversed' && event.reverse_reason && (
            <DetailRow label={t.admin.apartments.reverseReason} value={event.reverse_reason} />
          )}
          {event.reversed_at && <DetailRow label={t.qr.detailDate} value={n(formatDateTime(event.reversed_at))} />}
          {event.reversed_by_name && <DetailRow label={t.history.reversedBy} value={event.reversed_by_name} />}

          {loading ? (
            <div className="py-4 text-center"><Loader2 className="w-5 h-5 text-muted animate-spin mx-auto" /></div>
          ) : lines.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t.history.items}</h3>
              <div className="bg-app rounded-xl border border-line divide-y divide-[var(--line)]">
                {lines.map((line) => (
                  <div key={`${line.event_id}-${line.item_id}`} className="px-3 py-2.5 flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="text-sm text-ink">{line.item_name ?? `#${line.item_id}`}</span>
                      <span className="text-xs text-muted block">{normTypeLabels[line.norm_type]}</span>
                    </div>
                    <span className="text-sm text-muted shrink-0">
                      {n(formatQty(line.qty, { base_unit: line.base_unit, pack_size: 1, pack_label: '' }))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
              data-testid="cleaning-delete-btn"
              className="w-full bg-bad-soft text-bad rounded-xl py-3 font-medium text-sm flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {t.history.delete}
            </button>
          )}

          {event.status === 'done' && event.posting_status !== 'pending' && onRecalculate && (
            <button
              onClick={() => onRecalculate(event.id)}
              className="w-full bg-app text-ink rounded-xl py-3 font-medium text-sm flex items-center justify-center gap-2 border border-line"
            >
              <RotateCcw className="w-4 h-4" />
              {t.admin.apartments.recalculate}
            </button>
          )}

          {event.status === 'done' && onReverse && (
            <button
              onClick={() => onReverse(event.id)}
              className="w-full bg-bad-soft text-bad rounded-xl py-3 font-medium text-sm flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {t.admin.apartments.reverse}
            </button>
          )}
        </div>
      </aside>

      {showMedia && mediaPaths.length > 0 && (
        <MediaViewer bucket="cleaning-media" paths={mediaPaths} onClose={() => setShowMedia(false)} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/45 z-[75] flex items-center justify-center anim-scrim" onClick={() => { setConfirmDelete(false); setReason('') }}>
          <div className="bg-surface rounded-2xl p-5 max-w-sm w-full mx-4 border border-line" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-warn mb-3">{t.history.deleteWarning}</p>
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
