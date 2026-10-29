import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, X, Loader as Loader2, Camera, Video } from 'lucide-react'
import { useI18n } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { friendlyMessage } from '@/lib/errors'
import { ErrorState } from '@/components/ErrorState'
import { MediaViewer } from '@/modules/history/MediaViewer'
import { useLiveRefresh } from '@/lib/realtime'
import {
  fetchApartmentsAdmin,
  fetchPendingCleanings,
  fetchCleaningPreview,
  fetchStaffNames,
  approveCleaning,
  type PendingCleaning,
  type CleaningPreviewLine,
} from '@/modules/admin/api'
import { fetchProfileName } from '@/modules/incidents/IncidentDetailModal'
import type { Apartment } from '@/lib/database.types'

function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'mp4' || ext === 'mov' || ext === 'webm'
}

export function AdminCleaningApprovals() {
  const { t, n } = useI18n()
  const [items, setItems] = useState<PendingCleaning[]>([])
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [staff, setStaff] = useState<Map<number, string>>(new Map())
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [previews, setPreviews] = useState<Map<string, CleaningPreviewLine[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [action, setAction] = useState<{ item: PendingCleaning; decision: 'confirm' | 'reject' } | null>(null)
  const [note, setNote] = useState('')
  const [processing, setProcessing] = useState(false)
  const [viewerPaths, setViewerPaths] = useState<string[] | null>(null)

  const load = useCallback((silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    Promise.all([fetchPendingCleanings(), fetchApartmentsAdmin(), fetchStaffNames()])
      .then(async ([list, apts, staffNames]) => {
        setItems(list)
        setApartments(apts)
        setStaff(staffNames)
        const userIds = Array.from(new Set(list.map((i) => i.created_by).filter((x): x is string => !!x)))
        const [names, preview] = await Promise.all([
          Promise.all(userIds.map(async (id) => [id, await fetchProfileName(id)] as const)),
          Promise.all(list.map(async (i) => {
            const lines = await fetchCleaningPreview(i.id).catch((): CleaningPreviewLine[] => [])
            return [i.id, lines] as const
          })),
        ])
        const nameMap = new Map<string, string>()
        for (const [id, name] of names) if (name) nameMap.set(id, name)
        setAuthors(nameMap)
        setPreviews(new Map<string, CleaningPreviewLine[]>(preview))
      })
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  useLiveRefresh(['cleaning_events', 'apartments', 'staff'], () => load(true))

  const aptMap = useMemo(() => new Map(apartments.map((a) => [a.id, a.code])), [apartments])

  const handleAction = async () => {
    if (!action) return
    setProcessing(true)
    try {
      const res = await approveCleaning(action.item.id, action.decision, note.trim() || null)
      toast(action.decision === 'confirm' ? t.admin.approvals.confirmed : t.admin.approvals.rejected, 'success')
      if (res.shortages && res.shortages.length > 0) {
        toast(`${t.admin.approvals.shortages}: ${res.shortages.map((s) => s.item).join(', ')}`, 'info')
      }
      setAction(null)
      setNote('')
      load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setProcessing(false)
    }
  }

  if (loadError) return <ErrorState onRetry={load} />

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.approvals.title}</h1>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted text-center py-10">{t.admin.approvals.empty}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const lines = previews.get(item.id) ?? []
            const author = item.created_by ? authors.get(item.created_by) : undefined
            const cleaner = item.lead_staff_id != null ? staff.get(item.lead_staff_id) : undefined
            return (
              <div key={item.id} className="bg-surface rounded-xl border border-line p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-base font-semibold text-ink">{aptMap.get(item.apartment_id) ?? `#${item.apartment_id}`}</span>
                  <span className="text-xs text-muted">{formatDateTime(item.cleaned_at)}</span>
                </div>
                {cleaner && <p className="text-sm text-ink">{t.admin.approvals.cleanedBy}: {cleaner}</p>}
                {author && <p className="text-xs text-muted">{t.admin.approvals.submittedBy}: {author}</p>}
                {item.note && <p className="text-sm text-ink mt-2">{item.note}</p>}

                {(item.media_paths?.length ?? 0) > 0 && (
                  <button
                    onClick={() => setViewerPaths(item.media_paths)}
                    className="mt-3 w-full flex items-center gap-3 bg-app rounded-lg px-3 py-2 min-h-[44px] text-left"
                  >
                    <span className="flex items-center gap-1 text-muted">
                      <Camera className="w-4 h-4" /><Video className="w-4 h-4" />
                    </span>
                    <span className="text-sm text-ink">
                      {t.qr.detailPhotos}: {(item.media_paths ?? []).filter((p) => !isVideoPath(p)).length} {t.qr.photo} / {(item.media_paths ?? []).filter(isVideoPath).length} {t.qr.video}
                    </span>
                  </button>
                )}

                <div className="mt-3 bg-app rounded-lg px-3 py-2">
                  <p className="text-xs font-medium text-muted mb-1">{t.admin.approvals.willWriteOff}</p>
                  {lines.length === 0 ? (
                    <p className="text-xs text-muted">{t.admin.approvals.noMaterials}</p>
                  ) : (
                    lines.map((l) => (
                      <p key={`${l.norm_type}-${l.item_id}`} className="text-sm text-ink">{l.item}: {n(String(l.qty))}</p>
                    ))
                  )}
                </div>

                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => { setNote(''); setAction({ item, decision: 'reject' }) }}
                    className="flex-1 bg-bad-soft text-bad rounded-xl py-2.5 min-h-[44px] text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />{t.admin.approvals.reject}
                  </button>
                  <button
                    onClick={() => { setNote(''); setAction({ item, decision: 'confirm' }) }}
                    className="flex-1 bg-ok text-white rounded-xl py-2.5 min-h-[44px] text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />{t.admin.approvals.confirm}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewerPaths && viewerPaths.length > 0 && (
        <MediaViewer bucket="cleaning-media" paths={viewerPaths} onClose={() => setViewerPaths(null)} />
      )}

      {action && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
          <div className="bg-surface border border-line rounded-2xl w-full max-w-sm p-5">
            <h3 className="text-base font-semibold text-ink mb-4">
              {action.decision === 'confirm' ? t.admin.approvals.confirmTitle : t.admin.approvals.rejectTitle}
            </h3>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.admin.approvals.notePlaceholder}
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none mb-3"
            />
            <div className="flex gap-3">
              <button onClick={() => setAction(null)} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
              <button
                onClick={handleAction}
                disabled={processing}
                className={`flex-1 text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2 ${action.decision === 'confirm' ? 'bg-ok' : 'bg-bad'}`}
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {action.decision === 'confirm' ? t.admin.approvals.confirm : t.admin.approvals.reject}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
