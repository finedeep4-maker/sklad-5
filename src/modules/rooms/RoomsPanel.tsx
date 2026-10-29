import { useState, useEffect, useMemo, useCallback } from 'react'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { Plus, X, Loader as Loader2 } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { friendlyMessage } from '@/lib/errors'
import { unitLabel } from '@/lib/format'
import { useLiveRefresh } from '@/lib/realtime'
import { fetchNormCatalog, type NormCatalogItem } from '@/modules/admin/norms'
import { fetchCategories, createItem } from '@/modules/admin/api'
import type { AptType, ApartmentRoomRow, BaseUnit, Category, Room } from '@/lib/database.types'
import { fetchRooms, fetchApartmentRoomRows, saveRoomNorm, saveRoomStock, removeFromRoom } from './api'

interface Props {
  apartmentId: number
  aptType: AptType | null
  canEdit: boolean
  /** Остаток предметов в квартире целиком (item_id -> количество), для предупреждения; только у админа. */
  totals?: Map<number, number>
}

type RoomFilter = number | 'all'

interface EditState {
  roomId: number
  itemId: number | null
  itemName: string
  unit: string
  norm0: number
  actual0: number
}

function parseQty(s: string): number | null {
  const v = s.trim().replace(',', '.')
  if (v === '') return null
  const num = Number(v)
  if (!isFinite(num) || num < 0 || num > 999999.999) return null
  const dot = v.indexOf('.')
  if (dot !== -1 && v.length - dot - 1 > 3) return null
  return num
}

