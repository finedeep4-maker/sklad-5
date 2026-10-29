import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchApartments, fetchNorms } from '@/modules/apartments/api'
import { fetchItems, createIncident, uploadIncidentPhoto, cleanupPhotos } from '@/modules/incidents/api'
import type { SvApartment, SvItem, SvNorm, IncidentKind } from '@/lib/database.types'
import { useAuth } from '@/modules/core/store'
import { useI18n } from '@/i18n'
import { friendlyMessage } from '@/lib/errors'
import { ErrorState } from '@/components/ErrorState'
import { resolveMime, isHeicFile } from '@/lib/files'
import { compressImage } from '@/lib/compress'
import { currentDict } from '@/i18n'
import { WhatsappNotify } from '@/components/WhatsappNotify'
import { useNotifyContacts, incidentMessage } from '@/lib/whatsappNotify'
import { Camera, Check, Video as VideoIcon, X, Loader as Loader2, TriangleAlert as AlertTriangle } from 'lucide-react'

const MAX_FILES = 6
const MAX_FILE_SIZE = 50 * 1024 * 1024

const ACCEPTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ACCEPTED_VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

function isVideoFile(file: File): boolean {
  const mime = resolveMime(file)
  return !!mime && ACCEPTED_VIDEO_MIMES.has(mime)
}

function validateMediaFile(file: File): string | null {
  const mime = resolveMime(file)
  const d = currentDict().incidents
  if (!mime || (!ACCEPTED_IMAGE_MIMES.has(mime) && !ACCEPTED_VIDEO_MIMES.has(mime))) {
    return d.mediaError
  }
  if (file.size > MAX_FILE_SIZE) return d.mediaTooBig
  return null
}

