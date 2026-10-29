import { useState, useEffect, useMemo } from 'react'
import {
  fetchCategories,
  fetchItems,
  fetchSuppliers,
  createCategory,
  updateCategory,
  deleteCategory,
  createItem,
  updateItem,
  deleteItem,
  postDocument,
  itemHasHistory,
  fetchItemStockSummary,
} from '@/modules/admin/api'
import type { Category, Item, ItemKind, BaseUnit, Supplier } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'
import { Plus, Trash2, CreditCard as Edit3, X, Check, ChevronRight, ChevronDown, Package, Folder } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage, friendlyMessage as errorMessage } from '@/lib/errors'
import { useLiveRefresh } from '@/lib/realtime'
import { unitLabel } from '@/lib/format'

const baseUnitOptions: BaseUnit[] = ['pcs', 'g', 'ml']

function parseCoef(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (!Number.isFinite(num) || num <= 0 || num > 99999.999) return null
  const decimals = trimmed.split('.')[1]
  if (decimals && decimals.length > 3) return null
  return num
}

function formatCoef(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

export function CatalogPage() {
  const { t, n } = useI18n()
  const kindLabels: Record<ItemKind, string> = {
    asset: t.admin.catalog.kindAsset,
    consumable: t.admin.catalog.kindConsumable,
  }
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expandedCat, setExpandedCat] = useState<number | null>(null)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [addingCat, setAddingCat] = useState(false)
  const [editingItem, setEditingItem] = useState<{ item: Item | null; categoryId: number } | null>(null)
  const [addingItem, setAddingItem] = useState<number | null>(null)
  const [deleteCatTarget, setDeleteCatTarget] = useState<number | null>(null)
  const [deleteItemTarget, setDeleteItemTarget] = useState<number | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: number
    unit: string
    params: Parameters<typeof updateItem>[1]
    stock: { warehouse: number; apartments: number; holders: number }
  } | null>(null)

  const load = (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    Promise.all([fetchCategories(), fetchItems()])
      .then(([c, i]) => {
        setCategories(c)
        setItems(i)
      })
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => { load() }, [])
  useLiveRefresh(['categories', 'items'], () => load(true))

  const itemsByCategory = useMemo(() => {
    const map = new Map<number, Item[]>()
    for (const it of items) {
      const list = map.get(it.category_id) ?? []
      list.push(it)
      map.set(it.category_id, list)
    }
    return map
  }, [items])

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }
  if (loadError) return <ErrorState onRetry={load} />

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.catalog.title}</h1>
        <button
          onClick={() => setAddingCat(true)}
          className="bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          {t.admin.catalog.addCategory}
        </button>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.catalog.noCategories}</p>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => {
            const catItems = itemsByCategory.get(cat.id) ?? []
            const expanded = expandedCat === cat.id
            return (
              <div key={cat.id} className="bg-surface border border-line rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpandedCat(expanded ? null : cat.id)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    {expanded ? (
                      <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                    )}
                    <Folder className="w-4 h-4 text-muted shrink-0" />
                    <span className="text-sm font-medium text-ink truncate">{cat.name}</span>
                    <span className="text-xs text-muted shrink-0">{kindLabels[cat.kind]}</span>
                    <span className="text-xs text-muted shrink-0">· {n(String(catItems.length))}</span>
                  </button>
                  <button
                    onClick={() => setAddingItem(cat.id)}
                    className="text-accent text-xs flex items-center gap-0.5 shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button onClick={() => setEditingCat(cat)} className="text-muted hover:text-accent shrink-0">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteCatTarget(cat.id)}
                    className="text-muted hover:text-bad shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-line">
                    {catItems.length === 0 ? (
                      <p className="text-sm text-muted px-4 py-3">{t.admin.catalog.noItems}</p>
                    ) : (
                      catItems.map((it) => (
                        <div key={it.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-0">
                          <Package className="w-4 h-4 text-muted shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm ${it.active ? 'text-ink' : 'text-muted line-through'}`}>{it.name}</span>
                            <span className="text-xs text-muted ml-2">
                              {it.pack_size > 1 ? `${n(String(it.pack_size))} ${it.pack_label}` : t.common.units[it.base_unit]}
                              {it.min_stock != null && ` · ${t.common.minimum} ${n(String(it.min_stock))}`}
                            </span>
                            {it.tenant_coef != null
                              ? <span className="text-xs text-ink ml-1">· ×{formatCoef(it.tenant_coef)}</span>
                              : cat.tenant_coef != null
                                ? <span className="text-xs text-muted ml-1">· ×{formatCoef(cat.tenant_coef)}</span>
                                : <span className="text-xs text-muted ml-1">· {t.admin.catalog.tenantCoefNone}</span>}
                          </div>
                          <button onClick={() => setEditingItem({ item: it, categoryId: cat.id })} className="text-muted hover:text-accent shrink-0">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteItemTarget(it.id)}
                            className="text-muted hover:text-bad shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                    <button
                      onClick={() => setAddingItem(cat.id)}
                      className="w-full px-4 py-2.5 text-sm text-accent flex items-center gap-1.5 hover:bg-app transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t.admin.catalog.addItem}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {deleteCatTarget !== null && (
        <ConfirmDialog
          open={true}
          title={t.admin.catalog.confirmDeleteCategory}
          onConfirm={async () => {
            const id = deleteCatTarget
            setDeleteCatTarget(null)
            try {
              await deleteCategory(id)
              toast(t.admin.catalog.delete, 'success')
              load()
            } catch (e) { toast(errorMessage(e), 'error') }
          }}
          onCancel={() => setDeleteCatTarget(null)}
        />
      )}

      {deactivateTarget && (
        <ConfirmDialog
          open={true}
          tone="warn"
          title={t.admin.catalog.deactivateTitle}
          message={`${t.admin.catalog.stockWarehouse}: ${n(String(deactivateTarget.stock.warehouse))}, ${t.admin.catalog.stockApartments}: ${n(String(deactivateTarget.stock.apartments))}, ${t.admin.catalog.stockHolders}: ${n(String(deactivateTarget.stock.holders))} ${deactivateTarget.unit}. ${t.admin.catalog.deactivateBody}`}
          confirmLabel={t.admin.catalog.deactivateConfirm}
          cancelLabel={t.cleaning.cancel}
          onConfirm={() => setDeactivateTarget(null)}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}

      {deleteItemTarget !== null && (
        <ConfirmDialog
          open={true}
          title={t.admin.catalog.confirmDeleteItem}
          onConfirm={async () => {
            const id = deleteItemTarget
            setDeleteItemTarget(null)
            try {
              await deleteItem(id)
              toast(t.admin.catalog.delete, 'success')
              load()
            } catch (e) {
              if ((e as { code?: string }).code === '23503') {
                toast(t.admin.catalog.deleteItemHasHistory, 'error')
              } else {
                toast(errorMessage(e), 'error')
              }
            }
          }}
          onCancel={() => setDeleteItemTarget(null)}
        />
      )}

      {(editingCat || addingCat) && (
        <CategoryEditor
          category={editingCat}
          onClose={() => { setEditingCat(null); setAddingCat(false) }}
          onSave={async (name, kind, sort, tenantCoef) => {
            try {
              if (editingCat) {
                await updateCategory(editingCat.id, { name, kind, sort, tenant_coef: tenantCoef })
              } else {
                await createCategory(name, kind, sort, tenantCoef)
              }
              toast(t.admin.catalog.save, 'success')
              setEditingCat(null)
              setAddingCat(false)
              load()
            } catch (e) { toast(errorMessage(e), 'error') }
          }}
        />
      )}

      {(editingItem || addingItem != null) && (
        <ItemEditor
          item={editingItem?.item ?? null}
          categories={categories}
          defaultCategoryId={addingItem ?? editingItem?.categoryId ?? categories[0]?.id ?? 0}
          onClose={() => { setEditingItem(null); setAddingItem(null) }}
          onSave={async (formValues) => {
            const { opening_qty: openingQty, ...params } = formValues
            try {
              const nameKey = params.name.trim().toLowerCase()
              if (items.some((i) => i.id !== editingItem?.item?.id && i.name.trim().toLowerCase() === nameKey)) {
                toast(t.admin.catalog.duplicateName, 'error')
                return
              }
              if (editingItem?.item) {
                if (editingItem.item.active && params.active === false) {
                  const stock = await fetchItemStockSummary(editingItem.item.id)
                  if (stock.total > 0) {
                    setDeactivateTarget({ id: editingItem.item.id, unit: unitLabel(editingItem.item.base_unit), params, stock })
                    return
                  }
                }
                await updateItem(editingItem.item.id, params)
              } else {
                const newId = await createItem(params)
                if (openingQty != null && openingQty > 0) {
                  try {
                    await postDocument({
                      op: 'receipt',
                      lines: [{
                        item_id: newId,
                        qty: Math.round(openingQty * params.pack_size * 1000) / 1000,
                        unit_cost: params.default_cost ?? null,
                      }],
                      supplier: params.supplier_id ?? null,
                      note: t.admin.catalog.openingNote,
                    })
                  } catch (e) {
                    toast(`${t.admin.catalog.openingFailed} ${errorMessage(e)}`, 'error')
                  }
                }
              }
              toast(t.admin.catalog.save, 'success')
              setEditingItem(null)
              setAddingItem(null)
              load()
            } catch (e) { toast(errorMessage(e), 'error') }
          }}
        />
      )}
    </div>
  )
}

function CategoryEditor({
  category,
  onClose,
  onSave,
}: {
  category: Category | null
  onClose: () => void
  onSave: (name: string, kind: ItemKind, sort: number, tenantCoef: number | null) => void
}) {
  const { t, n } = useI18n()
  const kindLabels: Record<ItemKind, string> = {
    asset: t.admin.catalog.kindAsset,
    consumable: t.admin.catalog.kindConsumable,
  }
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState<ItemKind>(category?.kind ?? 'asset')
  const [sort, setSort] = useState(String(category?.sort ?? 0))
  const [tenantCoef, setTenantCoef] = useState(category?.tenant_coef != null ? String(category.tenant_coef) : '')

  return (
    <Modal title={category ? t.admin.catalog.editCategory : t.admin.catalog.addCategory} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t.admin.catalog.categoryName}>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        <Field label={t.admin.catalog.kind}>
          <div className="grid grid-cols-2 gap-2">
            {(['asset', 'consumable'] as ItemKind[]).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`rounded-lg py-2.5 text-sm border transition-colors ${kind === k ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line bg-surface text-muted'}`}>
                {kindLabels[k]}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t.admin.catalog.sort}>
          <input type="number" value={sort} onChange={(e) => setSort(e.target.value)}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        <Field label={t.admin.catalog.tenantCoef}>
          <input type="number" min="0" step="any" value={tenantCoef} onChange={(e) => setTenantCoef(e.target.value)}
            placeholder={t.admin.catalog.tenantCoefExample}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
          {tenantCoef.trim() && parseCoef(tenantCoef) == null
            ? <p className="text-xs text-bad mt-0.5">{t.admin.catalog.tenantCoefInvalid}</p>
            : <p className="text-xs text-muted mt-0.5">{t.admin.catalog.tenantCoefHint}</p>}
          {tenantCoef.trim() && parseCoef(tenantCoef) != null && (
            <p className="text-xs text-muted mt-0.5">
              {t.admin.catalog.tenantCoefExampleFmt.replace('{amount}', n(String(Math.round(100 * (parseCoef(tenantCoef) ?? 1) * 100) / 100)))}
            </p>
          )}
        </Field>
      </div>
      <Actions onClose={onClose} onSave={() => onSave(name.trim(), kind, Number(sort) || 0, parseCoef(tenantCoef))} disabled={!name.trim() || (tenantCoef.trim() != null && tenantCoef.trim() !== '' && parseCoef(tenantCoef) == null)} />
    </Modal>
  )
}

