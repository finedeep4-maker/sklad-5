import { useState, useMemo } from 'react'
import { useI18n } from '@/i18n'
import { X, Check, Loader as Loader2 } from 'lucide-react'
import type { NormType, BaseUnit } from '@/lib/database.types'
import type { NormCatalogItem } from './norms'
import { unitLabel } from '@/lib/format'

interface Props {
  normType: NormType
  itemId: number | null
  qty: number
  note: string | null
  isEdit: boolean
  catalog: NormCatalogItem[]
  excludeItemIds: Set<number>
  saving: boolean
  onSave: (itemId: number, qty: number, note: string | null) => void
  onClose: () => void
}

export function NormEditor({
  normType,
  itemId,
  qty,
  note,
  isEdit,
  catalog,
  excludeItemIds,
  saving,
  onSave,
  onClose,
}: Props) {
  const { t } = useI18n()
  const normTypeLabels: Record<NormType, string> = {
    asset_standing: t.apartments.normInventory,
    turnover_replenish: t.apartments.normTurnover,
    cleaning_consumption: t.apartments.normCleaning,
  }
  const [selectedItemId, setSelectedItemId] = useState(itemId ?? null)
  const [qtyStr, setQtyStr] = useState(String(qty))
  const [noteStr, setNoteStr] = useState(note ?? '')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  const defaultKind = normType === 'asset_standing' ? 'asset' : 'consumable'

  const qtyValid = useMemo(() => {
    const num = Number(qtyStr)
    if (!isFinite(num) || num < 0 || num > 999999.999) return false
    const dot = qtyStr.indexOf('.')
    if (dot !== -1 && qtyStr.length - dot - 1 > 3) return false
    return true
  }, [qtyStr])

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim()
    return catalog.filter((item) => {
      if (!item.active && item.id !== selectedItemId) return false
      if (excludeItemIds.has(item.id) && item.id !== selectedItemId) return false
      if (!showAll && item.kind !== defaultKind) return false
      if (q && !item.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [catalog, search, showAll, defaultKind, excludeItemIds, selectedItemId])

  const selectedItem = catalog.find((i) => i.id === selectedItemId)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">
            {isEdit ? t.admin.apartments.editNorm : t.admin.apartments.addNorm}
          </h3>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-muted mb-1">{t.admin.normTemplates.item}</label>
            {isEdit ? (
              <div className="w-full bg-app rounded-lg px-4 py-2.5 text-sm text-ink">
                {selectedItem?.name ?? `#${selectedItemId}`}
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.admin.apartments.searchItems}
                  className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none mb-2"
                />
                <select
                  value={selectedItemId ?? 0}
                  onChange={(e) => setSelectedItemId(Number(e.target.value) || null)}
                  className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none mb-2"
                  size={4}
                >
                  {filteredItems.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.category})</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                  {t.admin.apartments.showAllItems}
                </label>
                {normType !== 'asset_standing' && (
                  <p className="text-xs text-muted mt-2">{t.admin.apartments.normExclusiveHint}</p>
                )}
              </>
            )}
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">{t.admin.apartments.qty}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.001"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                className={`flex-1 bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none ${!qtyValid ? 'border border-bad' : ''}`}
              />
              {selectedItem && (
                <span className="text-sm text-muted shrink-0">
                  {unitLabel(selectedItem.base_unit as BaseUnit)}
                </span>
              )}
            </div>
            {!qtyValid && (
              <p className="text-xs text-bad mt-1">{t.admin.apartments.qtyInvalid}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">{t.admin.move.note}</label>
            <input
              value={noteStr}
              onChange={(e) => setNoteStr(e.target.value)}
              className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none"
            />
          </div>
          <p className="text-xs text-muted">{t.admin.apartments.normTypeLabel}: {normTypeLabels[normType]}</p>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm min-h-[44px]">
            {t.cleaning.cancel}
          </button>
          <button
            onClick={() => onSave(selectedItemId ?? 0, Number(qtyStr), noteStr.trim() || null)}
            disabled={!selectedItemId || !qtyStr || !qtyValid || saving}
            className="flex-1 bg-accent text-white rounded-lg py-3 font-medium text-sm disabled:opacity-40 flex items-center justify-center gap-2 min-h-[44px]"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t.admin.apartments.save}
          </button>
        </div>
      </div>
    </>
  )
}
