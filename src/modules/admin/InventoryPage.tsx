import { useState, useEffect, useCallback, useMemo } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { formatDate, formatQty } from '@/lib/format'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  fetchInventories,
  fetchInventoryLines,
  fetchApartmentsAdmin,
  fetchWarehouseStock,
  startInventory,
  setInventoryActual,
  closeInventory,
  cancelInventory,
  type InventoryRow,
  type InventoryLine,
  type InventoryStatus,
} from '@/modules/admin/api'
import type { Apartment, WarehouseStockRow } from '@/lib/database.types'
import { ClipboardCheck, ChevronRight, X, Loader } from 'lucide-react'

type Filter = 'all' | InventoryStatus

const round3 = (x: number) => Math.round(x * 1000) / 1000
const fmt = (x: number) => String(round3(x))

function statusClass(s: InventoryStatus): string {
  if (s === 'open') return 'bg-accent-soft text-accent'
  if (s === 'closed') return 'bg-ok-soft text-ok'
  return 'bg-app text-muted'
}

export function InventoryPage() {
  const { t } = useI18n()
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const statusLabel: Record<InventoryStatus, string> = {
    open: t.admin.inventory.statusOpen,
    closed: t.admin.inventory.statusClosed,
    void: t.admin.inventory.statusVoid,
  }

  const load = useCallback((silent?: boolean) => {
    if (!silent) { setLoading(true); setLoadError(false) }
    fetchInventories()
      .then(setRows)
      .catch((e) => { if (!silent) { setLoadError(true); toast(errorMessage(e), 'error') } })
      .finally(() => { if (!silent) setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['inventories', 'inventory_lines'], () => load(true))

  const shown = rows.filter((r) => filter === 'all' || r.status === filter)
  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: t.admin.inventory.filterAll },
    { key: 'open', label: statusLabel.open },
    { key: 'closed', label: statusLabel.closed },
    { key: 'void', label: statusLabel.void },
  ]
  const current = rows.find((r) => r.id === openId) ?? null

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.inventory.title}</h1>
        <button
          onClick={() => setStarting(true)}
          className="bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"
        >
          <ClipboardCheck className="w-4 h-4" />
          {t.admin.inventory.start}
        </button>
      </div>

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
      ) : loadError && rows.length === 0 ? (
        <ErrorState onRetry={() => load()} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.inventory.empty}</p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <button
              key={r.id}
              onClick={() => setOpenId(r.id)}
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-accent transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {r.scope === 'warehouse' ? t.admin.inventory.scopeWarehouse : `${t.admin.inventory.scopeApartment} ${r.apartment_code ?? ''}`}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{statusLabel[r.status]}</span>
                </div>
                <div className="text-xs text-muted truncate">
                  {formatDate(r.created_at)}{r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted shrink-0" />
            </button>
          ))}
        </div>
      )}

      {starting && (
        <StartModal
          onClose={() => setStarting(false)}
          onStarted={(id) => { setStarting(false); load(true); setOpenId(id) }}
        />
      )}
      {current && (
        <InventorySheet inv={current} onClose={() => setOpenId(null)} onChanged={() => load(true)} />
      )}
    </div>
  )
}

function StartModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const { t } = useI18n()
  const [scope, setScope] = useState<'warehouse' | 'apartment'>('warehouse')
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [apartmentId, setApartmentId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchApartmentsAdmin().then(setApartments).catch((e) => toast(errorMessage(e), 'error'))
  }, [])

  const begin = async () => {
    if (busy) return
    setBusy(true)
    try {
      const id = await startInventory(scope, scope === 'apartment' ? Number(apartmentId) : null, note.trim() || null)
      toast(t.admin.inventory.started, 'success')
      onStarted(id)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const tabCls = (active: boolean) =>
    `flex-1 rounded-lg py-2.5 text-sm font-medium border ${active ? 'bg-accent border-accent text-white' : 'bg-app border-line text-muted'}`

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line max-h-[90vh] overflow-auto max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{t.admin.inventory.startTitle}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setScope('warehouse')} className={tabCls(scope === 'warehouse')}>{t.admin.inventory.scopeWarehouse}</button>
            <button onClick={() => setScope('apartment')} className={tabCls(scope === 'apartment')}>{t.admin.inventory.scopeApartment}</button>
          </div>
          {scope === 'apartment' && (
            <select value={apartmentId} onChange={(e) => setApartmentId(e.target.value)}
              className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none">
              <option value="">{t.admin.inventory.chooseApartment}</option>
              {apartments.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
            </select>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t.admin.inventory.note}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-xl py-3 text-sm font-medium">{t.cleaning.cancel}</button>
          <button onClick={begin} disabled={busy || (scope === 'apartment' && !apartmentId)}
            className="flex-1 bg-accent text-white rounded-xl py-3 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
            {busy && <Loader className="w-4 h-4 animate-spin" />}
            {t.admin.inventory.begin}
          </button>
        </div>
      </div>
    </>
  )
}

interface LineState extends InventoryLine {
  actStr: string
  reject: boolean
}

function InventorySheet({ inv, onClose, onChanged }: { inv: InventoryRow; onClose: () => void; onChanged: () => void }) {
  const { t, n } = useI18n()
  const [lines, setLines] = useState<LineState[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const [stock, setStock] = useState<WarehouseStockRow[]>([])
  const [addId, setAddId] = useState('')

  const isOpen = inv.status === 'open'

  const loadLines = useCallback(() => {
    setLoading(true)
    fetchInventoryLines(inv.id)
      .then((rows) => setLines(rows.map((l) => ({
        ...l,
        actStr: fmt(l.actual / l.pack_size),
        reject: l.decision === 'rejected',
      }))))
      .catch((e) => toast(errorMessage(e), 'error'))
      .finally(() => setLoading(false))
  }, [inv.id])

  useEffect(() => { loadLines() }, [loadLines])
  useEffect(() => {
    if (isOpen) fetchWarehouseStock().then(setStock).catch(() => setStock([]))
  }, [isOpen])

  const patch = (itemId: number, p: Partial<LineState>) =>
    setLines((prev) => prev.map((l) => (l.item_id === itemId ? { ...l, ...p } : l)))

  const isChanged = (l: LineState) => Number(l.actStr) !== round3(l.actual / l.pack_size)
  const dirty = lines.some(isChanged)
  const invalid = lines.some((l) => l.actStr.trim() === '' || !(Number(l.actStr) >= 0))

  const run = async (fn: () => Promise<string | void>, okMsg: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      const extra = await fn()
      toast(extra ? `${okMsg} ${extra}` : okMsg, 'success')
      onChanged()
      return true
    } catch (e) {
      toast(errorMessage(e), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveFact = () => run(async () => {
    for (const l of lines) {
      if (isChanged(l)) await setInventoryActual(inv.id, l.item_id, round3(Number(l.actStr) * l.pack_size))
    }
    loadLines()
  }, t.admin.inventory.factSaved)

  const addItem = () => run(async () => {
    await setInventoryActual(inv.id, Number(addId), 0)
    setAddId('')
    loadLines()
  }, t.admin.inventory.itemAdded)

  const doClose = () => run(async () => {
    const rejected = lines.filter((l) => l.reject).map((l) => l.item_id)
    const adjusted = await closeInventory(inv.id, rejected)
    return `${t.admin.inventory.adjusted} ${n(String(adjusted))}`
  }, t.admin.inventory.closedOk)

  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () => lines.filter((l) => !q || l.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)),
    [lines, q],
  )
  const addable = stock.filter((s) => !lines.some((l) => l.item_id === s.item_id))
  const title = inv.scope === 'warehouse' ? t.admin.inventory.scopeWarehouse : `${t.admin.inventory.scopeApartment} ${inv.apartment_code ?? ''}`
  const inputCls = 'w-full bg-app rounded-lg px-3 py-2 text-sm focus:outline-none'

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-surface rounded-2xl w-full max-w-lg p-5 border border-line max-h-[90vh] overflow-auto max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none max-md:max-h-[85vh]">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <p className="text-xs text-muted mb-3">
          {formatDate(inv.created_at)}{inv.note ? ` · ${inv.note}` : ''}
        </p>
        {isOpen && <p className="text-xs text-muted bg-app rounded-lg px-3 py-2 mb-3">{t.admin.inventory.countHint}</p>}

        {lines.length > 6 && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.admin.inventory.search}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none mb-3" />
        )}

        {loading ? (
          <div className="text-center text-muted text-sm py-6">{t.app.loading}</div>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">{t.admin.inventory.noLines}</p>
        ) : (
          <div className="space-y-2">
            {shown.map((l) => {
              const diff = round3(Number(l.actStr || 0) * l.pack_size - l.expected)
              return (
                <div key={l.item_id} className="border border-line rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{l.name}</div>
                      <div className="text-xs text-muted">{t.admin.inventory.expected}: {n(formatQty(l.expected, l))}</div>
                    </div>
                    {!isOpen && (
                      <span className={`text-xs shrink-0 ${l.decision === 'accepted' ? 'text-ok' : 'text-muted'}`}>
                        {l.decision === 'accepted' ? t.admin.inventory.accepted : l.decision === 'rejected' ? t.admin.inventory.rejected : ''}
                      </span>
                    )}
                  </div>
                  {isOpen ? (
                    <div className="mt-2 flex items-end gap-3">
                      <label className="block flex-1">
                        <span className="block text-xs text-muted mb-1">{t.admin.inventory.actual}</span>
                        <input type="number" min="0" step="any" value={l.actStr}
                          onChange={(e) => patch(l.item_id, { actStr: e.target.value })} className={inputCls} />
                      </label>
                      <div className={`text-sm w-24 text-right pb-2 ${diff < 0 ? 'text-bad' : diff > 0 ? 'text-ok' : 'text-muted'}`}>
                        {diff === 0 ? '0' : `${diff > 0 ? '+' : '−'}${n(formatQty(Math.abs(diff), l))}`}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-ink">{t.admin.inventory.actualShort}: {n(formatQty(l.actual, l))}</div>
                  )}
                  {isOpen && (
                    <label className="flex items-center gap-2 text-xs text-muted mt-2">
                      <input type="checkbox" checked={l.reject} onChange={(e) => patch(l.item_id, { reject: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]" />
                      {t.admin.inventory.skip}
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {isOpen && (
          <div className="flex gap-2 mt-3">
            <select value={addId} onChange={(e) => setAddId(e.target.value)} className="flex-1 bg-app rounded-lg px-3 py-2.5 text-sm focus:outline-none min-w-0">
              <option value="">{t.admin.inventory.addItem}</option>
              {addable.map((s) => <option key={s.item_id} value={s.item_id}>{s.name}</option>)}
            </select>
            <button onClick={addItem} disabled={busy || !addId || dirty}
              className="bg-app text-ink rounded-lg px-4 text-sm font-medium disabled:opacity-40">{t.admin.inventory.add}</button>
          </div>
        )}

        {isOpen && dirty && <p className="text-xs text-muted mt-3">{t.admin.inventory.unsaved}</p>}

        {isOpen && (
          <div className="flex gap-2 mt-4 flex-wrap">
            <button onClick={saveFact} disabled={busy || !dirty || invalid}
              className="flex-1 bg-app text-ink rounded-xl py-3 text-sm font-medium disabled:opacity-40">{t.admin.inventory.saveFact}</button>
            <button onClick={() => setConfirm('close')} disabled={busy || dirty || invalid || lines.length === 0}
              className="flex-1 bg-accent text-white rounded-xl py-3 text-sm font-medium disabled:opacity-40">{t.admin.inventory.closeInv}</button>
            <button onClick={() => setConfirm('cancel')} disabled={busy}
              className="bg-bad-soft text-bad rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-40">{t.admin.inventory.cancelInv}</button>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          open={true}
          tone={confirm === 'cancel' ? 'bad' : 'warn'}
          title={confirm === 'close' ? t.admin.inventory.closeTitle : t.admin.inventory.cancelTitle}
          message={confirm === 'close' ? t.admin.inventory.closeBody : t.admin.inventory.cancelBody}
          confirmLabel={confirm === 'close' ? t.admin.inventory.closeInv : t.admin.inventory.cancelInv}
          cancelLabel={t.cleaning.cancel}
          onConfirm={() => {
            const action = confirm
            setConfirm(null)
            const p = action === 'close'
              ? doClose()
              : run(() => cancelInventory(inv.id), t.admin.inventory.cancelledOk)
            p.then((ok) => { if (ok) onClose() })
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
