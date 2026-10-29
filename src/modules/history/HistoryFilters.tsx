import { useState } from 'react'
import { ChevronDown, ChevronUp, X, Search } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { EventStatus, IncidentStatus, IncidentKind } from '@/lib/database.types'

interface FilterChip {
  key: string
  label: string
}

interface CommonProps {
  search: string
  dateFrom: string
  dateTo: string
  hasMedia: boolean
  onSearch: (v: string) => void
  onDateFrom: (v: string) => void
  onDateTo: (v: string) => void
  onHasMedia: (v: boolean) => void
  onReset: () => void
  total: number
}

interface CleaningFilterProps extends CommonProps {
  type: 'cleaning'
  status: EventStatus | ''
  leadStaff: string
  onStatus: (v: EventStatus | '') => void
  onLeadStaff: (v: string) => void
}

interface IncidentFilterProps extends CommonProps {
  type: 'incident'
  status: IncidentStatus | ''
  kind: IncidentKind | ''
  onStatus: (v: IncidentStatus | '') => void
  onKind: (v: IncidentKind | '') => void
}

type Props = CleaningFilterProps | IncidentFilterProps

export function HistoryFilters(props: Props) {
  const { t, n } = useI18n()
  const [expanded, setExpanded] = useState(false)

  const activeChips: FilterChip[] = []
  if (props.search.trim()) activeChips.push({ key: 'search', label: `"${props.search.trim()}"` })
  if (props.dateFrom) activeChips.push({ key: 'dateFrom', label: `${t.admin.reports.from}: ${props.dateFrom}` })
  if (props.dateTo) activeChips.push({ key: 'dateTo', label: `${t.admin.reports.to}: ${props.dateTo}` })
  if (props.hasMedia) activeChips.push({ key: 'hasMedia', label: t.history.withMedia })
  if (props.type === 'cleaning' && props.status) {
    activeChips.push({ key: 'status', label: props.status === 'done' ? t.admin.apartments.done : t.admin.apartments.reversed })
  }
  if (props.type === 'cleaning' && props.leadStaff.trim()) {
    activeChips.push({ key: 'leadStaff', label: props.leadStaff.trim() })
  }
  if (props.type === 'incident' && props.status) {
    const labels: Record<IncidentStatus, string> = {
      new: t.incidents.statusNew,
      in_progress: t.incidents.statusInProgress,
      confirmed: t.incidents.statusConfirmed,
      rejected: t.incidents.statusRejected,
    }
    activeChips.push({ key: 'status', label: labels[props.status] })
  }
  if (props.type === 'incident' && props.kind) {
    const labels: Record<IncidentKind, string> = {
      breakdown: t.incidents.kindBreakdown,
      broken: t.incidents.kindBroken,
      damaged: t.incidents.kindDamaged,
      lost: t.incidents.kindLost,
      other: t.incidents.kindOther,
    }
    activeChips.push({ key: 'kind', label: labels[props.kind] })
  }

  const removeChip = (key: string) => {
    if (key === 'search') props.onSearch('')
    if (key === 'dateFrom') props.onDateFrom('')
    if (key === 'dateTo') props.onDateTo('')
    if (key === 'hasMedia') props.onHasMedia(false)
    if (key === 'status') props.onStatus('')
    if (key === 'leadStaff' && props.type === 'cleaning') props.onLeadStaff('')
    if (key === 'kind' && props.type === 'incident') props.onKind('')
  }

  const hasActive = activeChips.length > 0

  return (
    <div className="bg-surface rounded-xl border border-line" data-testid="history-filters">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
        data-testid="filters-toggle"
      >
        <span className="text-sm font-medium text-ink flex items-center gap-2">
          <Search className="w-4 h-4 text-muted" />
          {t.history.filters}
          {props.total > 0 && <span className="text-xs text-muted">({n(String(props.total))})</span>}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
      </button>

      {hasActive && !expanded && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => removeChip(chip.key)}
              className="inline-flex items-center gap-1 bg-accent-soft text-accent text-xs px-2.5 py-1 rounded-full"
            >
              {chip.label}
              <X className="w-3 h-3" />
            </button>
          ))}
          {hasActive && (
            <button onClick={props.onReset} className="text-xs text-muted px-2.5 py-1">
              {t.history.reset}
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <input
              type="text"
              value={props.search}
              onChange={(e) => props.onSearch(e.target.value)}
              placeholder={t.history.searchPlaceholder}
              data-testid="search-input"
              className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted mb-1">{t.admin.reports.from}</label>
              <input
                type="date"
                value={props.dateFrom}
                onChange={(e) => props.onDateFrom(e.target.value)}
                data-testid="date-from"
                className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">{t.admin.reports.to}</label>
              <input
                type="date"
                value={props.dateTo}
                onChange={(e) => props.onDateTo(e.target.value)}
                data-testid="date-to"
                className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={props.hasMedia}
              onChange={(e) => props.onHasMedia(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent)]"
            />
            <span className="text-sm text-ink">{t.history.withMedia}</span>
          </label>
          {props.type === 'cleaning' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted mb-1">{t.common.status}</label>
                <select
                  value={props.status}
                  onChange={(e) => props.onStatus(e.target.value as EventStatus | '')}
                  className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
                >
                  <option value="">{t.history.all}</option>
                  <option value="done">{t.admin.apartments.done}</option>
                  <option value="reversed">{t.admin.apartments.reversed}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">{t.cleaning.leadStaff}</label>
                <input
                  type="text"
                  value={props.leadStaff}
                  onChange={(e) => props.onLeadStaff(e.target.value)}
                  placeholder={t.history.searchPlaceholder}
                  className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
                />
              </div>
            </div>
          )}
          {props.type === 'incident' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted mb-1">{t.common.status}</label>
                <select
                  value={props.status}
                  onChange={(e) => props.onStatus(e.target.value as IncidentStatus | '')}
                  className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
                >
                  <option value="">{t.history.all}</option>
                  <option value="new">{t.incidents.statusNew}</option>
                  <option value="in_progress">{t.incidents.statusInProgress}</option>
                  <option value="confirmed">{t.incidents.statusConfirmed}</option>
                  <option value="rejected">{t.incidents.statusRejected}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">{t.incidents.kind}</label>
                <select
                  value={props.kind}
                  onChange={(e) => props.onKind(e.target.value as IncidentKind | '')}
                  className="w-full bg-app rounded-lg px-3 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
                >
                  <option value="">{t.history.all}</option>
                  <option value="breakdown">{t.incidents.kindBreakdown}</option>
                  <option value="broken">{t.incidents.kindBroken}</option>
                  <option value="damaged">{t.incidents.kindDamaged}</option>
                  <option value="lost">{t.incidents.kindLost}</option>
                  <option value="other">{t.incidents.kindOther}</option>
                </select>
              </div>
            </div>
          )}
          {hasActive && (
            <button onClick={props.onReset} className="text-sm text-muted hover:text-accent" data-testid="filters-reset">
              {t.history.reset}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
