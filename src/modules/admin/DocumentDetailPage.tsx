import { useState, useEffect, useRef, useCallback } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { useParams, useNavigate } from 'react-router-dom'
import {
  fetchDocumentMoves,
  fetchAttachments,
  uploadAttachment,
  deleteAttachment,
  createSignedUrl,
  voidDocument,
} from '@/modules/admin/api'
import type { DocumentWithSupplier, AttachmentRow, BaseUnit } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n'
import { formatDate, formatDateTime, formatQty } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { ArrowLeft, Printer, Upload, Trash2, FileText, Loader as Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { OwnerBadge } from '@/components/OwnerBadge'
import { useCatalogName } from '@/modules/core/useCatalogName'

interface DocMoveRow {
  id: number
  item_id: number
  from_loc: number
  to_loc: number
  qty: number
  unit_cost: number | null
  source_type: string
  note: string | null
  moved_at: string
  from_location?: { name: string; type: string }
  to_location?: { name: string; type: string }
  item_name: string
  item_base_unit: BaseUnit
  item_pack_size: number
  item_pack_label: string
  owner_apartment_id: number | null
  owner_code: string | null
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const [doc, setDoc] = useState<DocumentWithSupplier | null>(null)
  const [moves, setMoves] = useState<DocMoveRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AttachmentRow | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)

  const loadAll = useCallback((silent?: boolean) => {
    if (!id) return
    const quiet = silent === true
    const isFirstLoad = loadedIdRef.current !== id
    if (isFirstLoad && !quiet) {
      setLoading(true)
      setLoadError(false)
    }
    Promise.all([
      supabase.from('documents').select('id,doc_type,number,doc_date,supplier_id,status,note,total_cost,created_at').eq('id', id).single(),
      fetchDocumentMoves(id),
      fetchAttachments(id),
    ])
      .then(async ([docRes, mv, atts]) => {
        if (docRes.error) throw new Error(docRes.error.message)
        const docRow = docRes.data as DocumentWithSupplier
        if (docRow.supplier_id) {
          const supRes = await supabase.from('suppliers').select('name').eq('id', docRow.supplier_id).single()
          docRow.supplier_name = supRes.data?.name ?? null
        } else {
          docRow.supplier_name = null
        }
        setDoc(docRow)
        setMoves(mv as DocMoveRow[])
        setAttachments(atts)
        loadedIdRef.current = id
      })
      .catch((e) => { if (!quiet) { setLoadError(true); toast(errorMessage(e), 'error') } })
      .finally(() => { if (isFirstLoad && !quiet) setLoading(false) })
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])
  useLiveRefresh(['documents', 'stock_moves'], () => loadAll(true))

  const typeLabels: Record<string, string> = {
    receipt: t.admin.documents.receipt,
    issue: t.admin.documents.issue,
    writeoff: t.admin.documents.writeoff,
    inventory: t.admin.documents.inventory,
  }

  const statusLabels: Record<string, string> = {
    posted: t.admin.documents.statusPosted,
    draft: t.admin.documents.statusDraft,
    void: t.admin.documents.statusVoid,
  }

  const handleVoid = async () => {
    if (!id || voiding) return
    setVoiding(true)
    try {
      await voidDocument(id, voidReason.trim() || null)
      toast(t.admin.documents.voided, 'success')
      setVoidOpen(false)
      setVoidReason('')
      loadAll(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setVoiding(false)
    }
  }

  const handleFile = async (file: File) => {
    if (!id) return
    if (file.size > 10 * 1024 * 1024) {
      toast(t.admin.documents.fileTooBig, 'error')
      return
    }
    setUploading(true)
    try {
      await uploadAttachment(id, file)
      const atts = await fetchAttachments(id)
      setAttachments(atts)
      toast(t.admin.documents.uploaded, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAttachment = async (att: AttachmentRow) => {
    try {
      await deleteAttachment(att.id, att.storage_path)
      setAttachments((prev) => prev.filter((a) => a.id !== att.id))
      toast(t.admin.documents.deleted, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const openAttachment = async (path: string) => {
    try {
      const url = await createSignedUrl(path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }

  if (!doc && loadError) return <ErrorState onRetry={() => loadAll()} />

  if (!doc) {
    return (
      <div className="px-4 pt-8 text-center text-muted">
        <p>{t.common.notFound}</p>
        <button onClick={() => navigate('/admin/more/documents')} className="mt-3 text-accent text-sm">
          {t.admin.documents.title}
        </button>
      </div>
    )
  }

  const locLabel = (location?: { name: string; type: string }) => {
    if (!location) return '—'
    if (location.type === 'owner_stock') {
      const code = location.name.replace(/^Owner:\s*/, '')
      return t.admin.stock.ownerWarehouseCode.replace('{{code}}', code)
    }
    return location.name
  }

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center gap-3 mb-4 no-print">
        <button onClick={() => navigate('/admin/more/documents')} className="p-1">
          <ArrowLeft className="w-5 h-5 text-muted" />
        </button>
        <h1 className="text-xl font-semibold text-ink flex-1">{doc.number}</h1>
        {doc.status === 'posted' && ['receipt', 'issue', 'writeoff'].includes(doc.doc_type) && (
          <button
            onClick={() => setVoidOpen(true)}
            className="flex items-center gap-1.5 bg-bad-soft text-bad rounded-lg px-3 py-2 text-sm font-medium"
          >
            {t.admin.documents.voidAction}
          </button>
        )}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink hover:bg-app transition-colors"
        >
          <Printer className="w-4 h-4" />
          {t.admin.documents.print}
        </button>
      </div>

      {voidOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6 no-print">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
            <h3 className="text-base font-semibold text-ink mb-2">{t.admin.documents.voidTitle}</h3>
            <p className="text-sm text-muted mb-3">{t.admin.documents.voidBody}</p>
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              maxLength={200}
              placeholder={t.admin.documents.voidReason}
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setVoidOpen(false)} disabled={voiding} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
              <button
                onClick={handleVoid}
                disabled={voiding}
                className="flex-1 bg-bad text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {voiding ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t.admin.documents.voidConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Doc header */}
      <div className="bg-surface border border-line rounded-xl p-4 mb-4 print-area">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted">{t.admin.documents.type}: </span>
            <span className="text-ink font-medium">{typeLabels[doc.doc_type] ?? doc.doc_type}</span>
          </div>
          <div>
            <span className="text-muted">{t.admin.documents.date}: </span>
            <span className="text-ink font-medium">{formatDate(doc.doc_date)}</span>
          </div>
          <div>
            <span className="text-muted">{t.admin.documents.status}: </span>
            <span className="text-ink font-medium">{statusLabels[doc.status] ?? doc.status}</span>
          </div>
          {doc.supplier_name && (
            <div>
              <span className="text-muted">{t.admin.documents.supplier}: </span>
              <span className="text-ink font-medium">{doc.supplier_name}</span>
            </div>
          )}
          {doc.total_cost != null && (
            <div>
              <span className="text-muted">{t.admin.documents.total}: </span>
              <span className="text-ink font-medium">{n(String(doc.total_cost))} EGP</span>
            </div>
          )}
          {doc.note && (
            <div className="col-span-2">
              <span className="text-muted">{t.admin.documents.note}: </span>
              <span className="text-ink">{doc.note}</span>
            </div>
          )}
        </div>
      </div>

      {/* Moves */}
      <section className="bg-surface border border-line rounded-xl p-4 mb-4 print-area">
        <h2 className="text-sm font-semibold text-ink mb-3">{t.admin.documents.moves}</h2>
        {moves.length === 0 ? (
          <p className="text-sm text-muted">{t.admin.documents.noMoves}</p>
        ) : (
          <div className="space-y-2">
            {moves.map((mv) => (
              <div key={mv.id} className="flex items-start gap-3 py-2 border-t border-line first:border-t-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink font-medium">{cat.itemName(mv.item_name)}</div>
                  <div className="text-xs text-muted">
                    {n(formatQty(mv.qty, {
                      base_unit: mv.item_base_unit,
                      pack_size: mv.item_pack_size,
                      pack_label: mv.item_pack_label,
                    }))}
                    {mv.unit_cost != null && ` · ${n(String(mv.unit_cost))} EGP`}
                  </div>
                  <div className="text-xs text-muted">
                    {locLabel(mv.from_location)} → {locLabel(mv.to_location)}
                  </div>
                  {mv.owner_code && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <OwnerBadge />
                      <span className="text-xs text-muted">{mv.owner_code}</span>
                    </div>
                  )}
                  {mv.note && <div className="text-xs text-muted">{mv.note}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Attachments */}
      <section className="bg-surface border border-line rounded-xl p-4 no-print">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">{t.admin.documents.attachments}</h2>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 bg-accent text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {t.admin.documents.upload}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted">{t.admin.documents.noAttachments}</p>
        ) : (
          <div className="space-y-2">
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center gap-3 py-2 border-t border-line first:border-t-0">
                <FileText className="w-4 h-4 text-accent shrink-0" />
                <button
                  onClick={() => openAttachment(att.storage_path)}
                  className="flex-1 text-left text-sm text-ink hover:text-accent"
                >
                  {att.storage_path.split('/').pop() ?? att.id}
                </button>
                <span className="text-xs text-muted shrink-0">{formatDateTime(att.created_at)}</span>
                <button
                  onClick={() => setDeleteTarget(att)}
                  className="text-muted hover:text-bad shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t.admin.documents.confirmDeleteAttachment}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) handleDeleteAttachment(target)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
