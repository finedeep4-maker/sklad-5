import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchWarehouseStock, fetchStockMoves, fetchOwnerStock } from '@/modules/admin/api'
import type { WarehouseStockRow, StockMoveRow, OwnerStockRow } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatQty, formatDateTime } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { Search } from 'lucide-react'
import { OwnerBadge } from '@/components/OwnerBadge'
import { ErrorState } from '@/components/ErrorState'

type KindFilter = 'all' | 'assets' | 'consumables'
type StockTab = 'company' | 'owner'

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <span className="block h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
    </span>
  )
}

export function WarehousePage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: StockTab = searchParams.get('tab') === 'owner' ? 'owner' : 'company'

  const setTab = (next: StockTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'owner') params.set('tab', 'owner')
    else params.delete('tab')
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.stock.title}</h1>

      <div className="inline-flex bg-surface border border-line rounded-lg p-0.5 mb-4">
        <button
          onClick={() => setTab('company')}
          className={`px-4 py-2 rounded-md text-sm transition-colors ${tab === 'company' ? 'bg-accent text-white' : 'text-muted'}`}
        >
          {t.admin.stock.tabCompany}
        </button>
        <button
          onClick={() => setTab('owner')}
          className={`px-4 py-2 rounded-md text-sm transition-colors ${tab === 'owner' ? 'bg-accent text-white' : 'text-muted'}`}
        >
          {t.admin.stock.tabOwner}
        </button>
      </div>

      {tab === 'company' ? <CompanyStock /> : <OwnerStock />}
    </div>
  )
}