export function IncidentForm({ backTo }: { backTo?: string }) {
  const { t } = useI18n()
  const kinds: { value: IncidentKind; label: string }[] = [
    { value: 'breakdown', label: t.incidents.kindBreakdown },
    { value: 'broken', label: t.incidents.kindBroken },
    { value: 'damaged', label: t.incidents.kindDamaged },
    { value: 'lost', label: t.incidents.kindLost },
    { value: 'other', label: t.incidents.kindOther },
  ]
  const navigate = useNavigate()
  const notifyContacts = useNotifyContacts()
  const [sentText, setSentText] = useState<string | null>(null)
  const [params] = useSearchParams()
  const preselectApt = params.get('apartment') ?? params.get('apt')
  const profile = useAuth((s) => s.profile)
  const profileId = profile?.id
  const [apartments, setApartments] = useState<SvApartment[]>([])
  const [items, setItems] = useState<SvItem[]>([])
  const [aptNorms, setAptNorms] = useState<SvNorm[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [aptId, setAptId] = useState<number | null>(preselectApt ? Number(preselectApt) : null)
  const [itemId, setItemId] = useState<number | null>(null)
  const [freeText, setFreeText] = useState('')
  const [kind, setKind] = useState<IncidentKind>('breakdown')
  const [qty, setQty] = useState('1')
  const [comment, setComment] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [showAllItems, setShowAllItems] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const clientOpIdRef = useRef<string>(crypto.randomUUID())
  const isOnline = navigator.onLine

  const loadReferenceData = () => {
    if (!profile) return
    setLoading(true)
    setLoadError(null)
    Promise.all([fetchApartments(profile.id), fetchItems()])
      .then(([a, i]) => { setApartments(a); setItems(i) })
      .catch((e) => setLoadError(friendlyMessage(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadReferenceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    if (!aptId || !profileId) return
    fetchNorms(profileId, aptId)
      .then((n) => setAptNorms(n))
      .catch(() => setAptNorms([]))
  }, [aptId, profileId])

  const normItemIds = useMemo(() => new Set(aptNorms.map((n) => n.item_id)), [aptNorms])
  const normItems = useMemo(() => items.filter((i) => normItemIds.has(i.id)), [items, normItemIds])
  const itemOptions = useMemo(() => {
    const base = showAllItems ? items : normItems
    return base.slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [items, normItems, showAllItems])

  const selectedItem = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId])

  const handlePhotoSelect = async (incoming: File[]) => {
    if (incoming.length === 0) return
    const remaining = MAX_FILES - photos.length
    if (remaining <= 0) {
      setError(t.incidents.mediaTooMany)
      return
    }
    const d = currentDict().incidents
    const valid: File[] = []
    let hadError = false

    if (incoming.length > remaining) {
      setError(t.incidents.mediaTooMany)
      hadError = true
    }

    for (const file of incoming.slice(0, remaining)) {
      if (isHeicFile(file)) {
        setConverting(true)
        try {
          const converted = await compressImage(file)
          const convertedFile = new File([converted], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
          if (convertedFile.size > MAX_FILE_SIZE) { setError(d.mediaTooBig); hadError = true; continue }
          valid.push(convertedFile)
        } catch {
          setError(currentDict().heicNotSupported)
          hadError = true
        } finally {
          setConverting(false)
        }
        continue
      }
      const err = validateMediaFile(file)
      if (err) { setError(err); hadError = true; continue }
      valid.push(file)
    }

    if (valid.length > 0) {
      if (!hadError) setError(null)
      setPhotos((prev) => [...prev, ...valid])
      setPhotoPreviews((prev) => [...prev, ...valid.map((f) => URL.createObjectURL(f))])
    }
  }

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    handlePhotoSelect(files)
  }

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx))
    setPhotoPreviews((prev) => { URL.revokeObjectURL(prev[idx]); return prev.filter((_, i) => i !== idx) })
  }

  const handleSubmit = async () => {
    if (!aptId) { setError(t.incidents.apartment); return }
    if (photos.length === 0) { setError(t.incidents.photosRequired); return }
    if (!itemId && !freeText.trim()) { setError(t.incidents.freeText); return }
    setSubmitting(true); setError(null)
    const photoPaths: string[] = []
    try {
      if (photos.length > 0 && profile) {
        for (const file of photos) photoPaths.push(await uploadIncidentPhoto(profile.id, file))
      }
      await createIncident({
        apartmentId: aptId,
        itemId,
        freeText: freeText.trim() || null,
        kind,
        qty: Number(qty) || 1,
        comment: comment.trim() || null,
        photoPaths,
        clientOpId: clientOpIdRef.current,
      })
      if (notifyContacts.length > 0) {
        const apt = apartments.find((a) => a.id === aptId)
        setSentText(incidentMessage({
          code: apt?.code ?? `#${aptId}`,
          building: apt?.building,
          author: profile?.full_name ?? null,
          kindLabel: kinds.find((k) => k.value === kind)?.label ?? kind,
          what: selectedItem?.name ?? freeText.trim(),
          qty: Number(qty) || 1,
          comment: comment.trim() || null,
        }))
      } else if (backTo) navigate(backTo)
      else navigate('/sv/incidents')
    } catch (e) {
      if (photoPaths.length > 0) {
        await cleanupPhotos(photoPaths).catch(() => {})
      }
      setError(friendlyMessage(e))
    } finally { setSubmitting(false) }
  }

  const handleClose = () => {
    photoPreviews.forEach((url) => URL.revokeObjectURL(url))
    if (backTo) navigate(backTo)
    else navigate(-1)
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Loader2 className="w-6 h-6 text-white animate-spin" />
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0" onClick={handleClose} />
        <div className="relative bg-surface w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line p-4">
          <ErrorState onRetry={loadReferenceData} />
        </div>
      </div>
    )
  }

  if (sentText) {
    const finish = () => {
      if (backTo) navigate(backTo)
      else navigate('/sv/incidents')
    }
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex flex-col justify-end anim-scrim" role="dialog" aria-modal="true" aria-label={t.incidents.title}>
        <div className="bg-surface rounded-t-2xl px-5 pt-6 pb-6 space-y-3 anim-sheet">
          <div className="flex items-center gap-2 bg-ok-soft border border-line rounded-xl px-3 py-2.5">
            <Check className="w-4 h-4 text-ok" />
            <p className="text-sm text-ok">{t.incidents.success}</p>
          </div>
          <WhatsappNotify contacts={notifyContacts} text={sentText} />
          <button onClick={finish} className="w-full bg-app text-ink rounded-xl py-3.5 min-h-[48px] font-medium">{t.notify.done}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex flex-col justify-end anim-scrim" onClick={handleClose} role="dialog" aria-modal="true" aria-label={t.incidents.title}>
      <div className="bg-surface rounded-t-2xl max-h-[92dvh] overflow-y-auto anim-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--line)' }} />
        </div>
        <div className="px-5 py-3 flex items-center justify-between border-b border-line">
          <h2 className="text-base font-semibold text-ink">{t.incidents.title}</h2>
          <button onClick={handleClose} className="p-2.5 -mr-1 rounded-lg hover:bg-app transition-colors" aria-label={t.common.close}>
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <Field label={t.incidents.apartment}>
            <select value={aptId ?? ''} onChange={(e) => { const v = e.target.value; setAptId(v ? Number(v) : null); setItemId(null); setFreeText(''); setShowAllItems(false) }}
              className="w-full bg-app rounded-xl px-4 py-3 text-sm border border-line focus:border-accent focus:outline-none">
              <option value="">—</option>
              {apartments.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
            </select>
          </Field>

          {aptId && (
            <Field label={t.incidents.item}>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setShowAllItems(false)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${!showAllItems ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'}`}
                >
                  {t.incidents.fromNorms}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllItems(true)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${showAllItems ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'}`}
                >
                  {t.incidents.allItems}
                </button>
              </div>
              <select value={itemId ?? ''} onChange={(e) => { const v = e.target.value; setItemId(v ? Number(v) : null); if (v) setFreeText('') }}
                className="w-full bg-app rounded-xl px-4 py-3 text-sm border border-line focus:border-accent focus:outline-none mb-2">
                <option value="">— {t.incidents.freeText} —</option>
                {itemOptions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              {!itemId && (
                <input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder={t.incidents.freeText}
                  className="w-full bg-app rounded-xl px-4 py-3 text-sm border border-line focus:border-accent focus:outline-none" />
              )}
              {selectedItem && (
                <p className="text-xs text-muted mt-1">{selectedItem.category}</p>
              )}
            </Field>
          )}

          <Field label={t.incidents.kind}>
            <div className="grid grid-cols-2 gap-2">
              {kinds.map((k) => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={`rounded-xl py-2.5 text-sm border transition-colors ${kind === k.value ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line bg-app text-muted'}`}>
                  {k.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t.incidents.qty}>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
              className="w-full bg-app rounded-xl px-4 py-3 text-sm border border-line focus:border-accent focus:outline-none" />
          </Field>

          <Field label={t.incidents.comment}>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
              className="w-full bg-app rounded-xl px-4 py-3 text-sm border border-line focus:border-accent focus:outline-none resize-none" />
          </Field>

          <Field label={t.incidents.photos}>
            <div className="flex gap-2 flex-wrap">
              {photoPreviews.map((src, idx) => {
                const file = photos[idx]
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
                    <button type="button" onClick={() => removePhoto(idx)} className="absolute -top-1 -right-1 w-5 h-5 bg-bad text-white rounded-full flex items-center justify-center">
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
              {photos.length < MAX_FILES && !converting && isOnline && (
                <>
                  <button type="button" onClick={() => photoInputRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-line rounded-xl flex items-center justify-center text-muted hover:border-accent" aria-label={t.qr.photo}>
                    <Camera className="w-6 h-6" />
                  </button>
                  <button type="button" onClick={() => videoInputRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-line rounded-xl flex items-center justify-center text-muted hover:border-accent" aria-label={t.qr.video}>
                    <VideoIcon className="w-6 h-6" />
                  </button>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={onFileInputChange} className="hidden" />
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple onChange={onFileInputChange} className="hidden" />
            <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mov,.webm" capture="environment" multiple onChange={onFileInputChange} className="hidden" />
            {photos.length === 0 && (
              <p className="text-xs text-warn mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t.incidents.photosRequired}
              </p>
            )}
          </Field>

          {error && (
            <div className="flex items-start gap-2 bg-bad-soft border border-line rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-bad mt-0.5 shrink-0" />
              <p className="text-sm text-bad">{error}</p>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-surface border-t border-line px-5 py-3 flex gap-3">
          <button onClick={handleClose} className="flex-1 bg-app text-ink rounded-xl py-3.5 min-h-[48px] font-medium">{t.incidents.cancel}</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || converting || !isOnline || !aptId || photos.length === 0}
            className="flex-1 bg-accent text-white rounded-xl py-3.5 min-h-[48px] font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isOnline ? t.incidents.submit : t.errors.needsNetworkAction}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      {children}
    </div>
  )
}
