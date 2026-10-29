import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchWarehouseStock, fetchTemplateNorms, upsertNormRule, deleteNormRule } from '@/modules/admin/api'
import type { WarehouseStockRow, NormRuleRow, NormType, AptType, BaseUnit } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { ArrowLeft, Plus, Trash2, CreditCard as Edit3, X, Check } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'

const aptTypes: AptType[] = ['studio', '1br', '2br']

const normTypeOrder: NormType[] = ['asset_standing', 'turnover_replenish', 'cleaning_consumption']

function unitShort(unit: BaseUnit, units: Record<BaseUnit, string>): string {
  return units[unit]
}

export function NormTemplatesPage() {
  const { t, n } = useI18n()
  const aptTypeLabels: Record<AptType, string> = {
    studio: t.admin.normTemplates.studio,
    '1br': t.admin.normTemplates.br1,
    '2br': t.admin.normTemplates.br2,
  }
  const normTypeLabels: Record<NormType, string> = {
    asset_standing: t.apartments.normInventory,
    turnover_replenish: t.apartments.normTurnover,
    cleaning_consumption: t.apartments.normCleaning,
  }
  const navigate = useNavigate()
  const [selectedType, setSelectedType] = useState<AptType>('studio')
  const [norms, setNorms] = useState<NormRuleRow[]>([])
  const [stock, setStock] = useState<WarehouseStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingNorm, setEditingNorm] = useState<NormRuleRow | null>(null)
  const [addingNormType, setAddingNormType] = useState<NormType | null>(null)

  const loadNorms = useCallback((type: AptType, silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    fetchTemplateNorms(type)
      .then((data) => setNorms(data))
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
  }, [])

  const loadStock = useCallback(() => {
    fetchWarehouseStock().then(setStock).catch((e) => console.error(friendlyMessage(e)))
  }, [])

  useEffect(() => { loadStock() }, [loadStock])

  useEffect(() => {
    loadNorms(selectedType)
  }, [selectedType, loadNorms])

  useLiveRefresh(['norm_rules', 'items'], () => {
    loadNorms(selectedType, true)
    loadStock()
  })

  const grouped = useMemo(() => {
    const map = new Map<NormType, NormRuleRow[]>()
    for (const nr of norms) {
      const list = map.get(nr.norm_type) ?? []
      list.push(nr)
      map.set(nr.norm_type, list)
    }
    return map
  }, [norms])

  const reload = () => loadNorms(selectedType)

  const handleSave = async (normType: string, itemId: number, qty: number, note: string | null, id?: number) => {
    try {
      await upsertNormRule({
        id: id || undefined,
        norm_type: normType as NormType,
        apartment_id: null,
        apt_type: selectedType,
        item_id: itemId,
        qty,
        note: note ?? null,
      })
      setEditingNorm(null)
      setAddingNormType(null)
      reload()
    } catch (e) {
      const msg = errorMessage(e)
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        toast(t.admin.normTemplates.duplicate, 'error')
      } else {
        toast(msg, 'error')
      }
    }
  }

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }
  if (loadError) return <ErrorState onRetry={() => loadNorms(selectedType)} />

  return (
    <div className="min-h-screen bg-app">
      <div className="bg-surface border-b border-line sticky top-11 lg:top-0 z-30">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/admin/more')} className="p-1 -ml-1">
            <ArrowLeft className="w-5 h-5 text-ink" />
          </button>
          <h1 className="text-lg font-semibold text-ink">{t.admin.normTemplates.title}</h1>
        </div>
        <div className="flex px-4 gap-1">
          {aptTypes.map((tp) => (
            <button
              key={tp}
              onClick={() => setSelectedType(tp)}
              className={`px-3 py-2.5 text-sm border-b-2 transition-colors ${selectedType === tp ? 'border-accent text-accent font-medium' : 'border-transparent text-muted'}`}
            >
              {aptTypeLabels[tp]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 pb-28">
        <p className="text-xs text-muted bg-app rounded-xl px-3 py-2.5 mb-2">
          {t.admin.normTemplates.hint}
        </p>
        <p className="text-xs text-muted bg-app rounded-xl px-3 py-2.5 mb-4">
          {t.admin.normTemplates.customValuesNote}
        </p>

        {normTypeOrder.map((nt) => {
          const items = grouped.get(nt) ?? []
          return (
            <div key={nt} className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
                  {normTypeLabels[nt]}
                </h3>
                <button
                  onClick={() => setAddingNormType(nt)}
                  className="text-accent text-xs flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> {t.admin.normTemplates.addNorm}
                </button>
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-muted px-3">{t.admin.normTemplates.noNorms}</p>
              ) : (
                <div className="bg-surface rounded-xl border border-line divide-y divide-[var(--line)]">
                  {items.map((nr) => {
                    const item = stock.find((s) => s.item_id === nr.item_id)
                    return (
                      <div key={nr.id} className="px-4 py-2.5 flex items-center justify-between">
                        <div className="min-w-0">
                          <span className="text-sm text-ink">{item?.name ?? `#${n(String(nr.item_id))}`}</span>
                          <span className="text-xs text-muted ml-1">{n(String(nr.qty))} {item ? unitShort(item.base_unit, t.common.units) : ''}</span>
                          {nr.note && <span className="text-xs text-muted block">{nr.note}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => setEditingNorm(nr)} className="text-muted hover:text-accent">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={async () => { await deleteNormRule(nr.id); reload() }} className="text-muted hover:text-bad">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(editingNorm || addingNormType) && (
        <NormEditorModal
          norm={editingNorm}
          normType={addingNormType ?? editingNorm!.norm_type}
          items={stock}
          takenIds={new Set(
            norms
              .filter((r) => r.id !== editingNorm?.id && (r.norm_type === (addingNormType ?? editingNorm!.norm_type) ||
                (r.norm_type !== 'asset_standing' && (addingNormType ?? editingNorm!.norm_type) !== 'asset_standing')))
              .map((r) => r.item_id),
          )}
          onClose={() => { setEditingNorm(null); setAddingNormType(null) }}
          onSave={(normType, itemId, qty, note) => handleSave(normType, itemId, qty, note, editingNorm?.id)}
        />
      )}
    </div>
  )
}

function NormEditorModal({
  norm,
  normType,
  items,
  takenIds,
  onClose,
  onSave,
}: {
  norm: NormRuleRow | null
  normType: NormType
  items: WarehouseStockRow[]
  takenIds: Set<number>
  onClose: () => void
  onSave: (normType: string, itemId: number, qty: number, note: string | null) => void
}) {
  const { t } = useI18n()
  const [itemId, setItemId] = useState(norm?.item_id ?? 0)
  const [qty, setQty] = useState(String(norm?.qty ?? 1))
  const qtyValid = useMemo(() => {
    const num = Number(qty)
    if (!isFinite(num) || num < 0 || num > 999999.999) return false
    const dot = qty.indexOf('.')
    if (dot !== -1 && qty.length - dot - 1 > 3) return false
    return true
  }, [qty])
  const [note, setNote] = useState(norm?.note ?? '')
  const selectedItem = items.find((i) => i.item_id === itemId)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
      <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{norm ? t.admin.normTemplates.editNorm : t.admin.normTemplates.addNorm}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.normTemplates.item}</label>
            <select value={itemId} onChange={(e) => setItemId(Number(e.target.value))} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none">
              <option value="0">—</option>
              {items.filter((i) => !takenIds.has(i.item_id) || i.item_id === itemId).map((i) => <option key={i.item_id} value={i.item_id}>{i.name}</option>)}
            </select>
            {normType !== 'asset_standing' && (
              <p className="text-xs text-muted mt-1">{t.admin.apartments.normExclusiveHint}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.normTemplates.qty}</label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className={`flex-1 bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none ${!qtyValid ? 'border border-bad' : ''}`} />
              {selectedItem && <span className="text-sm text-muted shrink-0">{unitShort(selectedItem.base_unit, t.common.units)}</span>}
            </div>
            {!qtyValid && (
              <p className="text-xs text-bad mt-1">{t.admin.apartments.qtyInvalid}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.move.note}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
          <button
            onClick={() => onSave(normType, itemId, Number(qty), note.trim() || null)}
            disabled={!itemId || !qty || !qtyValid}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            {t.admin.normTemplates.save}
          </button>
        </div>
      </div>
    </div>
  )
}
