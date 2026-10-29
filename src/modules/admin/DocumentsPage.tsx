import { useState, useEffect, useCallback, useRef } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { useNavigate } from 'react-router-dom'
import { fetchDocuments } from '@/modules/admin/api'
import type { DocumentWithSupplier } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatDate } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { FileText, ChevronRight, Loader } from 'lucide-react'

const PAGE_SIZE = 50

export function DocumentsPage() {
  const { t, n } = useI18n()
  const navigate = useNavigate()
  const [docs, setDocs] = useState<DocumentWithSupplier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const pageRef = useRef(0)

  useEffect(() => {
    setLoading(true)
    setLoadError(false)
    fetchDocuments(filter, 0, PAGE_SIZE)
      .then((data) => {
        setDocs(data)
        setHasMore(data.length === PAGE_SIZE)
        pageRef.current = 0
      })
      .catch((e) => { setLoadError(true); toast(errorMessage(e), 'error') })
      .finally(() => setLoading(false))
  }, [filter])

  const loadFirstPage = useCallback((silent?: boolean) => {
    const quiet = silent === true
    if (pageRef.current > 0) return
    if (!quiet) { setLoading(true); setLoadError(false) }
    fetchDocuments(filter, 0, PAGE_SIZE)
      .then((data) => {
        setDocs(data)
        setHasMore(data.length === PAGE_SIZE)
      })
      .catch((e) => { if (!quiet) { setLoadError(true); toast(errorMessage(e), 'error') } })
      .finally(() => { if (!quiet) setLoading(false) })
  }, [filter])

  useLiveRefresh(['documents'], () => loadFirstPage(true))

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const next = await fetchDocuments(filter, docs.length, PAGE_SIZE)
      setDocs((prev) => [...prev, ...next])
      setHasMore(next.length === PAGE_SIZE)
      pageRef.current += 1
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setLoadingMore(false)
    }
  }, [filter, docs.length, loadingMore, hasMore])

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

  const filters: Array<{ key: string; label: string }> = [
    { key: 'all', label: t.admin.documents.allTypes },
    { key: 'receipt', label: t.admin.documents.receipt },
    { key: 'issue', label: t.admin.documents.issue },
    { key: 'writeoff', label: t.admin.documents.writeoff },
    { key: 'inventory', label: t.admin.documents.inventory },
  ]

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.documents.title}</h1>

      <div className="flex gap-2 flex-wrap mb-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors border ${
              filter === f.key ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-muted text-sm pt-8">{t.app.loading}</div>
      ) : loadError && docs.length === 0 ? (
        <ErrorState onRetry={() => loadFirstPage()} />
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.documents.noDocs}</p>
      ) : (
        <>
          <div className="space-y-2">
            {docs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => navigate(`/admin/more/documents/${doc.id}`)}
                className="w-full bg-surface border border-line rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-accent transition-colors"
              >
                <FileText className="w-5 h-5 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{doc.number}</span>
                    <span className="text-xs text-muted">{typeLabels[doc.doc_type] ?? doc.doc_type}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(doc.doc_date)}
                    {doc.supplier_name && ` · ${doc.supplier_name}`}
                    {doc.total_cost != null && ` · ${n(String(doc.total_cost))} EGP`}
                  </div>
                </div>
                <span className="text-xs text-muted shrink-0">{statusLabels[doc.status] ?? doc.status}</span>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full bg-surface border border-line rounded-xl py-3 text-sm text-muted hover:bg-app transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {loadingMore && <Loader className="w-4 h-4 animate-spin" />}
              {t.admin.documents.loadMore}
            </button>
          )}
        </>
      )}
    </div>
  )
}