export function RoomsPanel({ apartmentId, aptType, canEdit, totals }: Props) {
  const { t, n } = useI18n()
  const roomLabel = (name: string) => (t.rooms.names as Record<string, string>)[name] ?? name

  const [rooms, setRooms] = useState<Room[]>([])
  const [rows, setRows] = useState<ApartmentRoomRow[]>([])
  const [catalog, setCatalog] = useState<NormCatalogItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<RoomFilter>('all')
  const [editing, setEditing] = useState<EditState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ roomId: number; itemId: number; hadNorm: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback((silent?: boolean) => {
    if (!silent) { setLoading(true); setLoadError(null) }
    Promise.all([fetchRooms(), fetchApartmentRoomRows(apartmentId)])
      .then(([r, v]) => { setRooms(r); setRows(v) })
      .catch((e) => { if (!silent) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!silent) setLoading(false) })
  }, [apartmentId])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['rooms', 'room_norms', 'room_stock', 'apartments', 'items'], () => load(true))

  useEffect(() => {
    if (!editing || !canEdit) return
    if (catalog.length === 0) fetchNormCatalog().then(setCatalog).catch((e) => toast(errorMessage(e), 'error'))
    if (categories.length === 0) fetchCategories().then(setCategories).catch((e) => toast(errorMessage(e), 'error'))
  }, [editing, canEdit, catalog.length, categories.length])

  const visible = useMemo(() => rows.filter((r) => r.norm > 0 || r.actual > 0), [rows])
  const itemSums = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows) m.set(r.item_id, (m.get(r.item_id) ?? 0) + r.actual)
    return m
  }, [rows])
  const shown = useMemo(
    () => (filter === 'all' ? visible : visible.filter((r) => r.room_id === filter)),
    [visible, filter],
  )
  const missingCount = shown.filter((r) => r.gap > 0).length
  const groups = rooms
    .map((room) => ({ room, items: shown.filter((r) => r.room_id === room.id) }))
    .filter((g) => g.items.length > 0)

  const openEdit = (r: ApartmentRoomRow) =>
    setEditing({ roomId: r.room_id, itemId: r.item_id, itemName: r.item_name, unit: unitLabel(r.base_unit as BaseUnit), norm0: r.norm, actual0: r.actual })
  const openAdd = () => {
    if (filter === 'all') return
    setEditing({ roomId: filter, itemId: null, itemName: '', unit: '', norm0: 0, actual0: 0 })
  }

  const handleSave = async (p: { itemId: number | null; newItem: { name: string; categoryId: number } | null; norm: number; actual: number; forType: boolean }) => {
    if (!editing) return
    setSaving(true)
    try {
      let itemId = p.itemId
      if (p.newItem) {
        itemId = await createItem({
          category_id: p.newItem.categoryId,
          name: p.newItem.name,
          base_unit: 'pcs',
          pack_size: 1,
          pack_label: t.common.units.pcs,
          min_stock: null,
          track_on_hand: false,
        })
        setCatalog([])
      }
      if (itemId === null) return
      if (p.norm !== editing.norm0 || p.forType) {
        await saveRoomNorm({ apartmentId, aptType, roomId: editing.roomId, itemId, qty: p.norm, forType: p.forType })
      }
      if (p.actual !== editing.actual0) {
        await saveRoomStock({ apartmentId, roomId: editing.roomId, itemId, qty: p.actual })
      }
      toast(t.rooms.saved, 'success')
      setEditing(null)
      load(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    setSaving(true)
    try {
      await removeFromRoom({ apartmentId, ...removeTarget })
      toast(t.rooms.saved, 'success')
      setRemoveTarget(null)
      setEditing(null)
      load(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-6 text-center text-muted text-sm">{t.app.loading}</div>
  if (loadError) return <ErrorState onRetry={() => load()} />

  const chip = (active: boolean) =>
    `shrink-0 whitespace-nowrap min-h-[40px] rounded-full px-3 py-1.5 text-sm border ${active ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-line'}`

  return (
    <div>
      <div className="font-semibold text-sm text-ink mb-2">{t.rooms.title}</div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button onClick={() => setFilter('all')} className={chip(filter === 'all')}>{t.rooms.allRooms}</button>
        {rooms.map((room) => (
          <button key={room.id} onClick={() => setFilter(room.id)} className={chip(filter === room.id)}>
            {roomLabel(room.name)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted mt-1 mb-2">
        <span>{t.rooms.legend}</span>
        {missingCount > 0 && <span className="text-bad">{t.rooms.missingItems}: {n(String(missingCount))}</span>}
      </div>

      {groups.length === 0 ? (
        <p className="text-muted text-sm text-center py-4">{t.rooms.empty}</p>
      ) : (
        <div className="space-y-3">
          {groups.map(({ room, items }) => (
            <div key={room.id}>
              {filter === 'all' && <div className="text-xs font-semibold text-muted mb-1">{roomLabel(room.name)}</div>}
              <div className="bg-surface border border-line rounded-lg divide-y divide-[var(--line)]">
                {items.map((r) => {
                  const total = totals?.get(r.item_id)
                  const sum = itemSums.get(r.item_id) ?? 0
                  return (
                    <div key={`${r.room_id}-${r.item_id}`} className="px-3 py-2.5">
                      <button
                        disabled={!canEdit}
                        onClick={() => openEdit(r)}
                        className="w-full flex items-center justify-between gap-2 text-left disabled:cursor-default"
                      >
                        <span className="text-sm text-ink">{r.item_name}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-sm text-muted">
                            {n(String(r.actual))} / {n(String(r.norm))} {unitLabel(r.base_unit as BaseUnit)}
                          </span>
                          {r.gap > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-bad-soft text-bad">−{n(String(r.gap))}</span>
                          ) : r.gap < 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-warn-soft text-warn">+{n(String(-r.gap))}</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-ok-soft text-ok">✓</span>
                          )}
                        </span>
                      </button>
                      {canEdit && total !== undefined && sum > total && (
                        <p className="text-xs text-warn mt-1">{t.rooms.overTotal}: {n(String(sum))} / {n(String(total))}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        filter === 'all' ? (
          <p className="text-xs text-muted mt-3">{t.rooms.selectRoomHint}</p>
        ) : (
          <button
            onClick={openAdd}
            className="mt-3 bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.rooms.addItem}
          </button>
        )
      )}

      {editing && (
        <RoomEditor
          state={editing}
          roomName={roomLabel(rooms.find((r) => r.id === editing.roomId)?.name ?? '')}
          catalog={catalog}
          categories={categories}
          takenItemIds={new Set(visible.filter((r) => r.room_id === editing.roomId).map((r) => r.item_id))}
          canForType={aptType !== null}
          saving={saving}
          onSave={handleSave}
          onRemove={() => editing.itemId !== null && setRemoveTarget({ roomId: editing.roomId, itemId: editing.itemId, hadNorm: editing.norm0 > 0 })}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={t.rooms.removeTitle}
        message={t.rooms.removeMessage}
        confirmLabel={t.rooms.remove}
        cancelLabel={t.cleaning.cancel}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}

function RoomEditor({ state, roomName, catalog, categories, takenItemIds, canForType, saving, onSave, onRemove, onClose }: {
  state: EditState
  roomName: string
  catalog: NormCatalogItem[]
  categories: Category[]
  takenItemIds: Set<number>
  canForType: boolean
  saving: boolean
  onSave: (p: { itemId: number | null; newItem: { name: string; categoryId: number } | null; norm: number; actual: number; forType: boolean }) => void
  onRemove: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const isEdit = state.itemId !== null
  const [itemId, setItemId] = useState<number | null>(state.itemId)
  const [search, setSearch] = useState('')
  const [normStr, setNormStr] = useState(String(state.norm0))
  const [actualStr, setActualStr] = useState(String(state.actual0))
  const [forType, setForType] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null)
  const assetCategories = categories.filter((c) => c.kind === 'asset')
  const categoryId = newCategoryId ?? assetCategories[0]?.id ?? null

  const normVal = parseQty(normStr)
  const actualVal = parseQty(actualStr)
  const hasData = (normVal ?? 0) > 0 || (actualVal ?? 0) > 0
  const itemOk = creating ? newName.trim().length > 0 && categoryId !== null : itemId !== null
  const valid = itemOk && normVal !== null && actualVal !== null && (isEdit || hasData)

  const items = useMemo(() => {
    const q = search.toLowerCase().trim()
    return catalog.filter((i) => i.kind === 'asset' && i.active && !takenItemIds.has(i.id) && (!q || i.name.toLowerCase().includes(q)))
  }, [catalog, search, takenItemIds])
  const selected = catalog.find((i) => i.id === itemId)
  const unit = creating ? t.common.units.pcs : selected ? unitLabel(selected.base_unit as BaseUnit) : state.unit

  const inputCls = 'w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none'

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-ink">{isEdit ? t.rooms.editTitle : t.rooms.addTitle}</h3>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-muted" /></button>
        </div>
        <p className="text-xs text-muted mb-3">{roomName}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-muted mb-1">{t.rooms.item}</label>
            {isEdit ? (
              <p className="text-sm text-ink">{state.itemName}</p>
            ) : (
              creating ? (
                <>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} placeholder={t.rooms.newItemName} className={inputCls} />
                  <select
                    value={categoryId ?? ''}
                    onChange={(e) => setNewCategoryId(Number(e.target.value))}
                    className={`${inputCls} mt-2`}
                  >
                    {assetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {assetCategories.length === 0 && <p className="text-xs text-warn mt-1">{t.rooms.noAssetCategories}</p>}
                  <button type="button" onClick={() => setCreating(false)} className="mt-2 text-xs text-accent">{t.rooms.pickExisting}</button>
                </>
              ) : (
                <>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.rooms.searchItem} className={inputCls} />
                  <select
                    value={itemId ?? ''}
                    onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : null)}
                    className={`${inputCls} mt-2`}
                  >
                    <option value="">—</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setCreating(true)} className="mt-2 text-xs text-accent">{t.rooms.createNew}</button>
                </>
              )
            )}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-muted mb-1">{t.rooms.should}{unit ? `, ${unit}` : ''}</label>
              <input value={normStr} onChange={(e) => setNormStr(e.target.value)} inputMode="decimal" className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-muted mb-1">{t.rooms.have}{unit ? `, ${unit}` : ''}</label>
              <input value={actualStr} onChange={(e) => setActualStr(e.target.value)} inputMode="decimal" className={inputCls} />
            </div>
          </div>
          {canForType && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={forType} onChange={(e) => setForType(e.target.checked)} />
              {t.rooms.forType}
            </label>
          )}
        </div>
        <div className="flex gap-3 mt-4">
          {isEdit && (
            <button onClick={onRemove} disabled={saving} className="bg-bad-soft text-bad rounded-xl px-3 py-3 text-sm font-medium disabled:opacity-40">
              {t.rooms.remove}
            </button>
          )}
          <button
            onClick={() => valid && onSave({
              itemId: creating ? null : itemId,
              newItem: creating && categoryId !== null ? { name: newName.trim(), categoryId } : null,
              norm: normVal as number,
              actual: actualVal as number,
              forType,
            })}
            disabled={!valid || saving}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t.rooms.save}
          </button>
        </div>
      </div>
    </>
  )
}
