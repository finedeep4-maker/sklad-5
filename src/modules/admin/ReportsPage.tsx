import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { fetchReportStockMoves, fetchReportWarehouseStock, fetchChargesReport } from '@/modules/admin/api'
import type { ReportStockMoveRow, WarehouseStockRow, ChargesReportRow, ChargeStatus } from '@/lib/database.types'
import { cairoLocalToISO, formatDate, formatDateTime, formatNum } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { ErrorState } from '@/components/ErrorState'
import { useLiveRefresh } from '@/lib/realtime'
import { OwnerBadge } from '@/components/OwnerBadge'
import {
  filterByOwnership, groupExpense, chargesTotals, ownershipLabel,
  type OwnershipFilter,
} from '@/modules/admin/reportRules'
import { useCatalogName } from '@/modules/core/useCatalogName'

type Period = 'today' | '7' | '30' | 'custom'
type ReportTab = 'expense' | 'stock' | 'moves' | 'charges'
type ChargeStatusFilter = 'all' | ChargeStatus

interface CurrencySetting {
  currency: string
}

function cairoDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function rangeFor(period: Period, from: string, to: string): { from: string; to: string } | null {
  const today = cairoDateString()
  if (period === 'custom') {
    if (!from || !to || from > to) return null
    return { from, to: shiftDate(to, 1) }
  }
  const start = period === 'today' ? today : shiftDate(today, period === '7' ? -6 : -29)
  return { from: start, to: shiftDate(today, 1) }
}

