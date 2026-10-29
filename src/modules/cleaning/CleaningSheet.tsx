import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchNorms, fetchStaff } from '@/modules/apartments/api'
import { fetchApartment } from '@/modules/qr/api'
import { WhatsappNotify } from '@/components/WhatsappNotify'
import { useNotifyContacts, cleaningMessage } from '@/lib/whatsappNotify'
import { completeCleaning, queueCleaningOffline, isNetworkError } from '@/modules/cleaning/api'
import { useAuth } from '@/modules/core/store'
import type { SvNorm, SvStaff, NormType, CleaningResult } from '@/lib/database.types'
import { useI18n, currentDict } from '@/i18n'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { friendlyMessage } from '@/lib/errors'
import { formatQty } from '@/lib/format'
import { validateCleaningMedia, isVideoFile, isHeicFile } from '@/lib/files'
import { compressImage } from '@/lib/compress'
import { X, Check, Loader as Loader2, TriangleAlert as AlertTriangle, Star, RefreshCw, Camera, Video as VideoIcon } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'

const writeoffTypes: NormType[] = ['turnover_replenish', 'cleaning_consumption']
const MAX_MEDIA = 6
const MAX_TOTAL_MEDIA_SIZE = 150 * 1024 * 1024

export function CleaningSheet({ backTo }: { backTo?: string }) {
  const { t, n } = useI18n()
  const { itemName } = useCatalogName()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile = useAuth((s) => s.profile)
  const notifyContacts = useNotifyContacts()
  const [notifyText, setNotifyText] = useState<string | null>(null)
  const aptId = Number(id)
  const goBack = useCallback(() => navigate(backTo ?? `/sv/apartments/${aptId}`), [navigate, backTo, aptId])
  const [norms, setNorms] = useState<SvNorm[]>([])
  const [staff, setStaff] = useState<SvStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<number[]>([])
  const [leadStaffId, setLeadStaffId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [media, setMedia] = useState<File[]>([])
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CleaningResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [goBackTimer, setGoBackTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [converting, setConverting] = useState(false)
  const clientOpIdRef = useRef<string>(crypto.randomUUID())
  const submittedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewsRef = useRef<string[]>([])

  const hasUnsavedInput = selectedStaff.length > 0 || note.trim().length > 0 || media.length > 0

  const handleBackdropClick = () => {
    if (hasUnsavedInput) setConfirmClose(true)
    else goBack()
  }

  const loadReferenceData = async () => {
    if (!aptId || !profile) return
    setLoading(true)
    setLoadError(null)
    try {
      const [nr, s] = await Promise.all([fetchNorms(profile.id, aptId), fetchStaff(profile.id)])
      setNorms(nr)
      setStaff(s)
    } catch (e) {
      setLoadError(friendlyMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReferenceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aptId, profile?.id])

  useEffect(() => {
    if (loading) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goBack()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [loading, goBack])

  useEffect(() => {
    previewsRef.current = mediaPreviews
  }, [mediaPreviews])

  useEffect(() => {
    return () => {
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    return () => {
      if (goBackTimer) clearTimeout(goBackTimer)
    }
  }, [goBackTimer])

  const writeoffItems = useMemo(() => norms.filter((nr) => writeoffTypes.includes(nr.norm_type) && nr.qty > 0), [norms])
  const needsStaff = writeoffItems.length > 0

  const toggleStaff = (staffId: number) => {
    setSelectedStaff((prev) => {
      if (prev.includes(staffId)) {
        const next = prev.filter((s) => s !== staffId)
        if (leadStaffId === staffId) setLeadStaffId(next[0] ?? null)
        return next
      }
      const next = [...prev, staffId]
      if (next.length === 1) setLeadStaffId(staffId)
      return next
    })
  }

  const setLead = (staffId: number) => { if (selectedStaff.includes(staffId)) setLeadStaffId(staffId) }

  const currentTotalSize = media.reduce((sum, f) => sum + f.size, 0)

  const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (incoming.length === 0) return
    const remaining = MAX_MEDIA - media.length
    if (remaining <= 0) {
      setError(currentDict().cleaning.mediaTooMany)
      return
    }
    const d = currentDict().cleaning
    const valid: File[] = []
    let hadError = false
    let runningTotal = currentTotalSize

    if (incoming.length > remaining) {
      setError(d.mediaTooMany)
      hadError = true
    }

    for (const file of incoming.slice(0, remaining)) {
      if (isHeicFile(file)) {
        setConverting(true)
        try {
          const converted = await compressImage(file)
          const convertedFile = new File([converted], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
          if (runningTotal + convertedFile.size > MAX_TOTAL_MEDIA_SIZE) {
            setError(d.mediaTotalTooBig)
            hadError = true
            continue
          }
          runningTotal += convertedFile.size
          valid.push(convertedFile)
        } catch {
          setError(currentDict().heicNotSupported)
          hadError = true
        } finally {
          setConverting(false)
        }
        continue
      }
      const err = validateCleaningMedia(file)
      if (err) {
        setError(err)
        hadError = true
        continue
      }
      if (runningTotal + file.size > MAX_TOTAL_MEDIA_SIZE) {
        setError(d.mediaTotalTooBig)
        hadError = true
        continue
      }
      runningTotal += file.size
      valid.push(file)
    }

    if (valid.length > 0) {
      if (!hadError) setError(null)
      setMedia((prev) => [...prev, ...valid])
      setMediaPreviews((prev) => [...prev, ...valid.map((f) => URL.createObjectURL(f))])
    }
  }

  const removeMedia = (idx: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== idx))
    setMediaPreviews((prev) => {
      const url = prev[idx]
      if (url) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const handleConfirm = async () => {
    if (submittedRef.current) return
    if (needsStaff && selectedStaff.length === 0) { setError(t.cleaning.needLead); return }
    if (!profile) return
    submittedRef.current = true
    setSubmitting(true)
    setError(null)
    const cleanedAt = new Date().toISOString()
    const params = {
      userId: profile.id,
      apartmentId: aptId,
      cleanedAt,
      clientOpId: clientOpIdRef.current,
      staffIds: selectedStaff,
      leadStaffId: leadStaffId ?? selectedStaff[0] ?? null,
      note: note.trim() || null,
      media: media.length > 0 ? media : undefined,
    }
    try {
      if (!navigator.onLine) {
        await queueCleaningOffline(params)
        setOffline(true)
        const timer = setTimeout(() => goBack(), 1500)
        setGoBackTimer(timer)
        return
      }
      const res = await completeCleaning(params)
      setResult(res)
      if (res.duplicate) setError(t.cleaning.duplicate)
      if (notifyContacts.length > 0 && !res.duplicate) {
        const apt = await fetchApartment(aptId).catch(() => null)
        setNotifyText(cleaningMessage({
          code: apt?.code ?? `#${aptId}`,
          building: apt?.building,
          author: profile?.full_name ?? null,
          staff: staff.filter((st) => selectedStaff.includes(st.id)).map((st) => st.full_name),
          note: note.trim() || null,
          pending: !!res.pending,
        }))
      } else {
        const timer = setTimeout(() => goBack(), res.pending ? 2500 : 1200)
        setGoBackTimer(timer)
      }
    } catch (e) {
      if (isNetworkError(e)) {
        try {
          await queueCleaningOffline(params)
          setOffline(true)
          const timer = setTimeout(() => goBack(), 1500)
          setGoBackTimer(timer)
        } catch (nestedErr) {
          setError(friendlyMessage(nestedErr))
        }
      } else {
        setError(friendlyMessage(e))
        submittedRef.current = false
      }
    } finally { setSubmitting(false) }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Loader2 className="w-6 h-6 text-white animate-spin" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex flex-col justify-end anim-scrim" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label={t.cleaning.title}>
      <div className="bg-surface rounded-t-2xl max-h-[90dvh] overflow-y-auto anim-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--line)' }} />
        </div>
        <div className="px-5 py-3 flex items-center justify-between border-b border-line">
          <h2 className="text-base font-semibold text-ink">{t.cleaning.title}</h2>
          <button onClick={goBack} className="p-2.5 -mr-1 rounded-lg hover:bg-app transition-colors" aria-label={t.common.close}>
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {loadError && (
            <div className="flex items-start gap-2 bg-warn-soft border border-line rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
              <p className="text-sm text-warn flex-1">{loadError}</p>
              <button onClick={loadReferenceData} className="flex items-center gap-1 text-xs text-warn font-medium shrink-0 min-h-[44px] px-3 rounded-lg hover:bg-warn-soft/50 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
                {t.retry}
              </button>
            </div>
          )}
          {needsStaff && (
            <div>
              <label className="block text-sm font-medium text-ink mb-2">{t.cleaning.whoCleaned}</label>
              <p className="text-xs text-muted mb-2">{t.cleaning.whoCleanedHint}</p>
              <div className="space-y-2">
                {staff.map((s) => {
                  const selected = selectedStaff.includes(s.id)
                  const isLead = leadStaffId === s.id
                  return (
                    <div key={s.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${selected ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                      <button onClick={() => toggleStaff(s.id)} aria-label={s.full_name} aria-pressed={selected} className="min-w-11 min-h-11 flex items-center justify-center shrink-0 -ml-2.5 transition-colors">
                        <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${selected ? 'border-accent bg-accent' : 'border-[var(--line)]'}`}>
                          {selected && <Check className="w-4 h-4 text-white" />}
                        </span>
                      </button>
                      <span className="flex-1 text-sm text-ink">{s.full_name}</span>
                      {selected && (
                        <button onClick={() => setLead(s.id)} aria-pressed={isLead} aria-label={`${t.cleaning.leadStaff}: ${s.full_name}`} className={`flex items-center gap-1 text-xs px-3 py-2 rounded-full transition-colors min-h-[44px] ${isLead ? 'bg-warn-soft text-warn' : 'text-muted hover:text-warn'}`}>
                          <Star className={`w-3 h-3 ${isLead ? 'fill-[var(--warn)]' : ''}`} />
                          {t.cleaning.leadStaff}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-ink mb-2">{t.cleaning.writeoff}</label>
            {writeoffItems.length === 0 ? (
              <p className="text-sm text-muted">{t.cleaning.noWriteoff}</p>
            ) : (
              <div className="bg-app rounded-xl border border-line divide-y divide-[var(--line)]">
                {writeoffItems.map((nr) => (
                  <div key={`${nr.item_id}-${nr.norm_type}`} className="px-3 py-2.5 flex items-center justify-between">
                    <span className="text-sm text-ink">{itemName(nr.item_name)}</span>
                    <span className="text-sm text-muted">{n(formatQty(nr.qty, { base_unit: nr.base_unit, pack_size: nr.pack_size, pack_label: nr.pack_label }))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">{t.cleaning.note}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.cleaning.notePlaceholder} rows={2}
              className="w-full bg-app rounded-xl px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">{t.cleaning.media}</label>
            <div className="flex gap-2 flex-wrap">
              {mediaPreviews.map((src, idx) => {
                const file = media[idx]
                const isVideo = file ? isVideoFile(file) : false
                return (
                  <div key={idx} className="relative w-20 h-20">
                    {isVideo ? (
                      <div className="w-full h-full bg-app rounded-xl border border-line flex items-center justify-center">
                        <VideoIcon className="w-6 h-6 text-muted" />
                      </div>
                    ) : (
                      <img src={src} alt="" className="w-full h-full object-cover rounded-xl" />
                    )}
                    <button onClick={() => removeMedia(idx)} className="absolute -top-1 -right-1 w-5 h-5 bg-bad text-white rounded-full flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
              {converting && (
                <div className="w-20 h-20 border-2 border-dashed border-line rounded-xl flex items-center justify-center text-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              {media.length < MAX_MEDIA && !converting && (
                <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-line rounded-xl flex items-center justify-center text-muted hover:border-accent">
                  <Camera className="w-6 h-6" />
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,video/mp4,video/quicktime,video/webm,.mov,.webm,.heic,.heif" multiple onChange={handleMediaSelect} className="hidden" />
          </div>
          {error && (
            <div className="flex items-start gap-2 bg-bad-soft border border-line rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-bad mt-0.5 shrink-0" />
              <p className="text-sm text-bad">{error}</p>
            </div>
          )}
          {result && !result.duplicate && (
            <div className="flex items-center gap-2 bg-ok-soft border border-line rounded-xl px-3 py-2.5">
              <Check className="w-4 h-4 text-ok" />
              <p className="text-sm text-ok">{result.pending ? t.cleaning.pendingApproval : t.cleaning.success}</p>
            </div>
          )}
          {offline && (
            <div className="flex items-center gap-2 bg-warn-soft border border-line rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-warn" />
              <p className="text-sm text-warn">{t.cleaning.pending}</p>
            </div>
          )}
          {notifyText && <WhatsappNotify contacts={notifyContacts} text={notifyText} />}
          {result?.shortages && result.shortages.length > 0 && (
            <div className="bg-warn-soft border border-line rounded-xl px-3 py-2.5">
              <p className="text-sm font-medium text-warn mb-1">{t.cleaning.shortages}</p>
              {result.shortages.map((s) => <p key={s.item_id} className="text-xs text-warn">{itemName(s.item)}: {n(String(s.balance))}</p>)}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-surface border-t border-line px-5 py-3 flex gap-3">
          {notifyText ? (
            <button onClick={goBack} className="flex-1 bg-accent text-white rounded-xl py-3.5 min-h-[48px] font-medium">{t.notify.done}</button>
          ) : (<>
          <button onClick={goBack} className="flex-1 bg-app text-ink rounded-xl py-3.5 min-h-[48px] font-medium">{t.cleaning.cancel}</button>
          <button
            onClick={handleConfirm}
            disabled={submitting || converting || (needsStaff && selectedStaff.length === 0) || (!!loadError && norms.length === 0)}
            className="flex-1 bg-accent text-white rounded-xl py-3.5 min-h-[48px] font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t.cleaning.confirm}
          </button>
          </>)}
        </div>
      </div>
      {confirmClose && (
        <ConfirmDialog
          open={true}
          title={t.cleaning.cancel}
          message={t.cleaning.confirmClose}
          onConfirm={() => { setConfirmClose(false); goBack() }}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  )
}