function ItemEditor({
  item,
  categories,
  defaultCategoryId,
  onClose,
  onSave,
}: {
  item: Item | null
  categories: Category[]
  defaultCategoryId: number
  onClose: () => void
  onSave: (params: {
    category_id: number
    name: string
    base_unit: BaseUnit
    pack_size: number
    pack_label: string
    min_stock: number | null
    target_stock: number | null
    note: string | null
    default_cost: number | null
    opening_qty: number | null
    sort: number
    track_on_hand: boolean
    active?: boolean
    supplier_id?: number | null
    tenant_coef?: number | null
  }) => void
}) {
  const { t, n } = useI18n()
  const [categoryId, setCategoryId] = useState(item?.category_id ?? defaultCategoryId)
  const [name, setName] = useState(item?.name ?? '')
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(item?.base_unit ?? 'pcs')
  const [packSize, setPackSize] = useState(String(item?.pack_size ?? 1))
  const [packLabel, setPackLabel] = useState(item?.pack_label ?? t.common.units.pcs)
  const [minStock, setMinStock] = useState(item?.min_stock != null ? String(item.min_stock) : '')
  const [targetStock, setTargetStock] = useState(item?.target_stock != null ? String(item.target_stock) : '')
  const [note, setNote] = useState(item?.note ?? '')
  const [sort, setSort] = useState(String(item?.sort ?? 0))
  const [tenantCoef, setTenantCoef] = useState(item?.tenant_coef != null ? String(item.tenant_coef) : '')
  const selectedCat = categories.find((c) => c.id === categoryId)
  const [defaultCost, setDefaultCost] = useState(
    item?.default_cost != null ? String(Math.round(item.default_cost * item.pack_size * 1e6) / 1e6) : '',
  )
  const [openingQty, setOpeningQty] = useState('')
  const [trackOnHand, setTrackOnHand] = useState(item?.track_on_hand ?? false)
  const [active, setActive] = useState(item?.active ?? true)
  const [unitLocked, setUnitLocked] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState<number | null>(item?.supplier_id ?? null)

  const targetInvalid = targetStock.trim() !== '' && (!(Number(targetStock) >= 0) || (minStock.trim() !== '' && Number(targetStock) < Number(minStock)))

  useEffect(() => {
    fetchSuppliers().then(setSuppliers).catch((e) => console.error(friendlyMessage(e)))
  }, [])

  useEffect(() => {
    if (!item) { setUnitLocked(false); return }
    itemHasHistory(item.id)
      .then((has) => setUnitLocked(has))
      .catch(() => setUnitLocked(true))
  }, [item])

  return (
    <Modal title={item ? t.admin.catalog.editItem : t.admin.catalog.addItem} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t.admin.catalog.category}>
          <select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={t.admin.catalog.itemName}>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        <Field label={t.admin.catalog.baseUnit}>
          <div className={`grid grid-cols-3 gap-2 ${unitLocked ? 'opacity-50 pointer-events-none' : ''}`}>
            {baseUnitOptions.map((u) => (
              <button key={u} onClick={() => setBaseUnit(u)} disabled={unitLocked}
                className={`rounded-lg py-2 text-sm border transition-colors ${baseUnit === u ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line bg-surface text-muted'} ${unitLocked ? 'cursor-not-allowed' : ''}`}>
                {t.common.units[u]}
              </button>
            ))}
          </div>
          {unitLocked && (
            <p className="text-xs text-muted mt-1">{t.admin.catalog.baseUnitLocked}</p>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t.admin.catalog.packSize}>
            <input type="number" min="1" step="0.001" value={packSize} onChange={(e) => setPackSize(e.target.value)}
              className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
          </Field>
          <Field label={t.admin.catalog.packLabel}>
            <input value={packLabel} onChange={(e) => setPackLabel(e.target.value)}
              className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
          </Field>
        </div>
        <Field label={t.admin.catalog.supplier}>
          <select value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none">
            <option value="">{t.admin.catalog.noSupplier}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={t.admin.catalog.minStock}>
          <input type="number" min="0" step="0.001" value={minStock} onChange={(e) => setMinStock(e.target.value)}
            placeholder="—"
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        <Field label={t.admin.catalog.targetStock}>
          <input type="number" min="0" step="0.001" value={targetStock} onChange={(e) => setTargetStock(e.target.value)}
            placeholder="—"
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
          {targetInvalid && <p className="text-xs text-bad mt-1">{t.admin.catalog.targetBelowMin}</p>}
        </Field>
        <Field label={t.admin.catalog.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        <Field label={t.admin.catalog.sortOrder}>
          <input type="number" step="1" value={sort} onChange={(e) => setSort(e.target.value)}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        <Field label={t.admin.catalog.tenantCoef}>
          <input type="number" min="0" step="any" value={tenantCoef} onChange={(e) => setTenantCoef(e.target.value)}
            placeholder={t.admin.catalog.tenantCoefExample}
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
          {tenantCoef.trim() && parseCoef(tenantCoef) == null
            ? <p className="text-xs text-bad mt-0.5">{t.admin.catalog.tenantCoefInvalid}</p>
            : <p className="text-xs text-muted mt-0.5">{t.admin.catalog.tenantCoefHint}</p>}
          {(() => {
            const ownCoef = tenantCoef.trim() ? parseCoef(tenantCoef) : null
            const catCoef = selectedCat?.tenant_coef ?? null
            const effective = ownCoef ?? catCoef
            const inherited = !tenantCoef.trim() && catCoef != null
            if (effective != null) {
              const amount = Math.round(100 * effective * 100) / 100
              const base = t.admin.catalog.tenantCoefExampleFmt.replace('{amount}', n(String(amount)))
              return <p className="text-xs text-muted mt-0.5">{base}{inherited ? ` (${t.admin.catalog.tenantCoefFromCategory})` : ''}</p>
            }
            return null
          })()}
        </Field>
        <Field label={t.admin.catalog.defaultCost}>
          <input type="number" min="0" step="any" value={defaultCost} onChange={(e) => setDefaultCost(e.target.value)}
            placeholder="—"
            className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
        </Field>
        {!item && (
          <Field label={t.admin.catalog.openingQty}>
            <input type="number" min="0" step="any" value={openingQty} onChange={(e) => setOpeningQty(e.target.value)}
              placeholder="0"
              className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none" />
          </Field>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={trackOnHand} onChange={(e) => setTrackOnHand(e.target.checked)}
            className="w-4 h-4 accent-[var(--accent)]" />
          <span className="text-sm text-ink">{t.admin.catalog.trackOnHand}</span>
        </label>
        {item && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent)]" />
            <span className="text-sm text-ink">{t.admin.catalog.active}</span>
          </label>
        )}
      </div>
      <Actions
        onClose={onClose}
        onSave={() => onSave({
          category_id: categoryId,
          name: name.trim(),
          base_unit: baseUnit,
          pack_size: Number(packSize),
          pack_label: packLabel.trim() || t.common.units.pcs,
          min_stock: minStock.trim() ? Number(minStock) : null,
          target_stock: targetStock.trim() ? Number(targetStock) : null,
          note: note.trim() || null,
          default_cost: defaultCost.trim() ? Number(defaultCost) / (Number(packSize) > 0 ? Number(packSize) : 1) : null,
          opening_qty: !item && openingQty.trim() ? Number(openingQty) : null,
          sort: Number.isFinite(Number(sort)) ? Math.trunc(Number(sort)) : 0,
          track_on_hand: trackOnHand,
          active: item ? active : undefined,
          supplier_id: supplierId,
          tenant_coef: parseCoef(tenantCoef),
        })}
        disabled={!name.trim() || !(Number(packSize) > 0) || (minStock.trim() !== '' && !(Number(minStock) >= 0)) || targetInvalid || (defaultCost.trim() !== '' && !(Number(defaultCost) >= 0)) || (openingQty.trim() !== '' && !(Number(openingQty) >= 0)) || (tenantCoef.trim() !== '' && parseCoef(tenantCoef) == null)}
      />
    </Modal>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet max-md:max-h-[85vh] max-md:overflow-auto md:max-h-[90vh] md:overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        {children}
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

function Actions({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex gap-3 mt-4">
      <button onClick={onClose} className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm">{t.cleaning.cancel}</button>
      <button onClick={onSave} disabled={disabled}
        className="flex-1 bg-accent text-white rounded-lg py-3 font-medium text-sm disabled:opacity-40 flex items-center justify-center gap-2">
        <Check className="w-4 h-4" />
        {t.admin.catalog.save}
      </button>
    </div>
  )
}
