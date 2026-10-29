import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader as Loader2, ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { formatDateTime } from '@/lib/format'
import { friendlyMessage } from '@/lib/errors'
import { fetchIncidentHistory } from './api'
import { HistoryFilters } from './HistoryFilters'
import { IncidentDetailSheet } from './IncidentDetailSheet'
import type { SvApartmentIncidentRow, IncidentHistoryFilters as Filters } from './types'
import { emptyIncidentFilters, PAGE_SIZE } from './types'
import type { IncidentKind, IncidentStatus } from '@/lib/database.types'
import { useLiveRefresh } from '@/lib/realtime'

interface Props {
  apartmentId?: number
  canDelete: boolean
  refreshKey?: number
}

export function IncidentHistoryList({ apartmentId, canDelete, refreshKey }: Props) {
  const { t, n } = useI18n()
  const { itemName } = useCatalogName()
  const [filters, setFilters] = useState<Filters>(emptyIncidentFilters())
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [rows, setRows] = useState<SvApartmentIncidentRow[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SvApartmentIncidentRow | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRef = useRef(0)
  const reqIdRef = useRef(0)

  const activeFilters: Filters = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasMedia: filters.hasMedia,
    status: filters.status,
    kind: filters.kind,
    search: debouncedSearch,
  }

  const load = useCallback(async (resetPage: boolean, silent = false) => {
    const p = resetPage ? 0 : pageRef.current + 1
    if (resetPage) { pageRef.current = 0; if (!silent) setListLoading(true) } else { setLoadingMore(true) }
    setError(null)
    const myReq = ++reqIdRef.current
    try {
      const result = await fetchIncidentHistory(apartmentId ?? null, activeFilters, p)
      if (myReq !== reqIdRef.current) return
      if (resetPage) {
        setRows(result.rows)
      } else {
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          return [...prev, ...result.rows.filter((r) => !seen.has(r.id))]
        })
      }
      pageRef.current = p
      setTotal(result.total)
      setHasMore(result.rows.length > 0 && (p + 1) * PAGE_SIZE < result.total)
    } catch (e) {
      if (myReq !== reqIdRef.current) return
      setError(friendlyMessage(e))
      setHasMore(false)
    } finally {
      if (myReq === reqIdRef.current) {
        setListLoading(false)
        setLoadingMore(false)
      }
    }
  }, [apartmentId, activeFilters.dateFrom, activeFilters.dateTo, activeFilters.hasMedia, activeFilters.status, activeFilters.kind, activeFilters.search])

  useEffect(() => {
    load(true)
  }, [apartmentId, debouncedSearch, filters.dateFrom, filters.dateTo, filters.hasMedia, filters.status, filters.kind, refreshKey, load])

  useLiveRefresh(['incidents'], () => {
    if (pageRef.current === 0) load(true, true)
  })

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [filters.search])

  const handleReset = () => {
    setFilters(emptyIncidentFilters())
    setDebouncedSearch('')
  }

  const kindDisplay: Record<IncidentKind, string> = {
    breakdown: t.incidents.kindBreakdown,
    broken: t.incidents.kindBroken,
    damaged: t.incidents.kindDamaged,
    lost: t.incidents.kindLost,
    other: t.incidents.kindOther,
  }
  const statusDisplay: Record<IncidentStatus, string> = {
    new: t.incidents.statusNew,
    in_progress: t.incidents.statusInProgress,
    confirmed: t.incidents.statusConfirmed,
    rejected: t.incidents.statusRejected,
  }

  const statusColors: Record<IncidentStatus, string> = {
    new: 'bg-warn-soft text-warn',
    in_progress: 'bg-accent-soft text-accent',
    confirmed: 'bg-ok-soft text-ok',
    rejected: 'bg-bad-soft text-bad',
  }

  return (
    <div className="space-y-3">
      <HistoryFilters
        type="incident"
        search={filters.search}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        hasMedia={filters.hasMedia}
        status={filters.status}
        kind={filters.kind}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        onDateFrom={(v) => setFilters((f) => ({ ...f, dateFrom: v }))}
        onDateTo={(v) => setFilters((f) => ({ ...f, dateTo: v }))}
        onHasMedia={(v) => setFilters((f) => ({ ...f, hasMedia: v }))}
        onStatus={(v) => setFilters((f) => ({ ...f, status: v }))}
        onKind={(v) => setFilters((f) => ({ ...f, kind: v }))}
        onReset={handleReset}
        total={total}
      />

      {error && <p className="text-sm text-bad">{error}</p>}

      {listLoading ? (
        <div className="py-8 text-center" data-testid="list-loading"><Loader2 className="w-5 h-5 text-muted animate-spin mx-auto" /></div>
      ) : (
        <>
          {rows.length === 0 && !error && (
            <p className="text-sm text-muted text-center py-6" data-testid="list-empty">{t.common.noResults}</p>
          )}

          {rows.map((inc) => (
            <button
              key={inc.id}
              onClick={() => setSelected(inc)}
              data-testid="incident-card"
              className="w-full text-left bg-surface border border-line rounded-xl px-4 py-3 hover:border-accent transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-ink">{n(formatDateTime(inc.created_at))}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[inc.status]}`}>
                  {statusDisplay[inc.status]}
                </span>
              </div>
              <p className="text-xs text-muted">{kindDisplay[inc.kind]}</p>
              {inc.item_name && <p className="text-xs text-muted">{itemName(inc.item_name)}</p>}
              {inc.author_name && <p className="text-xs text-muted">{t.qr.detailAuthor}: {inc.author_name}</p>}
            </button>
          ))}

          {hasMore && (
            <button
              onClick={() => load(false)}
              disabled={loadingMore}
              className="w-full bg-surface border border-line rounded-xl py-3 text-sm text-muted flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
              {t.admin.stock.loadMore}
            </button>
          )}
        </>
      )}

      {selected && (
        <IncidentDetailSheet
          incident={selected}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
          onDeleted={() => { setSelected(null); load(true) }}
        />
      )}
    </div>
  )
}