function CompanyStock() {
  const { t, n } = useI18n()
  const [stock, setStock] = useState<WarehouseStockRow[]>([])
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [moves, setMoves] = useState<StockMoveRow[]>([])
  const [movesLoading, setMovesLoading] = useState(false)
  const [movesOffset, setMovesOffset] = useState(0)
  const [hasMoreMoves, setHasMoreMoves] = useState(false)
  const [searchParams] = useSearchParams()
  const belowOnly = searchParams.get('below') === '1'

  const loadStock = useCallback((silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) setLoading(true)
    fetchWarehouseStock()
      .then((data) => setStock(data))
      .catch((error) => { if (!quiet) toast(errorMessage(error), 'error') })
      .finally(() => { if (!quiet) setLoading(false) })
  }, [])

  useEffect(() => { loadStock() }, [loadStock])
  useLiveRefresh(['stock_moves', 'items', 'locations'], () => loadStock(true))

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of stock) set.add(s.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [stock])

  const filtered = useMemo(() => {
    return stock.filter((s) => {
      if (kindFilter === 'assets' && s.kind !== 'asset') return false
      if (kindFilter === 'consumables' && s.kind !== 'consumable') return false
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
      if (belowOnly && !s.below_min) return false
      if (search.trim() && !s.name.toLowerCase().includes(search.toLowerCase().trim())) return false
      return true
    })
  }, [stock, kindFilter, categoryFilter, search, belowOnly])

  const grouped = useMemo(() => {
    const map = new Map<string, WarehouseStockRow[]>()
    for (const s of filtered) {
      const list = map.get(s.category) ?? []
      list.push(s)
      map.set(s.category, list)
    }
    return Array.from(map.entries()).map(([category, items]) => [category, [...items].sort((a, b) => Number(b.below_min) - Number(a.below_min) || a.name.localeCompare(b.name))] as const).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const ownerLocLabel = (location: StockMoveRow['from_location']) => {
    if (!location) return '—'
    if (location.type === 'warehouse') return t.admin.stock.warehouse
    if (location.type === 'sink') return t.admin.stock.expense
    if (location.type === 'owner_stock' && (location as { name: string }).name) {
      const code = (location as { name: string }).name.replace(/^Owner:\s*/, '')
      return t.admin.stock.ownerWarehouseCode.replace('{{code}}', code)
    }
    return location.name
  }

  const loadMoves = (itemId: number, offset: number, append: boolean) => {
    setMovesLoading(true)
    fetchStockMoves(itemId, offset)
      .then((nextMoves) => {
        setMoves((previous) => append ? [...previous, ...nextMoves] : nextMoves)
        setMovesOffset(offset + nextMoves.length)
        setHasMoreMoves(nextMoves.length === 50)
      })
      .catch((error) => toast(errorMessage(error), 'error'))
      .finally(() => setMovesLoading(false))
  }

  const toggleExpand = (itemId: number) => {
    if (expandedId === itemId) {
      setExpandedId(null)
      return
    }
    setExpandedId(itemId)
    setMoves([])
    setMovesOffset(0)
    setHasMoreMoves(false)
    loadMoves(itemId, 0, false)
  }

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }

  return (
    <>
      <div className="flex gap-2.5 flex-wrap mb-3.5">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.admin.stock.search}
            className="w-full bg-surface rounded-lg pl-10 pr-4 py-2 text-sm border border-line focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-surface rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none"
        >
          <option value="all">{t.admin.stock.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="inline-flex bg-surface border border-line rounded-lg p-0.5">
          {(['all', 'assets', 'consumables'] as KindFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setKindFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                kindFilter === f ? 'bg-accent text-white' : 'text-muted'
              }`}
            >
              {f === 'all' ? t.admin.stock.all : f === 'assets' ? t.admin.stock.assets : t.admin.stock.consumables}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <h2 className="font-semibold text-sm text-ink mb-2 px-1">{category}</h2>
            <div className="bg-surface border border-line rounded-xl overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line">{t.admin.stock.title}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{t.common.balance} / {t.admin.stock.min}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line">{t.common.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const expanded = expandedId === item.item_id
                    const minPct = item.min_stock ? Math.min((item.qty / item.min_stock) * 100, 100) : 100
                    return (
                      <Fragment key={item.item_id}>
                        <tr
                          onClick={() => toggleExpand(item.item_id)}
                          className="cursor-pointer transition-colors hover:bg-app"
                        >
                          <td className="px-2.5 py-2.5 border-b border-line">
                            <span className="text-sm text-ink">{item.name}</span>
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap" style={{ minWidth: '140px' }}>
                            <span className={item.below_min ? 'text-bad' : 'text-ink'}>{n(formatQty(item.qty, item))}</span>
                            <span className="text-muted text-xs"> / {item.min_stock != null ? n(formatQty(item.min_stock, item)) : '—'}</span>
                            <ProgressBar value={minPct} color={item.below_min ? 'var(--bad)' : 'var(--ok)'} />
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                              item.below_min ? 'bg-bad-soft text-bad' : item.min_stock == null ? 'bg-app text-muted' : 'bg-ok-soft text-ok'
                            }`}>
                              {item.below_min ? t.admin.stock.belowMin : item.min_stock == null ? t.admin.stock.noMin : t.admin.dashboard.noToOrder}
                            </span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={3} className="px-2.5 py-3 border-b border-line bg-app">
                              <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t.admin.stock.history}</div>
                              {movesLoading && moves.length === 0 ? (
                                <div className="text-sm text-muted">{t.app.loading}</div>
                              ) : moves.length === 0 ? (
                                <div className="text-sm text-muted">{t.admin.stock.noHistory}</div>
                              ) : (
                                <div className="space-y-2">
                                  {moves.map((m) => {
                                    const sourceTypes = t.admin.stock.sourceTypes
                                    const sourceLabel = sourceTypes[m.source_type as keyof typeof sourceTypes] ?? m.source_type
                                    return (
                                      <div key={m.id} className="text-xs border-b border-line last:border-0 pb-2 last:pb-0">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <span className="text-ink font-medium">{sourceLabel}</span>
                                            <span className="text-muted block">{n(formatDateTime(m.moved_at))}</span>
                                            <span className="text-muted block">{ownerLocLabel(m.from_location)} → {ownerLocLabel(m.to_location)}</span>
                                            {m.owner_code && (
                                              <span className="inline-flex items-center gap-1 mt-0.5">
                                                <OwnerBadge />
                                                <span className="text-muted">{m.owner_code}</span>
                                              </span>
                                            )}
                                            {m.author && <span className="text-muted block">{t.admin.stock.author}: {m.author}</span>}
                                            {m.note && <span className="text-muted block">{m.note}</span>}
                                          </div>
                                          <span className="text-muted shrink-0">{n(formatQty(m.qty, item))}</span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                  {hasMoreMoves && (
                                    <button onClick={() => loadMoves(item.item_id, movesOffset, true)} disabled={movesLoading} className="text-xs text-accent font-medium disabled:opacity-50">
                                      {movesLoading ? t.app.loading : t.admin.stock.loadMore}
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="bg-surface border border-line rounded-xl px-4 py-6 text-center text-muted text-sm">{t.common.noResults}</div>
        )}
      </div>
    </>
  )
}

function OwnerStock() {
  const { t, n } = useI18n()
  const [stock, setStock] = useState<OwnerStockRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadStock = useCallback((silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setError(false) }
    fetchOwnerStock()
      .then((data) => setStock(data))
      .catch((e) => { if (!quiet) { setError(true); toast(errorMessage(e), 'error') } })
      .finally(() => { if (!quiet) setLoading(false) })
  }, [])

  useEffect(() => { loadStock() }, [loadStock])
  useLiveRefresh(['stock_moves', 'items', 'locations'], () => loadStock(true))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return stock
    return stock.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
  }, [stock, search])

  const grouped = useMemo(() => {
    const map = new Map<number, { code: string; items: OwnerStockRow[] }>()
    for (const s of filtered) {
      const entry = map.get(s.apartment_id) ?? { code: s.code, items: [] }
      entry.items.push(s)
      map.set(s.apartment_id, entry)
    }
    return Array.from(map.entries()).map(([id, entry]) => ({ id, code: entry.code, items: entry.items }))
  }, [filtered])

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }

  if (error) {
    return <ErrorState onRetry={() => loadStock()} />
  }

  return (
    <>
      <div className="relative mb-3.5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.admin.stock.search}
          className="w-full bg-surface rounded-lg pl-10 pr-4 py-2 text-sm border border-line focus:border-accent focus:outline-none"
        />
      </div>

      {grouped.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl px-4 py-6 text-center text-muted text-sm">{t.admin.stock.ownerEmpty}</div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <h2 className="font-semibold text-sm text-ink">{group.code}</h2>
                <OwnerBadge />
              </div>
              <div className="bg-surface border border-line rounded-xl overflow-hidden">
                {group.items.map((item, i) => (
                  <div key={item.item_id} className={`flex items-center justify-between px-3 py-3 ${i < group.items.length - 1 ? 'border-b border-line' : ''}`}>
                    <span className="text-sm text-ink">{item.name}</span>
                    <span className="text-sm text-muted shrink-0">{n(formatQty(item.qty, { base_unit: item.base_unit, pack_size: 1, pack_label: '' }))}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