function packs(qty: number, packSize: number): number {
  return qty / (packSize || 1)
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

function csvCell(value: string | number | null): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null>>): void {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage() {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const [period, setPeriod] = useState<Period>('7')
  const [from, setFrom] = useState(() => shiftDate(cairoDateString(), -6))
  const [to, setTo] = useState(() => cairoDateString())
  const [tab, setTab] = useState<ReportTab>('expense')
  const [moves, setMoves] = useState<ReportStockMoveRow[]>([])
  const [stock, setStock] = useState<WarehouseStockRow[]>([])
  const [charges, setCharges] = useState<ChargesReportRow[]>([])
  const [chargesError, setChargesError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('EGP')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [itemFilter, setItemFilter] = useState('all')
  const [apartmentFilter, setApartmentFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('company')
  const [chargeStatusFilter, setChargeStatusFilter] = useState<ChargeStatusFilter>('all')
  const [reloadToken, setReloadToken] = useState(0)

  const range = useMemo(() => rangeFor(period, from, to), [period, from, to, reloadToken])
  const requestId = useRef(0)

  const loadData = useCallback((silent?: boolean) => {
    const current = rangeFor(period, from, to)
    const quiet = silent === true
    const id = quiet ? requestId.current : ++requestId.current
    if (!current) { if (!quiet) setLoading(false); return }
    if (!quiet) { setLoading(true); setError(null) }
    const fromISO = cairoLocalToISO(`${current.from}T00:00`)!
    const toISO = cairoLocalToISO(`${current.to}T00:00`)!
    let chargesFailed: string | null = null
    Promise.all([
      fetchReportStockMoves(fromISO, toISO),
      fetchReportWarehouseStock(),
      supabase.from('settings').select('value').eq('key', 'currency').maybeSingle(),
      // ошибка начислений не должна ронять остальные отчёты, но и выглядеть как «начислений нет» не должна
      fetchChargesReport(fromISO, toISO).catch((e: unknown) => { chargesFailed = errorMessage(e); return [] as ChargesReportRow[] }),
    ])
      .then(([nextMoves, nextStock, settingResult, nextCharges]) => {
        if (id !== requestId.current) return
        if (settingResult.error) throw new Error(settingResult.error.message)
        const value = settingResult.data?.value as unknown
        const configured = typeof value === 'string' ? value : value && typeof value === 'object' && 'currency' in value ? (value as CurrencySetting).currency : null
        setMoves(nextMoves)
        setStock(nextStock)
        setCharges(nextCharges)
        setChargesError(chargesFailed)
        setCurrency(typeof configured === 'string' && configured.length === 3 ? configured : 'EGP')
      })
      .catch((e: unknown) => {
        if (id !== requestId.current) return
        if (!quiet) {
          setError(errorMessage(e))
          toast(errorMessage(e), 'error')
        }
      })
      .finally(() => { if (id === requestId.current && !quiet) setLoading(false) })
  }, [period, from, to])

  useEffect(() => { loadData() }, [loadData, reloadToken])
  useLiveRefresh(['stock_moves', 'cleaning_events', 'incidents', 'items', 'incident_charges'], () => loadData(true))

  const filteredMoves = useMemo(() => {
    const byOwnership = filterByOwnership(moves, ownershipFilter)
    return byOwnership.filter((move) => {
      if (itemFilter !== 'all' && String(move.item_id) !== itemFilter) return false
      if (apartmentFilter !== 'all' && String(move.apartment_id ?? '') !== apartmentFilter) return false
      if (sourceFilter !== 'all' && move.source_type !== sourceFilter) return false
      return true
    })
  }, [moves, ownershipFilter, itemFilter, apartmentFilter, sourceFilter])

  const expenseRows = useMemo(() => {
    const byOwnership = filterByOwnership(moves, ownershipFilter)
    return groupExpense(byOwnership)
  }, [moves, ownershipFilter])

  const itemOptions = useMemo(() => Array.from(new Map(moves.map((move) => [move.item_id, move.item_name])).entries()).sort((a, b) => a[1].localeCompare(b[1])), [moves])
  const apartmentOptions = useMemo(() => Array.from(new Map(moves.filter((move) => move.apartment_id !== null).map((move) => [move.apartment_id!, move.apartment_code ?? '—'])).entries()).sort((a, b) => a[1].localeCompare(b[1])), [moves])
  const sourceOptions = useMemo(() => Array.from(new Set(moves.map((move) => move.source_type))).sort(), [moves])

  const chargesTotalsData = useMemo(() => chargesTotals(charges), [charges])

  const filteredCharges = useMemo(() => {
    if (chargeStatusFilter === 'all') return charges
    return charges.filter((c) => c.status === chargeStatusFilter)
  }, [charges, chargeStatusFilter])

  const dateLabel = range ? `${formatDate(cairoLocalToISO(`${range.from}T00:00`))} — ${formatDate(cairoLocalToISO(`${period === 'custom' ? to : shiftDate(range.to, -1)}T00:00`))}` : '—'

  const showOwnershipFilter = tab === 'expense' || tab === 'moves'

  const ownershipCol = (isOwner: boolean, ownerCode: string | null) =>
    ownershipLabel(isOwner, ownerCode, t.admin.reports.ownershipCompany, t.admin.reports.ownershipOwner)

  const exportExpense = () => downloadCsv('expense-by-apartments.csv',
    [t.admin.reports.apartment, t.admin.reports.item, t.admin.reports.category, t.admin.reports.qtyPacks, t.admin.reports.cost, t.admin.reports.ownership],
    expenseRows.map((row) => [row.apartment, row.item, row.category, row.qtyPacks, row.cost == null ? null : row.cost, ownershipCol(row.isOwner, row.ownerCode)]))
  const exportStock = () => downloadCsv('warehouse-current.csv', [t.admin.reports.item, t.admin.reports.category, t.admin.reports.qtyPacks, t.admin.reports.minimum, t.admin.reports.belowMinimum], stock.map((row) => [row.name, row.category, packs(row.qty, row.pack_size), row.min_stock, row.below_min ? t.admin.reports.yes : t.admin.reports.no]))
  const exportMoves = () => downloadCsv('stock-moves.csv',
    [t.admin.reports.date, t.admin.reports.item, t.admin.reports.apartment, t.admin.reports.sourceType, t.admin.reports.qty, t.admin.reports.unitCost, t.admin.reports.ownership],
    filteredMoves.map((move) => [move.moved_at, move.item_name, move.apartment_code, move.source_type, move.qty, move.unit_cost, ownershipCol(move.owner_apartment_id != null, move.owner_code)]))
  const exportCharges = () => downloadCsv('charges.csv',
    [t.admin.reports.chargesDate, t.admin.reports.chargesApartment, t.admin.reports.chargesItem, t.admin.reports.chargesKind, t.admin.reports.chargesQty, t.admin.reports.chargesTenant, t.admin.reports.chargesBaseCost, t.admin.reports.chargesCoef, t.admin.reports.chargesAmount, t.admin.reports.chargesStatus, t.admin.reports.ownership],
    filteredCharges.map((row) => [formatDateTime(row.date), row.apartment_code, row.item_name, row.kind, row.qty, row.tenant_note, row.base_cost, row.coef, row.amount, row.status, ownershipCol(row.owner_code != null, row.owner_code)]))

  const chargeStatusChip = (filter: ChargeStatusFilter) => {
    const labels: Record<ChargeStatusFilter, string> = {
      all: t.admin.reports.chargesAll,
      pending: t.admin.reports.chargesPending,
      paid: t.admin.reports.chargesPaid,
      waived: t.admin.reports.chargesWaived,
    }
    return labels[filter]
  }

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.reports.title}</h1>
        <button onClick={() => setReloadToken((value) => value + 1)} className="text-muted" aria-label={t.admin.reports.refresh}><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="bg-surface border border-line rounded-xl p-3 mb-4">
        <div className="flex gap-2 flex-wrap">
          {(['today', '7', '30', 'custom'] as Period[]).map((value) => (
            <button key={value} onClick={() => setPeriod(value)} className={`px-3 py-1.5 rounded-lg text-sm ${period === value ? 'bg-accent text-white' : 'bg-app text-muted'}`}>
              {value === 'today' ? t.admin.reports.today : value === '7' ? t.admin.reports.days7 : value === '30' ? t.admin.reports.days30 : t.admin.reports.custom}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <label className="text-xs text-muted">{t.admin.reports.from}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block w-full mt-1 bg-app border border-line rounded-lg px-2 py-2 text-sm text-ink" /></label>
            <label className="text-xs text-muted">{t.admin.reports.to}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block w-full mt-1 bg-app border border-line rounded-lg px-2 py-2 text-sm text-ink" /></label>
          </div>
        )}
        <p className="text-xs text-muted mt-3">{dateLabel}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto mb-4">
        {(['expense', 'stock', 'moves', 'charges'] as ReportTab[]).map((value) => (
          <button key={value} onClick={() => setTab(value)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${tab === value ? 'border-accent text-accent font-medium' : 'border-transparent text-muted'}`}>
            {value === 'expense' ? t.admin.reports.expense : value === 'stock' ? t.admin.reports.currentStock : value === 'moves' ? t.admin.reports.moves : t.admin.reports.charges}
          </button>
        ))}
      </div>

      {/* Ownership filter — visible on expense and moves tabs */}
      {showOwnershipFilter && !loading && !error && (
        <div className="flex gap-2 mb-4">
          {(['company', 'owner', 'all'] as OwnershipFilter[]).map((value) => (
            <button key={value} onClick={() => setOwnershipFilter(value)} className={`px-3 py-1.5 rounded-lg text-sm ${ownershipFilter === value ? 'bg-accent text-white' : 'bg-app text-muted'}`}>
              {value === 'company' ? t.admin.reports.ownershipCompany : value === 'owner' ? t.admin.reports.ownershipOwner : t.admin.reports.ownershipAll}
            </button>
          ))}
        </div>
      )}

      {loading ? <p className="text-sm text-muted text-center py-8">{t.app.loading}</p> : error ? <ErrorState message={error} onRetry={() => setReloadToken((k) => k + 1)} /> : (
        <>
          {tab === 'expense' && <ReportCard title={t.admin.reports.expense} onExport={exportExpense} exportLabel={t.admin.reports.export}>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>{t.admin.reports.apartment}</Th><Th>{t.admin.reports.item}</Th><Th>{t.admin.reports.category}</Th><Th>{t.admin.reports.qtyPacks}</Th><Th>{t.admin.reports.cost}</Th></tr></thead><tbody>{expenseRows.map((row) => <tr key={`${row.apartment}-${row.item}-${row.isOwner ? 'o' : 'c'}`} className="border-t border-line"><Td>{row.apartment}{row.isOwner && <span className="ms-1 align-middle"><OwnerBadge /></span>}</Td><Td>{cat.itemName(row.item)}</Td><Td>{cat.categoryName(row.category)}</Td><Td>{n(formatNum(row.qtyPacks, { maximumFractionDigits: 2 }))}</Td><Td>{row.cost == null ? '—' : `${formatCurrency(row.cost, currency)}${row.partial ? ' *' : ''}`}</Td></tr>)}</tbody></table>{expenseRows.length === 0 && <Empty label={t.common.noResults} />}{expenseRows.some((row) => row.partial && row.cost != null) && <p className="text-xs text-muted mt-2">{t.admin.reports.costPartialNote}</p>}</div>
          </ReportCard>}
          {tab === 'stock' && <ReportCard title={t.admin.reports.currentStock} onExport={exportStock} exportLabel={t.admin.reports.export}>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>{t.admin.reports.item}</Th><Th>{t.admin.reports.category}</Th><Th>{t.admin.reports.qtyPacks}</Th><Th>{t.admin.reports.minimum}</Th><Th>{t.common.status}</Th></tr></thead><tbody>{stock.map((row) => <tr key={row.item_id} className="border-t border-line"><Td>{cat.itemName(row.name)}</Td><Td>{cat.categoryName(row.category)}</Td><Td>{n(formatNum(packs(row.qty, row.pack_size), { maximumFractionDigits: 2 }))}</Td><Td>{row.min_stock == null ? '—' : n(formatNum(row.min_stock, { maximumFractionDigits: 2 }))}</Td><Td><span className={row.below_min ? 'text-bad' : 'text-ok'}>{row.below_min ? t.admin.reports.belowMinimum : t.admin.reports.ok}</span></Td></tr>)}</tbody></table>{stock.length === 0 && <Empty label={t.common.noResults} />}</div>
          </ReportCard>}
          {tab === 'moves' && <ReportCard title={t.admin.reports.moves} onExport={exportMoves} exportLabel={t.admin.reports.export}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3"><select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} className="bg-app border border-line rounded-lg px-2 py-2 text-sm text-ink"><option value="all">{t.admin.reports.allItems}</option>{itemOptions.map(([id, name]) => <option key={id} value={id}>{cat.itemName(name)}</option>)}</select><select value={apartmentFilter} onChange={(e) => setApartmentFilter(e.target.value)} className="bg-app border border-line rounded-lg px-2 py-2 text-sm text-ink"><option value="all">{t.admin.reports.allApartments}</option>{apartmentOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="bg-app border border-line rounded-lg px-2 py-2 text-sm text-ink"><option value="all">{t.admin.reports.allSources}</option>{sourceOptions.map((source) => <option key={source} value={source}>{t.admin.stock.sourceTypes[source as keyof typeof t.admin.stock.sourceTypes] ?? source}</option>)}</select></div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>{t.admin.reports.date}</Th><Th>{t.admin.reports.item}</Th><Th>{t.admin.reports.apartment}</Th><Th>{t.admin.reports.sourceType}</Th><Th>{t.admin.reports.qty}</Th><Th>{t.admin.reports.unitCost}</Th></tr></thead><tbody>{filteredMoves.map((move) => <tr key={move.id} className="border-t border-line"><Td>{formatDateTime(move.moved_at)}</Td><Td>{cat.itemName(move.item_name)}</Td><Td>{move.apartment_code ?? '—'}{move.owner_apartment_id != null && <span className="ms-1 align-middle"><OwnerBadge /></span>}</Td><Td>{t.admin.stock.sourceTypes[move.source_type as keyof typeof t.admin.stock.sourceTypes] ?? move.source_type}</Td><Td>{n(formatNum(move.qty, { maximumFractionDigits: 3 }))}</Td><Td>{move.unit_cost == null ? '—' : formatCurrency(move.unit_cost, currency)}</Td></tr>)}</tbody></table>{filteredMoves.length === 0 && <Empty label={t.common.noResults} />}</div>
          </ReportCard>}
          {tab === 'charges' && <ReportCard title={t.admin.reports.charges} onExport={exportCharges} exportLabel={t.admin.reports.export}>
            {chargesError ? <p className="text-sm text-bad text-center py-6">{chargesError}</p> : (<>
            <div className="flex gap-2 mb-3 flex-wrap">
              {(['all', 'pending', 'paid', 'waived'] as ChargeStatusFilter[]).map((value) => (
                <button key={value} onClick={() => setChargeStatusFilter(value)} className={`px-3 py-1.5 rounded-lg text-sm ${chargeStatusFilter === value ? 'bg-accent text-white' : 'bg-app text-muted'}`}>
                  {chargeStatusChip(value)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <SummaryCard label={t.admin.reports.chargesPending} amount={chargesTotalsData.pending.sum} count={chargesTotalsData.pending.count} currency={currency} tone="warn" />
              <SummaryCard label={t.admin.reports.chargesPaid} amount={chargesTotalsData.paid.sum} count={chargesTotalsData.paid.count} currency={currency} tone="ok" />
              <SummaryCard label={t.admin.reports.chargesWaived} amount={chargesTotalsData.waived.sum} count={chargesTotalsData.waived.count} currency={currency} tone="muted" />
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>{t.admin.reports.chargesDate}</Th><Th>{t.admin.reports.chargesApartment}</Th><Th>{t.admin.reports.chargesItem}</Th><Th>{t.admin.reports.chargesKind}</Th><Th>{t.admin.reports.chargesQty}</Th><Th>{t.admin.reports.chargesTenant}</Th><Th>{t.admin.reports.chargesBaseCost}</Th><Th>{t.admin.reports.chargesCoef}</Th><Th>{t.admin.reports.chargesAmount}</Th><Th>{t.admin.reports.chargesStatus}</Th></tr></thead><tbody>{filteredCharges.map((row) => <tr key={row.incident_id} className="border-t border-line"><Td>{formatDateTime(row.date)}</Td><Td>{row.apartment_code}{row.owner_code != null && <span className="ms-1 align-middle"><OwnerBadge /></span>}</Td><Td>{cat.itemName(row.item_name)}</Td><Td>{row.kind}</Td><Td>{n(formatNum(row.qty, { maximumFractionDigits: 3 }))}</Td><Td>{row.tenant_note ?? '—'}</Td><Td>{formatCurrency(row.base_cost, currency)}</Td><Td>{n(formatNum(row.coef, { maximumFractionDigits: 3 }))}</Td><Td>{formatCurrency(row.amount, currency)}</Td><Td>{row.status === 'pending' ? t.admin.reports.chargesPending : row.status === 'paid' ? t.admin.reports.chargesPaid : t.admin.reports.chargesWaived}</Td></tr>)}</tbody></table>{filteredCharges.length === 0 && <Empty label={t.admin.reports.chargesEmpty} />}</div>
          
            </>)}
          </ReportCard>}
        </>
      )}
    </div>
  )
}

function ReportCard({ title, onExport, exportLabel, children }: { title: string; onExport: () => void; exportLabel: string; children: React.ReactNode }) {
  return <section className="bg-surface border border-line rounded-xl overflow-hidden"><div className="flex items-center justify-between px-3 py-3 border-b border-line"><h2 className="font-semibold text-ink text-sm">{title}</h2><button onClick={onExport} className="text-accent text-sm flex items-center gap-1"><Download className="w-4 h-4" />{exportLabel}</button></div><div className="p-3">{children}</div></section>
}

function SummaryCard({ label, amount, count, currency, tone }: { label: string; amount: number; count: number; currency: string; tone: 'ok' | 'warn' | 'muted' }) {
  const toneClass = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-muted'
  return (
    <div className="bg-app rounded-lg px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-base font-semibold ${toneClass}`}>{new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)}</div>
      <div className="text-xs text-muted">{count}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-left font-medium text-muted text-xs px-2 py-2 whitespace-nowrap">{children}</th> }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-2 py-2 text-ink whitespace-nowrap">{children}</td> }
function Empty({ label }: { label: string }) { return <p className="text-sm text-muted text-center py-6">{label}</p> }
