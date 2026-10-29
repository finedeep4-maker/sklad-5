import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fetchWarehouseStock, fetchApartmentsAdmin, fetchAllStaff, fetchSuppliers, fetchItems, fetchOwnerStock, postDocument, postTransfer } from '@/modules/admin/api'
import type { WarehouseStockRow, Apartment, Staff, Supplier, PostDocumentResult, OwnerStockRow, ItemKind } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatQty } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { lineSource, isTransferBlocked, transferOwnerFlags, buildOwnerStockMap, ownerAvailable, type MoveOp } from '@/modules/admin/moveRules'
import { Plus, Minus, Trash2, Loader as Loader2, Check, X, FileText, TriangleAlert as AlertTriangle, Info } from 'lucide-react'

function localToday(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

interface MoveOpDef {
  op: string
  label: string
  needsApartment: boolean
  needsStaff: boolean
  needsCost: boolean
  needsToApartment?: boolean
}

interface CartLine {
  itemId: number
  itemName: string
  packSize: number
  packLabel: string
  baseUnit: string
  kind: ItemKind
  stockQty: number | null
  qty: string
  unitMode: 'packs' | 'base'
  unitCost: string
}

type OwnershipMode = 'company' | 'owner'

export function MoveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, n } = useI18n()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const ops: MoveOpDef[] = [
    { op: 'receipt', label: t.admin.move.receipt, needsApartment: false, needsStaff: false, needsCost: true },
    { op: 'issue_apartment', label: t.admin.move.issueApt, needsApartment: true, needsStaff: false, needsCost: false },
    { op: 'return_apartment', label: t.admin.move.returnApt, needsApartment: true, needsStaff: false, needsCost: false },
    { op: 'writeoff_apartment', label: t.admin.move.writeoffApt, needsApartment: true, needsStaff: false, needsCost: false },
    { op: 'writeoff_warehouse', label: t.admin.move.writeoffWh, needsApartment: false, needsStaff: false, needsCost: false },
    { op: 'issue_holder', label: t.admin.move.issueHolder, needsApartment: false, needsStaff: true, needsCost: false },
    { op: 'return_holder', label: t.admin.move.returnHolder, needsApartment: false, needsStaff: true, needsCost: false },
    { op: 'writeoff_holder', label: t.admin.move.writeoffHolder, needsApartment: false, needsStaff: true, needsCost: false },
    { op: 'transfer_apartment', label: t.admin.move.transferApt, needsApartment: true, needsStaff: false, needsCost: false, needsToApartment: true },
    { op: 'transfer_holder', label: t.admin.move.transferHolder, needsApartment: true, needsStaff: true, needsCost: false },
  ]
  const [stock, setStock] = useState<WarehouseStockRow[]>([])
  const [ownerStock, setOwnerStock] = useState<OwnerStockRow[]>([])
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [op, setOp] = useState<string>(() => searchParams.get('op') ?? 'receipt')
  const [apartmentId, setApartmentId] = useState<number | null>(null)
  const [staffId, setStaffId] = useState<number | null>(null)
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [itemMeta, setItemMeta] = useState<Map<number, { cost: number | null; supplier: number | null }>>(new Map())
  const [note, setNote] = useState('')
  const [docDate, setDocDate] = useState(localToday())
  const [toApartmentId, setToApartmentId] = useState<number | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<PostDocumentResult | null>(null)
  const [ownership, setOwnership] = useState<OwnershipMode>('company')
  const [ownerAptId, setOwnerAptId] = useState<number | null>(null)
  const [placeInApartment, setPlaceInApartment] = useState(false)

  useEffect(() => {
    Promise.all([fetchWarehouseStock(), fetchApartmentsAdmin(), fetchAllStaff(), fetchSuppliers(), fetchItems(), fetchOwnerStock()])
      .then(([s, a, st, sup, its, os]) => {
        setStock(s)
        setItemMeta(new Map(its.map((i) => [i.id, { cost: i.default_cost, supplier: i.supplier_id }])))
        setApartments(a)
        setStaffList(st.filter((x) => x.active))
        setSuppliers(sup)
        setOwnerStock(os)
      })
      .catch((e) => toast(errorMessage(e), 'error'))
      .finally(() => setLoading(false))
  }, [])

  const opDef = ops.find((o) => o.op === op)!
  const stockMap = useMemo(() => new Map(stock.map((s) => [s.item_id, s.qty])), [stock])
  const ownerStockMap = useMemo(() => buildOwnerStockMap(ownerStock), [ownerStock])

  const ownerApartments = useMemo(() => apartments.filter((a) => a.is_owner), [apartments])
  const selectedApt = useMemo(() => apartments.find((a) => a.id === apartmentId) ?? null, [apartments, apartmentId])
  const selectedAptIsOwner = selectedApt?.is_owner ?? false
  const toApt = useMemo(() => apartments.find((a) => a.id === toApartmentId) ?? null, [apartments, toApartmentId])

  const isOutbound = op === 'issue_apartment' || op === 'writeoff_warehouse' || op === 'issue_holder'
  const isTransfer = op === 'transfer_apartment' || op === 'transfer_holder'
  const showOwnershipToggle = op === 'receipt' || op === 'writeoff_warehouse'
  const showOwnerAptInfo = (op === 'issue_apartment' || op === 'return_apartment') && selectedAptIsOwner

  const filteredStock = useMemo(() => {
    let list = stock.filter((s) => s.name.toLowerCase().includes(search.toLowerCase().trim()))
    if (showOwnershipToggle && ownership === 'owner') {
      list = list.filter((s) => s.kind === 'asset')
    }
    if (op === 'writeoff_warehouse' && ownership === 'owner') {
      list = list.filter((s) => ownerAvailable(ownerStockMap, ownerAptId ?? -1, s.item_id) > 0)
    }
    return list.slice(0, 20)
  }, [stock, search, showOwnershipToggle, ownership, op, ownerStockMap, ownerAptId])

  const addToCart = (item: WarehouseStockRow) => {
    const meta = itemMeta.get(item.item_id)
    if (opDef.needsCost && supplierId == null && meta?.supplier != null) setSupplierId(meta.supplier)
    setCart((prev) => {
      if (prev.some((l) => l.itemId === item.item_id)) return prev
      return [...prev, {
        itemId: item.item_id,
        itemName: item.name,
        packSize: item.pack_size,
        packLabel: item.pack_label,
        baseUnit: item.base_unit,
        kind: item.kind,
        stockQty: item.qty,
        qty: '1',
        unitMode: item.pack_size > 1 ? 'packs' : 'base',
        unitCost: opDef.needsCost && meta?.cost != null ? String(Math.round(meta.cost * 1e6) / 1e6) : '',
      }]
    })
  }

  const updateLine = (idx: number, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const removeLine = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx))
  }

  const getBaseQty = (line: CartLine): number => {
    const qtyNum = Number(line.qty)
    if (line.unitMode === 'packs') return qtyNum * line.packSize
    return qtyNum
  }

  const effectiveStockQty = useCallback((line: CartLine): number | null => {
    if (isTransfer) return null
    if (op === 'writeoff_warehouse' && ownership === 'owner') {
      return ownerAvailable(ownerStockMap, ownerAptId ?? -1, line.itemId)
    }
    if ((op === 'issue_apartment' || op === 'return_apartment') && selectedAptIsOwner) {
      const src = lineSource(op as MoveOp, true, line.kind)
      if (src === 'owner') return ownerAvailable(ownerStockMap, apartmentId ?? -1, line.itemId)
      return line.stockQty ?? stockMap.get(line.itemId) ?? null
    }
    return line.stockQty ?? stockMap.get(line.itemId) ?? null
  }, [isTransfer, op, ownership, ownerStockMap, ownerAptId, selectedAptIsOwner, apartmentId, stockMap])

  const transferBlocked = useCallback((line: CartLine): boolean => {
    if (!isTransfer) return false
    const { fromOwner, toOwner } = transferOwnerFlags(
      op as 'transfer_apartment' | 'transfer_holder',
      selectedAptIsOwner,
      toApt?.is_owner ?? false,
    )
    return isTransferBlocked(line.kind, fromOwner, toOwner)
  }, [isTransfer, op, selectedAptIsOwner, toApt])

  const hasBlockedTransfer = cart.some(transferBlocked)

  // в режиме «Собственник» расходники недопустимы: показываем это на строке и не даём провести документ
  const ownerModeActive = showOwnershipToggle && ownership === 'owner'
  const ownerConsumableLine = useCallback((line: CartLine): boolean => ownerModeActive && line.kind === 'consumable', [ownerModeActive])
  const hasOwnerConsumable = cart.some(ownerConsumableLine)

  const handleOpChange = (nextOp: string) => {
    if (cart.length > 0) {
      const nextDef = ops.find((o) => o.op === nextOp)!
      const invalid: string[] = []
      for (const line of cart) {
        if (nextDef.op === 'receipt' || nextDef.op === 'writeoff_warehouse') {
          if (ownership === 'owner' && line.kind === 'consumable') invalid.push(line.itemName)
        }
      }
      if (invalid.length > 0) {
        toast(t.admin.move.linesBecameInvalid + ': ' + invalid.join(', '), 'error')
      }
    }
    setOp(nextOp)
  }

  const handleOwnershipChange = (next: OwnershipMode) => {
    if (next === 'owner' && cart.length > 0) {
      const consumables = cart.filter((l) => l.kind === 'consumable')
      if (consumables.length > 0) {
        toast(t.admin.move.ownerConsumablesHidden + ' (' + consumables.map((l) => l.itemName).join(', ') + ')', 'error')
      }
    }
    setOwnership(next)
  }

  const handleApartmentChange = (id: number | null) => {
    setApartmentId(id)
  }

  const handlePost = async () => {
    if (posting) return
    if (cart.length === 0) {
      toast(t.admin.move.empty, 'error')
      return
    }
    if (opDef.needsApartment && !apartmentId) {
      toast(t.admin.move.apartment, 'error')
      return
    }
    if (opDef.needsStaff && !staffId) {
      toast(t.admin.move.staff, 'error')
      return
    }
    if (showOwnershipToggle && ownership === 'owner' && !ownerAptId) {
      toast(t.admin.move.ownerApartmentRequired, 'error')
      return
    }
    if (opDef.needsToApartment) {
      if (!toApartmentId) {
        toast(t.admin.move.toApartment, 'error')
        return
      }
      if (toApartmentId === apartmentId) {
        toast(t.admin.move.sameApartment, 'error')
        return
      }
    }
    if (hasBlockedTransfer) {
      toast(t.admin.move.transferBlocked, 'error')
      return
    }
    if (hasOwnerConsumable) {
      toast(t.admin.move.ownerConsumablesHidden, 'error')
      return
    }
    const lines = cart
      .map((line) => {
        const baseQty = getBaseQty(line)
        if (!baseQty || baseQty <= 0) return null
        const costNum = opDef.needsCost && line.unitCost ? Number(line.unitCost) : null
        if (costNum !== null && !(costNum >= 0)) return null
        return { item_id: line.itemId, qty: baseQty, unit_cost: costNum }
      })
      .filter((l): l is { item_id: number; qty: number; unit_cost: number | null } => l !== null)
    if (lines.length < cart.length) {
      toast(t.admin.move.invalidLines, 'error')
      return
    }
    setPosting(true)
    try {
      const docDateArg = docDate && docDate !== localToday() ? docDate : null
      const isOwnerMode = showOwnershipToggle && ownership === 'owner'
      const ownerAptArg = isOwnerMode ? ownerAptId : null
      const placeInApt = isOwnerMode && op === 'receipt' && placeInApartment
      const res = isTransfer
        ? await postTransfer({
            fromKind: op === 'transfer_holder' ? 'holder' : 'apartment',
            fromId: (op === 'transfer_holder' ? staffId : apartmentId) as number,
            toApartment: (op === 'transfer_holder' ? apartmentId : toApartmentId) as number,
            lines: lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
            note: note.trim() || null,
            doc_date: docDateArg,
          })
        : await postDocument({
            op,
            lines,
            apartment: placeInApt ? ownerAptArg : (opDef.needsApartment ? apartmentId : null),
            staff: opDef.needsStaff ? staffId : null,
            supplier: opDef.needsCost ? supplierId : null,
            note: note.trim() || null,
            doc_date: docDateArg,
            ownerApartment: ownerAptArg,
          })
      setResult(res)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 bg-black/45 z-[60] anim-scrim" onClick={onClose} />
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-surface rounded-2xl p-6 max-w-sm w-full">
          <div className="text-center text-muted text-sm">{t.app.loading}</div>
        </div>
      </>
    )
  }

  if (result) {
    return (
      <>
        <div className="fixed inset-0 bg-black/45 z-[60] anim-scrim" onClick={onClose} />
        <div className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-surface rounded-2xl p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-ink">{t.admin.move.resultTitle}</h2>
            <button onClick={onClose} className="p-1" aria-label={t.common.close}>
              <X className="w-5 h-5 text-muted" />
            </button>
          </div>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-12 h-12 rounded-full bg-ok-soft flex items-center justify-center">
              <Check className="w-6 h-6 text-ok" />
            </div>
            <div className="text-center">
              <p className="text-sm text-muted">{t.admin.move.docNumber}</p>
              <p className="text-lg font-semibold text-ink">{result.doc_number}</p>
              <p className="text-xs text-muted mt-1">{n(String(result.lines))} {t.admin.move.resultLines}</p>
            </div>
            <button
              onClick={() => { onDone(); navigate(`/admin/more/documents/${result.doc_id}`) }}
              className="flex items-center gap-2 bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-medium"
            >
              <FileText className="w-4 h-4" />
              {t.admin.move.openDoc}
            </button>
            <button onClick={onDone} className="text-sm text-muted">
              {t.cleaning.cancel}
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[60] anim-scrim" onClick={onClose} />
      <div
        className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm max-h-[90dvh] overflow-auto bg-surface rounded-2xl p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet max-md:max-h-[85dvh]"
        role="dialog"
        aria-modal="true"
        aria-label={t.admin.move.title}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink">{t.admin.move.title}</h2>
          <button onClick={onClose} className="p-1" aria-label={t.common.close}>
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Operation type */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.operation}</label>
            <div className="flex gap-2 flex-wrap">
              {ops.map((o) => (
                <button
                  key={o.op}
                  onClick={() => handleOpChange(o.op)}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition-colors border ${
                    op === o.op ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Ownership toggle (receipt / writeoff_warehouse) */}
          {showOwnershipToggle && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.ownership}</label>
              <div className="inline-flex bg-app border border-line rounded-lg p-0.5">
                <button
                  onClick={() => handleOwnershipChange('company')}
                  className={`px-4 py-2 rounded-md text-sm transition-colors ${ownership === 'company' ? 'bg-accent text-white' : 'text-muted'}`}
                >
                  {t.admin.move.ownershipCompany}
                </button>
                <button
                  onClick={() => handleOwnershipChange('owner')}
                  className={`px-4 py-2 rounded-md text-sm transition-colors ${ownership === 'owner' ? 'bg-accent text-white' : 'text-muted'}`}
                >
                  {t.admin.move.ownershipOwner}
                </button>
              </div>
            </div>
          )}

          {/* Owner apartment selector */}
          {showOwnershipToggle && ownership === 'owner' && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.ownerApartment}</label>
              <select
                value={ownerAptId ?? ''}
                onChange={(e) => setOwnerAptId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              >
                <option value="">—</option>
                {ownerApartments.map((a) => (
                  <option key={a.id} value={a.id}>{a.code}</option>
                ))}
              </select>
              {op === 'receipt' && (
                <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={placeInApartment}
                    onChange={(e) => setPlaceInApartment(e.target.checked)}
                    className="w-4 h-4 rounded accent-accent"
                  />
                  <span className="text-sm text-ink">{t.admin.move.ownerPlaceInApartment}</span>
                </label>
              )}
              {op === 'receipt' && (
                <p className="text-xs text-muted mt-1.5">{t.admin.move.ownerConsumablesHidden}</p>
              )}
            </div>
          )}

          {/* Owner apartment info banner (issue_apartment / return_apartment) */}
          {showOwnerAptInfo && (
            <div className="flex items-start gap-2 bg-warn-soft text-warn rounded-lg px-3 py-2.5 text-xs">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t.admin.move.ownerAptInfo}</span>
            </div>
          )}

          {/* Apartment */}
          {opDef.needsApartment && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">
                {op === 'transfer_apartment' ? t.admin.move.fromApartment : op === 'transfer_holder' ? t.admin.move.toApartment : t.admin.move.apartment}
              </label>
              <select
                value={apartmentId ?? ''}
                onChange={(e) => handleApartmentChange(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              >
                <option value="">—</option>
                {apartments.map((a) => (
                  <option key={a.id} value={a.id}>{a.code}{a.is_owner ? ' (OWNER)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {opDef.needsToApartment && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.toApartment}</label>
              <select
                value={toApartmentId ?? ''}
                onChange={(e) => setToApartmentId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              >
                <option value="">—</option>
                {apartments.filter((a) => a.id !== apartmentId).map((a) => (
                  <option key={a.id} value={a.id}>{a.code}{a.is_owner ? ' (OWNER)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Staff */}
          {opDef.needsStaff && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">{op === 'transfer_holder' ? t.admin.move.fromStaff : t.admin.move.staff}</label>
              <select
                value={staffId ?? ''}
                onChange={(e) => setStaffId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              >
                <option value="">—</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Supplier (receipt only) */}
          {opDef.needsCost && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.supplier}</label>
              <select
                value={supplierId ?? ''}
                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Item search */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.items}</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.admin.stock.search}
              className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none mb-2"
            />
            {(search.trim() || cart.length === 0) && (
              <div className="bg-surface rounded-lg border border-line max-h-48 overflow-y-auto">
                {filteredStock.length === 0 && (
                  <p className="px-4 py-2.5 text-sm text-muted">{t.common.noResults}</p>
                )}
                {filteredStock.map((s) => {
                  const availLabel = op === 'writeoff_warehouse' && ownership === 'owner' && ownerAptId
                    ? ownerAvailable(ownerStockMap, ownerAptId, s.item_id)
                    : s.qty
                  return (
                    <button
                      key={s.item_id}
                      onClick={() => { addToCart(s); setSearch('') }}
                      className="w-full px-4 py-2.5 flex items-center justify-between text-start hover:bg-app border-b border-line last:border-0"
                    >
                      <span className="text-sm text-ink truncate">{s.name}</span>
                      <span className="text-xs text-muted shrink-0 ms-2">{n(formatQty(availLabel, s))}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Cart */}
          {cart.length > 0 && (
            <div className="space-y-2">
              {cart.map((line, idx) => {
                const baseQty = getBaseQty(line)
                const stockQty = effectiveStockQty(line)
                const overStock = isOutbound && stockQty !== null && baseQty > stockQty
                const blocked = transferBlocked(line)
                const src = (op === 'issue_apartment' || op === 'return_apartment') && selectedAptIsOwner
                  ? lineSource(op as MoveOp, true, line.kind)
                  : null
                const unitLabel = line.unitMode === 'packs' ? line.packLabel : t.common.units[line.baseUnit as keyof typeof t.common.units] ?? line.baseUnit
                return (
                  <div key={line.itemId} className="bg-surface rounded-lg border border-line px-3 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-ink">{line.itemName}</span>
                      <button onClick={() => removeLine(idx)} className="text-bad p-1" aria-label={t.admin.apartments.delete}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {stockQty !== null && !isTransfer && (
                      <p className="text-xs text-muted mb-2">
                        {t.admin.move.inStock}: {n(formatQty(stockQty, { base_unit: line.baseUnit as WarehouseStockRow['base_unit'], pack_size: line.packSize, pack_label: line.packLabel }))}
                      </p>
                    )}
                    {src && (
                      <p className="text-xs text-muted mb-2">
                        {src === 'owner'
                          ? (op === 'issue_apartment' ? t.admin.move.sourceOwner : t.admin.move.sourceOwnerTo)
                          : t.admin.move.sourceCompany}
                      </p>
                    )}
                    {overStock && (
                      <div className="flex items-center gap-1.5 text-xs text-bad mb-2 bg-bad-soft rounded-lg px-2.5 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {ownership === 'owner' && (op === 'writeoff_warehouse' || src === 'owner')
                          ? t.admin.move.ownerNoStock
                          : t.admin.move.overStock}
                      </div>
                    )}
                    {blocked && (
                      <div className="text-xs text-bad mb-2 bg-bad-soft rounded-lg px-2.5 py-1.5">
                        {t.admin.move.transferBlocked}
                      </div>
                    )}
                    {ownerConsumableLine(line) && (
                      <div className="text-xs text-bad mb-2 bg-bad-soft rounded-lg px-2.5 py-1.5">
                        {t.admin.move.ownerConsumablesHidden}
                      </div>
                    )}
                    {line.packSize > 1 && (
                      <div className="flex gap-1 mb-2">
                        <button
                          onClick={() => updateLine(idx, { unitMode: 'packs' })}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${line.unitMode === 'packs' ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'}`}
                        >
                          {line.packLabel}
                        </button>
                        <button
                          onClick={() => updateLine(idx, { unitMode: 'base' })}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${line.unitMode === 'base' ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'}`}
                        >
                          {t.common.units[line.baseUnit as keyof typeof t.common.units] ?? line.baseUnit}
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2 items-center">
                      <div className="flex items-center bg-app rounded-lg">
                        <button
                          onClick={() => updateLine(idx, { qty: String(Math.max(1, Number(line.qty) - 1)) })}
                          className="px-2 py-1.5"
                          aria-label="−"
                        >
                          <Minus className="w-3.5 h-3.5 text-muted" />
                        </button>
                        <input
                          type="number"
                          value={line.qty}
                          onChange={(e) => updateLine(idx, { qty: e.target.value })}
                          step="any"
                          className="w-14 bg-transparent text-center text-sm py-1.5 focus:outline-none"
                        />
                        <button
                          onClick={() => updateLine(idx, { qty: String(Number(line.qty) + 1) })}
                          className="px-2 py-1.5"
                          aria-label="+"
                        >
                          <Plus className="w-3.5 h-3.5 text-muted" />
                        </button>
                      </div>
                      <span className="text-xs text-muted">{unitLabel}</span>
                      {line.packSize > 1 && line.unitMode === 'packs' && (
                        <span className="text-xs text-muted ms-auto">= {n(String(baseQty))} {t.common.units[line.baseUnit as keyof typeof t.common.units] ?? line.baseUnit}</span>
                      )}
                      {opDef.needsCost && (
                        <input
                          type="number"
                          value={line.unitCost}
                          onChange={(e) => updateLine(idx, { unitCost: e.target.value })}
                          placeholder={t.admin.move.unitCost}
                          className="w-24 bg-app rounded-lg px-3 py-2 text-sm focus:outline-none"
                        />
                      )}
                    </div>
                    {opDef.needsCost && line.packSize > 1 && !line.unitCost && (
                      <p className="text-xs text-muted mt-1">
                        {t.admin.move.costHint} {t.common.units[line.baseUnit as keyof typeof t.common.units] ?? line.baseUnit}
                      </p>
                    )}
                    {opDef.needsCost && line.packSize > 1 && line.unitCost && (
                      <p className="text-xs text-muted mt-1">
                        {t.admin.move.costPerPack}: {(Number(line.unitCost) * line.packSize).toFixed(2)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.docDate}</label>
            <input
              type="date"
              value={docDate}
              max={localToday()}
              onChange={(e) => setDocDate(e.target.value)}
              className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
            />
            {docDate && docDate !== localToday() && (
              <p className="text-xs text-muted mt-1">{t.admin.move.docDateHint}</p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">{t.admin.move.note}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-surface rounded-lg px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Actions */}
        {cart.length === 0 && (
          <p className="text-xs text-muted mt-4 text-center">{t.admin.move.empty}</p>
        )}
        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm"
          >
            {t.cleaning.cancel}
          </button>
          <button
            onClick={handlePost}
            disabled={posting || cart.length === 0 || hasBlockedTransfer || hasOwnerConsumable}
            className="flex-1 bg-accent text-white rounded-lg py-3 font-medium text-sm disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t.admin.move.post}
          </button>
        </div>
      </div>
    </>
  )
}
