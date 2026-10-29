import { useState, useEffect, useMemo, useCallback } from 'react'
import { fetchToOrder, fetchApartmentGaps, fetchShortageEvents, fetchApartmentsAdmin, fetchBuildings, fetchAllIncidents, fetchPendingCleanings, ackEvents } from '@/modules/admin/api'
import type { ToOrderRow, ApartmentGapRow, Apartment, Building, AptType, Incident, NormalizedShortageEvent } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { friendlyMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { formatQty, relativeTime } from '@/lib/format'
import { TriangleAlert as AlertTriangle, TrendingDown, PackageX, ClipboardList, Boxes, Wrench, ArrowDownToLine, Trash2, CircleCheck as CheckCircle2, X, CheckCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { useLiveRefresh } from '@/lib/realtime'
import { useCatalogName } from '@/modules/core/useCatalogName'

function pctColor(p: number): string {
  if (p >= 100) return 'var(--ok)'
  if (p >= 75) return 'var(--warn)'
  return 'var(--bad)'
}

type BadgeTone = 'ok' | 'warn' | 'bad'
const OVERDUE_HOURS = 24

const BADGE_CLASS: Record<BadgeTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
}

/** Статус по количеству и возрасту самой старой записи: нет записей / новые / ждут больше суток. */
function ageStatus(count: number, oldestIso: string | null): 'clear' | 'new' | 'overdue' {
  if (count === 0) return 'clear'
  if (oldestIso && Date.now() - new Date(oldestIso).getTime() >= OVERDUE_HOURS * 3600 * 1000) return 'overdue'
  return 'new'
}

function oldestOf(dates: string[]): string | null {
  if (dates.length === 0) return null
  return dates.reduce((a, b) => (new Date(a).getTime() <= new Date(b).getTime() ? a : b))
}

function ProgressBar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <span className={`block h-1.5 rounded-full overflow-hidden ${className ?? ''}`} style={{ background: 'var(--line)' }}>
      <span
        className="block h-full rounded-full transition-all"
        style={{ width: `${Math.min(value, 100)}%`, background: color }}
      />
    </span>
  )
}

