import { useState, useEffect, useCallback } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { formatDate, formatQty } from '@/lib/format'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  fetchPurchaseOrders,
  fetchPurchaseOrderLines,
  generatePurchaseOrders,
  setPurchaseOrderLine,
  setPurchaseOrderStatus,
  receivePurchaseOrder,
  type PurchaseOrderRow,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
} from '@/modules/admin/api'
import { ShoppingCart, ChevronRight, X, Loader } from 'lucide-react'

type Filter = 'all' | PurchaseOrderStatus

const round3 = (x: number) => Math.round(x * 1000) / 1000
const fmt = (x: number) => String(round3(x))

function statusClass(s: PurchaseOrderStatus): string {
  if (s === 'draft') return 'bg-app text-muted'
  if (s === 'sent') return 'bg-accent-soft text-accent'
  if (s === 'received') return 'bg-ok-soft text-ok'
  return 'bg-bad-soft text-bad'
}

export function OrdersPage() {
  const { t, n } = useI18n()
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const statusLabel: Record<PurchaseOrderStatus, string> = {
    draft: t.admin.orders.statusDraft,
    sent: t.admin.orders.statusSent,
    received: t.admin.orders.statusReceived,
    cancelled: t.admin.orders.statusCancelled,
  }

  const load = useCallback((silent?: boolean) => {
    if (!silent) { setLoading(true); setLoadError(false) }
    fetchPurchaseOrders()
      .then(setOrders)
      .catch((e) => { if (!silent) { setLoadError(true); toast(errorMessage(e), 'error') } })
      .finally(() => { if (!silent) setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['purchase_orders', 'purchase_order_lines'], () => load(true))

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    try {
      const created = await generatePurchaseOrders()
      if (created > 0) toast(`${t.admin.orders.generated} ${n(String(created))}`, 'success')
      else toast(t.admin.orders.nothingToOrder, 'info')
      load(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setGenerating(false)
    }
  }

  const shown = orders.filter((o) => filter === 'all' || o.status === filter)
  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: t.admin.orders.filterAll },
    { key: 'draft', label: statusLabel.draft },
    { key: 'sent', label: statusLabel.sent },
    { key: 'received', label: statusLabel.received },
    { key: 'cancelled', label: statusLabel.cancelled },
  ]
  const openOrder = orders.find((o) => o.id === openId) ?? null

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.orders.title}</h1>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
        >
          {generating ? <Loader className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
          {t.admin.orders.generate}
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
      ) : loadError && orders.length === 0 ? (
        <ErrorState onRetry={() => load()} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.orders.empty}</p>
      ) : (
        <div className="space-y-2">
          {shown.map((o) => (
            <button
              key={o.id}
              onClick={() => setOpenId(o.id)}
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 flex items-center gap-3 text-left hover:border-accent transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{o.number ?? '—'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(o.status)}`}>{statusLabel[o.status]}</span>
                </div>
                <div className="text-xs text-muted truncate">
                  {o.supplier ?? t.admin.orders.noSupplier} · {formatDate(o.created_at)} · {t.admin.orders.linesCount}: {n(String(o.lines))}
                  {o.status === 'sent' && o.received_qty > 0 && ` · ${t.admin.orders.partlyReceived}`}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted shrink-0" />
            </button>
          ))}
        </div>
      )}

      {openOrder && (
        <OrderSheet
          order={openOrder}
          onClose={() => setOpenId(null)}
          onChanged={() => load(true)}
        />
      )}
    </div>
  )
}

interface LineState extends PurchaseOrderLine {
  qtyStr: string
  priceStr: string
  recvStr: string
}

function OrderSheet({ order, onClose, onChanged }: { order: PurchaseOrderRow; onClose: () => void; onChanged: () => void }) {
  const { t, n } = useI18n()
  const [lines, setLines] = useState<LineState[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'send' | 'cancel' | null>(null)

  const isDraft = order.status === 'draft'
  const isSent = order.status === 'sent'

  const loadLines = useCallback(() => {
    setLoading(true)
    fetchPurchaseOrderLines(order.id)
      .then((rows) => setLines(rows.map((l) => ({
        ...l,
        qtyStr: fmt(l.qty / l.pack_size),
        priceStr: l.unit_cost != null ? fmt(l.unit_cost * l.pack_size) : '',
        recvStr: fmt(Math.max(l.qty - l.received_qty, 0) / l.pack_size),
      }))))
      .catch((e) => toast(errorMessage(e), 'error'))
      .finally(() => setLoading(false))
  }, [order.id])

  useEffect(() => { loadLines() }, [loadLines])

  const patch = (itemId: number, p: Partial<LineState>) =>
    setLines((prev) => prev.map((l) => (l.item_id === itemId ? { ...l, ...p } : l)))

  const dirty = lines.some((l) =>
    Number(l.qtyStr) !== round3(l.qty / l.pack_size) ||
    (l.priceStr.trim() === '' ? l.unit_cost != null : l.unit_cost == null || Math.abs(Number(l.priceStr) - l.unit_cost * l.pack_size) > 1e-6),
  )
  const invalidDraft = lines.some((l) => !(Number(l.qtyStr) >= 0) || (l.priceStr.trim() !== '' && !(Number(l.priceStr) >= 0)))

  const run = async (fn: () => Promise<void>, okMsg: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      await fn()
      toast(okMsg, 'success')
      onChanged()
      return true
    } catch (e) {
      toast(errorMessage(e), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = () => run(async () => {
    for (const l of lines) {
      const packs = Number(l.qtyStr)
      const cost = l.priceStr.trim() === '' ? null : Number(l.priceStr) / l.pack_size
      const changed = packs !== round3(l.qty / l.pack_size) ||
        (cost == null ? l.unit_cost != null : l.unit_cost == null || Math.abs(cost - l.unit_cost) > 1e-9)
      if (changed) await setPurchaseOrderLine(order.id, l.item_id, round3(packs * l.pack_size), cost)
    }
    loadLines()
  }, t.admin.orders.saved)

  const recvInvalid = lines.some((l) => {
    const r = Number(l.recvStr)
    const left = Math.max(l.qty - l.received_qty, 0) / l.pack_size
    return !(r >= 0) || r > left + 1e-9
  })
  const recvTotal = lines.reduce((s, l) => s + (Number(l.recvStr) > 0 ? 1 : 0), 0)

  const receive = () => run(async () => {
    const payload = lines
      .filter((l) => Number(l.recvStr) > 0)
      .map((l) => ({
        item_id: l.item_id,
        qty: round3(Number(l.recvStr) * l.pack_size),
        unit_cost: l.priceStr.trim() === '' ? l.unit_cost : Number(l.priceStr) / l.pack_size,
      }))
    await receivePurchaseOrder(order.id, payload)
    loadLines()
  }, t.admin.orders.receivedOk)

  const inputCls = 'w-full bg-app rounded-lg px-3 py-2 text-sm focus:outline-none'

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-surface rounded-2xl w-full max-w-lg p-5 border border-line max-h-[90vh] overflow-auto max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none max-md:max-h-[85vh]">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-ink">{order.number ?? '—'}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <p className="text-xs text-muted mb-3">
          {order.supplier ?? t.admin.orders.noSupplier} · {formatDate(order.created_at)}
          {order.est_cost != null && ` · ${t.admin.orders.estCost}: ${n(String(Math.round(order.est_cost)))}`}
        </p>

        {loading ? (
          <div className="text-center text-muted text-sm py-6">{t.app.loading}</div>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">{t.admin.orders.noLines}</p>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => {
              const left = Math.max(l.qty - l.received_qty, 0)
              return (
                <div key={l.item_id} className="border border-line rounded-xl p-3">
                  <div className="text-sm font-medium text-ink">{l.name}</div>
                  <div className="text-xs text-muted mb-2">
                    {t.admin.orders.ordered}: {n(formatQty(l.qty, l))}
                    {l.received_qty > 0 && ` · ${t.admin.orders.received}: ${n(formatQty(l.received_qty, l))}`}
                    {isSent && left > 0 && ` · ${t.admin.orders.outstanding}: ${n(formatQty(left, l))}`}
                  </div>
                  {isDraft && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-xs text-muted mb-1">{t.admin.orders.qtyPacks}</span>
                        <input type="number" min="0" step="any" value={l.qtyStr} onChange={(e) => patch(l.item_id, { qtyStr: e.target.value })} className={inputCls} />
                      </label>
                      <label className="block">
                        <span className="block text-xs text-muted mb-1">{t.admin.orders.pricePerPack}</span>
                        <input type="number" min="0" step="any" value={l.priceStr} onChange={(e) => patch(l.item_id, { priceStr: e.target.value })} placeholder="—" className={inputCls} />
                      </label>
                    </div>
                  )}
                  {isSent && left > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-xs text-muted mb-1">{t.admin.orders.receiveNow}</span>
                        <input type="number" min="0" step="any" value={l.recvStr} onChange={(e) => patch(l.item_id, { recvStr: e.target.value })} className={inputCls} />
                      </label>
                      <label className="block">
                        <span className="block text-xs text-muted mb-1">{t.admin.orders.pricePerPack}</span>
                        <input type="number" min="0" step="any" value={l.priceStr} onChange={(e) => patch(l.item_id, { priceStr: e.target.value })} placeholder="—" className={inputCls} />
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {isDraft && lines.length > 0 && (
          <p className="text-xs text-muted mt-3">{t.admin.orders.draftHint}</p>
        )}
        {isSent && recvInvalid && (
          <p className="text-xs text-bad mt-3">{t.admin.orders.overReceive}</p>
        )}

        <div className="flex gap-2 mt-4 flex-wrap">
          {isDraft && (
            <>
              <button onClick={saveDraft} disabled={busy || !dirty || invalidDraft}
                className="flex-1 bg-app text-ink rounded-xl py-3 text-sm font-medium disabled:opacity-40">
                {t.admin.orders.save}
              </button>
              <button onClick={() => setConfirm('send')} disabled={busy || dirty || lines.length === 0}
                className="flex-1 bg-accent text-white rounded-xl py-3 text-sm font-medium disabled:opacity-40">
                {t.admin.orders.send}
              </button>
            </>
          )}
          {isSent && (
            <button onClick={receive} disabled={busy || recvInvalid || recvTotal === 0}
              className="flex-1 bg-accent text-white rounded-xl py-3 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
              {busy && <Loader className="w-4 h-4 animate-spin" />}
              {t.admin.orders.receiveAction}
            </button>
          )}
          {(isDraft || isSent) && (
            <button onClick={() => setConfirm('cancel')} disabled={busy}
              className="bg-bad-soft text-bad rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-40">
              {t.admin.orders.cancelOrder}
            </button>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          open={true}
          tone={confirm === 'cancel' ? 'bad' : 'warn'}
          title={confirm === 'send' ? t.admin.orders.sendTitle : t.admin.orders.cancelTitle}
          message={confirm === 'send' ? t.admin.orders.sendBody : t.admin.orders.cancelBody}
          confirmLabel={confirm === 'send' ? t.admin.orders.send : t.admin.orders.cancelOrder}
          cancelLabel={t.cleaning.cancel}
          onConfirm={() => {
            const action = confirm
            setConfirm(null)
            if (action === 'send') run(() => setPurchaseOrderStatus(order.id, 'sent'), t.admin.orders.sentOk).then((ok) => { if (ok) onClose() })
            else run(() => setPurchaseOrderStatus(order.id, 'cancelled'), t.admin.orders.cancelledOk).then((ok) => { if (ok) onClose() })
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
