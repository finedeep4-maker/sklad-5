import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader as Loader2, ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { friendlyMessage } from '@/lib/errors'
import { fetchCleaningHistory } from './api'
import { HistoryFilters } from './HistoryFilters'
import { CleaningDetailSheet } from './CleaningDetailSheet'
import type { SvCleaningEventRow, CleaningHistoryFilters as Filters } from './types'
import { emptyCleaningFilters, PAGE_SIZE } from './types'
import { useLiveRefresh } from '@/lib/realtime'

interface Props {
  apartmentId?: number
  canDelete: boolean
  onRecalculate?: (eventId: string) => void
  onReverse?: (eventId: string) => void
  refreshKey?: number
}

export function CleaningHistoryList({ apartmentId, canDelete, onRecalculate, onReverse, refreshKey }: Props) {
  const { t, n } = useI18n()
  const [filters, setFilters] = useState<Filters>(emptyCleaningFilters())
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [rows, setRows] = useState<SvCleaningEventRow[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SvCleaningEventRow | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRef = useRef(0)
  const reqIdRef = useRef(0)

  const activeFilters: Filters = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasMedia: filters.hasMedia,
    status: filters.status,
    leadStaff: filters.leadStaff,
    search: debouncedSearch,
  }

  const load = useCallback(async (resetPage: boolean, silent = false) => {
    const p = resetPage ? 0 : pageRef.current + 1
    if (resetPage) { pageRef.current = 0; if (!silent) setListLoading(true) } else { setLoadingMore(true) }
    setError(null)
    const myReq = ++reqIdRef.current
    try {
      const result = await fetchCleaningHistory(apartmentId ?? null, activeFilters, p)
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
  }, [apartmentId, activeFilters.dateFrom, activeFilters.dateTo, activeFilters.hasMedia, activeFilters.status, activeFilters.leadStaff, activeFilters.search])

  useEffect(() => {
    load(true)
  }, [apartmentId, debouncedSearch, filters.dateFrom, filters.dateTo, filters.hasMedia, filters.status, filters.leadStaff, refreshKey, load])

  useLiveRefresh(['cleaning_events', 'cleaning_event_staff', 'cleaning_event_lines'], () => {
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
    setFilters(emptyCleaningFilters())
    setDebouncedSearch('')
  }

  return (
    <div className="space-y-3">
      <HistoryFilters
        type="cleaning"
        search={filters.search}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        hasMedia={filters.hasMedia}
        status={filters.status}
        leadStaff={filters.leadStaff}
        onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
        onDateFrom={(v) => setFilters((f) => ({ ...f, dateFrom: v }))}
        onDateTo={(v) => setFilters((f) => ({ ...f, dateTo: v }))}
        onHasMedia={(v) => setFilters((f) => ({ ...f, hasMedia: v }))}
        onStatus={(v) => setFilters((f) => ({ ...f, status: v }))}
        onLeadStaff={(v) => setFilters((f) => ({ ...f, leadStaff: v }))}
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

          {rows.map((ev) => (
            <button
              key={ev.id}
              onClick={() => setSelected(ev)}
              data-testid="cleaning-card"
              className="w-full text-left bg-surface border border-line rounded-xl px-4 py-3 hover:border-accent transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-ink">{n(formatDateTime(ev.cleaned_at))}</span>
                {ev.status === 'done' && ev.posting_status === 'pending' ? (
                  <span data-testid="cleaning-pending-badge" className="text-xs px-2 py-0.5 rounded-full bg-warn-soft text-warn">
                    {t.admin.apartments.pendingApproval}
                  </span>
                ) : (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ev.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
                    {ev.status === 'done' ? t.admin.apartments.done : t.admin.apartments.reversed}
                  </span>
                )}
              </div>
              {ev.lead_staff_name && <p className="text-xs text-muted">{t.cleaning.leadStaff}: {ev.lead_staff_name}</p>}
              {ev.staff_names && <p className="text-xs text-muted">{ev.staff_names}</p>}
              {ev.author_name && <p className="text-xs text-muted">{t.qr.detailAuthor}: {ev.author_name}</p>}
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
        <CleaningDetailSheet
          event={selected}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
          onDeleted={() => { setSelected(null); load(true) }}
          onRecalculate={(eid) => { setSelected(null); onRecalculate?.(eid) }}
          onReverse={(eid) => { setSelected(null); onReverse?.(eid) }}
        />
      )}
    </div>
  )
}