export function Dashboard() {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const navigate = useNavigate()
  const [toOrder, setToOrder] = useState<ToOrderRow[]>([])
  const [gaps, setGaps] = useState<ApartmentGapRow[]>([])
  const [shortages, setShortages] = useState<NormalizedShortageEvent[]>([])
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [pendingCleanings, setPendingCleanings] = useState(0)
  const [oldestPendingCleaning, setOldestPendingCleaning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const loadData = useCallback(async (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(false) }
    try {
      const [to, ga, sh, ap, bl, inc, pc] = await Promise.all([fetchToOrder(), fetchApartmentGaps(), fetchShortageEvents(), fetchApartmentsAdmin(), fetchBuildings(), fetchAllIncidents(), fetchPendingCleanings().catch(() => [])])
      setToOrder(to)
      setGaps(ga)
      setShortages(sh)
      setApartments(ap)
      setBuildings(bl)
      setIncidents(inc)
      setPendingCleanings(pc.length)
      setOldestPendingCleaning(oldestOf(pc.map((c) => c.created_at)))
    } catch {
      if (!quiet) setLoadError(true)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useLiveRefresh(['incidents', 'apartments', 'buildings', 'events', 'stock_moves', 'items', 'norm_rules', 'cleaning_events'], () => { loadData(true) })

  const handleAck = async (id: number) => {
    try {
      await ackEvents([id])
      setShortages((prev) => prev.filter((ev) => ev.id !== id))
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    }
  }

  const handleAckAll = async () => {
    const ids = shortages.map((ev) => ev.id)
    if (ids.length === 0) return
    try {
      await ackEvents(ids)
      setShortages([])
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    }
  }

  const buildingMap = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])

  const gapApartments = useMemo(() => {
    const map = new Map<number, { code: string; items: ApartmentGapRow[]; totalNorms: number }>()
    for (const g of gaps) {
      const entry = map.get(g.apartment_id) ?? { code: g.code, items: [], totalNorms: 0 }
      entry.totalNorms++
      if (g.gap > 0) entry.items.push(g)
      map.set(g.apartment_id, entry)
    }
    return map
  }, [gaps])

  const apartmentsByType = useMemo(() => {
    const typeOrder: AptType[] = ['studio', '1br', '2br']
    const typeLabels: Record<AptType, string> = {
      studio: t.apartments.typeStudio,
      '1br': t.apartments.type1br,
      '2br': t.apartments.type2br,
    }
    const map = new Map<AptType, Apartment[]>()
    for (const a of apartments) {
      const list = map.get(a.type) ?? []
      list.push(a)
      map.set(a.type, list)
    }
    return typeOrder.filter((t) => map.has(t)).map((t) => [typeLabels[t], map.get(t)!] as const)
  }, [apartments, t.apartments.typeStudio, t.apartments.type1br, t.apartments.type2br])

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }

  if (loadError) {
    return <ErrorState onRetry={loadData} />
  }

  const incompleteCount = Array.from(gapApartments.values()).filter((a) => a.items.length > 0).length
  const newIncidents = incidents.filter((incident) => incident.status === 'new')
  const pendingIncidents = newIncidents.length
  const oldestIncident = oldestOf(newIncidents.map((incident) => incident.created_at))
  const inProgressIncidents = incidents.filter((incident) => incident.status === 'in_progress').length

  const ageBadge = (count: number, oldest: string | null): { text: string; tone: BadgeTone } => {
    const s = ageStatus(count, oldest)
    if (s === 'clear') return { text: t.admin.dashboard.statusClear, tone: 'ok' }
    if (s === 'overdue') return { text: t.admin.dashboard.statusOverdue, tone: 'bad' }
    return { text: t.admin.dashboard.statusNew, tone: 'warn' }
  }

  const cards: Array<{
    key: string; label: string; count: number; icon: typeof TrendingDown; to: string
    badge: { text: string; tone: BadgeTone }; hint?: string
  }> = [
    {
      key: 'incidents', label: t.admin.dashboard.pendingIncidents, count: pendingIncidents, icon: ClipboardList,
      to: '/admin/more/incidents', badge: ageBadge(pendingIncidents, oldestIncident),
      hint: [
        oldestIncident ? `${t.admin.dashboard.oldest}: ${relativeTime(oldestIncident)}` : '',
        inProgressIncidents > 0 ? `${t.incidents.statusInProgress}: ${n(String(inProgressIncidents))}` : '',
      ].filter(Boolean).join(' · ') || undefined,
    },
    {
      key: 'cleanings', label: t.admin.dashboard.pendingCleanings, count: pendingCleanings, icon: CheckCheck,
      to: '/admin/more/cleaning-approvals', badge: ageBadge(pendingCleanings, oldestPendingCleaning),
      hint: oldestPendingCleaning ? `${t.admin.dashboard.oldest}: ${relativeTime(oldestPendingCleaning)}` : undefined,
    },
    {
      key: 'shortages', label: t.admin.dashboard.unprocessedShortages, count: shortages.length, icon: AlertTriangle,
      to: '/admin/stock',
      badge: shortages.length === 0
        ? { text: t.admin.dashboard.statusClear, tone: 'ok' }
        : { text: t.admin.dashboard.statusUnprocessed, tone: 'bad' },
    },
    {
      key: 'toOrder', label: t.admin.dashboard.toOrder, count: toOrder.length, icon: TrendingDown,
      to: '/admin/stock?below=1',
      badge: toOrder.length === 0
        ? { text: t.admin.dashboard.statusClear, tone: 'ok' }
        : { text: t.admin.dashboard.statusNeedOrder, tone: 'bad' },
    },
    {
      key: 'gaps', label: t.admin.dashboard.gaps, count: incompleteCount, icon: Boxes,
      to: '/admin/apartments',
      badge: incompleteCount === 0
        ? { text: t.admin.dashboard.statusClear, tone: 'ok' }
        : { text: t.admin.dashboard.statusIncomplete, tone: 'warn' },
    },
  ]

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl font-semibold text-ink">{t.admin.nav.home}</h1>
        <button
          onClick={() => navigate('/admin/move')}
          className="ml-auto bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5 transition-opacity hover:opacity-90"
        >
          {t.admin.move.title}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-5">
        {cards.map(({ key, label, count, icon: Icon, to, badge, hint }) => (
          <button
            key={key}
            data-testid={`dash-card-${key}`}
            onClick={() => navigate(to)}
            className="bg-surface border border-line rounded-xl px-3.5 py-3 text-left transition-colors hover:border-accent"
            style={badge.tone === 'bad' ? { borderColor: 'var(--bad)' } : undefined}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <Icon className="w-5 h-5 text-muted shrink-0" />
              <span className={`text-[11px] leading-tight px-2 py-0.5 rounded-full font-medium text-center ${BADGE_CLASS[badge.tone]}`}>
                {badge.text}
              </span>
            </div>
            <b className="text-2xl font-semibold text-ink block">{n(String(count))}</b>
            <span className="text-muted text-xs block">{label}</span>
            {hint && <span className="text-muted text-[11px] block mt-1">{hint}</span>}
          </button>
        ))}
      </div>

      <section className="bg-surface border border-line rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold text-ink mb-3">{t.admin.dashboard.quickActions}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <button onClick={() => navigate('/admin/move?op=receipt')} className="flex items-center gap-2 bg-app rounded-lg px-3 py-2.5 text-sm text-ink hover:bg-accent-soft"><ArrowDownToLine className="w-4 h-4 text-accent" />{t.admin.move.receipt}</button>
          <button onClick={() => navigate('/admin/move?op=issue_apartment')} className="flex items-center gap-2 bg-app rounded-lg px-3 py-2.5 text-sm text-ink hover:bg-accent-soft"><Wrench className="w-4 h-4 text-accent" />{t.admin.dashboard.issue}</button>
          <button onClick={() => navigate('/admin/move?op=writeoff_warehouse')} className="flex items-center gap-2 bg-app rounded-lg px-3 py-2.5 text-sm text-ink hover:bg-accent-soft"><Trash2 className="w-4 h-4 text-accent" />{t.admin.dashboard.writeoff}</button>
          <button onClick={() => navigate('/admin/apartments')} className="flex items-center gap-2 bg-app rounded-lg px-3 py-2.5 text-sm text-ink hover:bg-accent-soft"><CheckCircle2 className="w-4 h-4 text-accent" />{t.admin.dashboard.assemble}</button>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5">
        {/* Left: to-order */}
        <section className="bg-surface border border-line rounded-xl p-4">
          <h2 className="text-base font-semibold text-ink mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-bad" />
            {t.admin.dashboard.toOrder}
          </h2>
          {toOrder.length === 0 ? (
            <p className="text-muted text-sm">{t.admin.dashboard.noToOrder}</p>
          ) : (
            <>
              {toOrder.slice(0, 10).map((r) => {
                const ratio = r.min_stock > 0 ? (r.qty / r.min_stock) * 100 : 0
                return (
                  <div key={r.item_id} className="flex items-center gap-3 py-2.5 border-t border-line first:border-t-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">{cat.itemName(r.name)}</div>
                      <div className="text-muted text-xs">{cat.categoryName(r.category)}, {n(formatQty(r.qty, r))} / {n(formatQty(r.min_stock, r))}</div>
                      <ProgressBar value={ratio} color="var(--bad)" className="mt-1.5" />
                    </div>
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-bad-soft text-bad">
                      {t.admin.dashboard.shortage}: {n(formatQty(r.shortage, r))}
                    </span>
                  </div>
                )
              })}
              <button
                onClick={() => navigate('/admin/move')}
                className="mt-3 bg-surface border border-line text-ink rounded-lg px-3.5 py-2 text-sm font-medium transition-colors hover:bg-app"
              >
                {t.admin.move.receipt}
              </button>
            </>
          )}
        </section>

        {/* Right: apartment tiles by type */}
        <section className="bg-surface border border-line rounded-xl p-4">
          <h2 className="text-base font-semibold text-ink mb-3 flex items-center gap-2">
            <PackageX className="w-4 h-4 text-warn" />
            {t.admin.apartments.completeness}
          </h2>
          {apartmentsByType.map(([typeLabel, apts]) => (
            <div key={typeLabel}>
              <div className="font-semibold text-sm text-ink mt-4 mb-2 first:mt-0">{typeLabel}</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
                {apts.map((apt) => {
                  const gapData = gapApartments.get(apt.id)
                  const total = gapData?.totalNorms ?? 0
                  const missing = gapData?.items.length ?? 0
                  const p = total > 0 ? Math.round(((total - missing) / total) * 100) : 100
                  const missingQty = gapData?.items.reduce((s, x) => s + x.gap, 0) ?? 0
                  return (
                    <button
                      key={apt.id}
                      onClick={() => navigate(`/admin/apartments/${apt.id}`)}
                      className="text-left bg-surface border border-line rounded-lg px-3 py-2.5 transition-colors hover:border-accent"
                    >
                      <b className="text-base text-ink">{apt.code}</b>
                      <div className="text-muted text-xs">{buildingMap.get(apt.building_id) ?? '?'}</div>
                      <ProgressBar value={p} color={pctColor(p)} className="mt-1.5" />
                      <div className="text-muted text-xs mt-1">
                        {missingQty > 0 ? `${t.admin.dashboard.gap} ${n(String(missingQty))}` : t.admin.apartments.completeness}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* Shortage events */}
      {shortages.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-bad" />
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">{t.admin.dashboard.unprocessedShortages}</h2>
            </div>
            <button
              onClick={handleAckAll}
              className="flex items-center gap-1 text-xs text-muted hover:text-ok font-medium"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {t.admin.dashboard.ackAll}
            </button>
          </div>
          <div className="space-y-2">
            {shortages.map((ev) => (
              <div key={ev.id} className="bg-surface rounded-xl border border-line px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {ev.items.map((it, i) => (
                      <p key={i} className="text-sm text-bad">
                        {cat.itemName(it.name)}: {n(String(it.qty))}
                      </p>
                    ))}
                  </div>
                  <button
                    onClick={() => handleAck(ev.id)}
                    className="text-muted hover:text-bad shrink-0 p-1"
                    aria-label={t.admin.dashboard.ackOne}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
