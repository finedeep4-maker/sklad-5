import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchApartmentsAdmin, fetchApartmentGaps, fetchBuildings, createApartment, createBuilding, updateApartment } from '@/modules/admin/api'
import type { Apartment, Building, ApartmentGapRow, AptType } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { Search, Plus, X, Loader as Loader2, CreditCard as Edit3 } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { OwnerBadge } from '@/components/OwnerBadge'

function pctColor(p: number): string {
  if (p >= 100) return 'var(--ok)'
  if (p >= 75) return 'var(--warn)'
  return 'var(--bad)'
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <span className="block h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
    </span>
  )
}

const typeOrder: AptType[] = ['studio', '1br', '2br']

type TypeFilter = 'all' | AptType
type OwnerFilter = 'all' | 'owner' | 'regular'

export function AdminApartmentList() {
  const { t, n } = useI18n()
  const typeLabels: Record<AptType, string> = {
    studio: t.apartments.typeStudio,
    '1br': t.apartments.type1br,
    '2br': t.apartments.type2br,
  }
  const navigate = useNavigate()
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [gaps, setGaps] = useState<ApartmentGapRow[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editingApt, setEditingApt] = useState<Apartment | null>(null)

  const load = (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    Promise.all([fetchApartmentsAdmin(), fetchBuildings(), fetchApartmentGaps()])
      .then(([a, b, g]) => {
        setApartments(a)
        setBuildings(b)
        setGaps(g)
      })
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => { load() }, [])
  useLiveRefresh(['apartments', 'buildings', 'cleaning_events', 'norm_rules', 'items', 'stock_moves'], () => load(true))

  const buildingMap = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])

  const gapApartments = useMemo(() => {
    const totalNorms = new Map<number, number>()
    const totalGaps = new Map<number, number>()
    const totalMissingQty = new Map<number, number>()
    for (const g of gaps) {
      totalNorms.set(g.apartment_id, (totalNorms.get(g.apartment_id) ?? 0) + 1)
      if (g.gap > 0) {
        totalGaps.set(g.apartment_id, (totalGaps.get(g.apartment_id) ?? 0) + 1)
        totalMissingQty.set(g.apartment_id, (totalMissingQty.get(g.apartment_id) ?? 0) + g.gap)
      }
    }
    return { totalNorms, totalGaps, totalMissingQty }
  }, [gaps])

  const grouped = useMemo(() => {
    const filtered = apartments.filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false
      if (ownerFilter === 'owner' && !a.is_owner) return false
      if (ownerFilter === 'regular' && a.is_owner) return false
      if (search.trim() && !a.code.toLowerCase().includes(search.toLowerCase().trim())) return false
      return true
    })
    const map = new Map<AptType, Apartment[]>()
    for (const a of filtered) {
      const list = map.get(a.type) ?? []
      list.push(a)
      map.set(a.type, list)
    }
    return typeOrder
      .filter((tp) => map.has(tp))
      .map((tp) => [tp, map.get(tp)!] as const)
  }, [apartments, search, typeFilter, ownerFilter])

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }
  if (loadError) return <ErrorState onRetry={load} />

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.apartments.title}</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="ml-auto bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5 transition-opacity hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
          {t.admin.apartments.add}
        </button>
      </div>

      <div className="flex gap-2.5 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.apartments.search}
            className="w-full bg-surface rounded-lg pl-10 pr-4 py-2 text-sm border border-line focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="bg-surface rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none"
        >
          <option value="all">{t.apartments.typeAll}</option>
          {typeOrder.map((tp) => (
            <option key={tp} value={tp}>{typeLabels[tp]}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 mb-4">
        {(['all', 'owner', 'regular'] as OwnerFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setOwnerFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              ownerFilter === f
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface text-muted'
            }`}
          >
            {f === 'all' ? t.admin.apartments.filterAll : f === 'owner' ? t.admin.apartments.filterOwner : t.admin.apartments.filterRegular}
          </button>
        ))}
      </div>

      {grouped.map(([type, apts]) => (
        <div key={type} className="mb-5">
          <h2 className="font-semibold text-sm text-ink mb-2 px-1">{typeLabels[type]}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
            {apts.map((apt) => {
              const total = gapApartments.totalNorms.get(apt.id) ?? 0
              const missing = gapApartments.totalGaps.get(apt.id) ?? 0
              const missingQty = gapApartments.totalMissingQty.get(apt.id) ?? 0
              const p = total > 0 ? Math.round(((total - missing) / total) * 100) : 100
              return (
                <div
                  key={apt.id}
                  className="relative bg-surface border border-line rounded-lg px-3 py-2.5 transition-colors hover:border-accent"
                >
                  <button
                    onClick={() => setEditingApt(apt)}
                    className="absolute top-1.5 end-1.5 p-1 rounded text-muted hover:text-accent"
                    aria-label={t.admin.apartments.edit}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <div
                    onClick={() => navigate(`/admin/apartments/${apt.id}`)}
                    className="text-left cursor-pointer"
                  >
                  <div className="flex items-center gap-1.5">
                    <b className="text-base text-ink">{apt.code}</b>
                    {apt.is_owner && <OwnerBadge />}
                  </div>
                  <div className="text-muted text-xs">{buildingMap.get(apt.building_id) ?? '?'}</div>
                  <ProgressBar value={p} color={pctColor(p)} />
                  <div className="text-muted text-xs mt-1">
                    {missingQty > 0 ? `${t.admin.dashboard.gap} ${n(String(missingQty))}` : t.admin.apartments.completeness}
                  </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {grouped.length === 0 && (
        <div className="px-4 py-6 text-center text-muted text-sm">{t.common.noResults}</div>
      )}
      {showAdd && (
        <AddApartmentModal
          buildings={buildings}
          typeLabels={typeLabels}
          onClose={() => setShowAdd(false)}
          onCreated={(id) => { setShowAdd(false); load(true); navigate(`/admin/apartments/${id}`) }}
        />
      )}
      {editingApt && (
        <EditApartmentModal
          apartment={editingApt}
          buildings={buildings}
          typeLabels={typeLabels}
          onClose={() => setEditingApt(null)}
          onSaved={() => { setEditingApt(null); load(true) }}
        />
      )}
    </div>
  )
}

const NEW_BUILDING = 'new'

function AddApartmentModal({ buildings, typeLabels, onClose, onCreated }: {
  buildings: Building[]
  typeLabels: Record<AptType, string>
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const { t } = useI18n()
  const [buildingId, setBuildingId] = useState<string>(buildings[0] ? String(buildings[0].id) : NEW_BUILDING)
  const [newBuilding, setNewBuilding] = useState('')
  const [number, setNumber] = useState('')
  const [type, setType] = useState<AptType>('studio')
  const [isOwner, setIsOwner] = useState(false)
  const [createdBuilding, setCreatedBuilding] = useState<Building | null>(null)
  const [saving, setSaving] = useState(false)

  const isNew = buildingId === NEW_BUILDING
  const num = number.trim()
  const bName = createdBuilding
    ? createdBuilding.name
    : isNew ? newBuilding.trim() : (buildings.find((b) => String(b.id) === buildingId)?.name ?? '')
  const valid = bName.length > 0 && bName.length <= 20 && num.length > 0 && num.length <= 20 && !num.includes('/')

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      let building = createdBuilding
      if (!building && isNew) {
        building = await createBuilding(bName)
        setCreatedBuilding(building)
      }
      const bid = building ? building.id : Number(buildingId)
      const apt = await createApartment({ buildingId: bid, buildingName: bName, number: num, type, isOwner })
      toast(t.admin.apartments.created, 'success')
      onCreated(apt.id)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
      <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{t.admin.apartments.addTitle}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.apartments.building}</label>
            <select
              value={createdBuilding ? String(createdBuilding.id) : buildingId}
              onChange={(e) => setBuildingId(e.target.value)}
              disabled={!!createdBuilding}
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none"
            >
              {buildings.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              {createdBuilding && <option value={String(createdBuilding.id)}>{createdBuilding.name}</option>}
              <option value={NEW_BUILDING}>{t.admin.apartments.newBuilding}</option>
            </select>
          </div>
          {isNew && !createdBuilding && (
            <div>
              <label className="block text-sm text-ink mb-1">{t.admin.apartments.buildingName}</label>
              <input value={newBuilding} onChange={(e) => setNewBuilding(e.target.value)} maxLength={20} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
            </div>
          )}
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.apartments.number}</label>
            <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={20} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.apartments.type}</label>
            <select value={type} onChange={(e) => setType(e.target.value as AptType)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none">
              {typeOrder.map((tp) => <option key={tp} value={tp}>{typeLabels[tp]}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)}
              className="w-4 h-4 mt-0.5 shrink-0 accent-[var(--accent)]" />
            <span className="text-sm text-ink">
              {t.admin.apartments.ownerToggle}
              <span className="block text-xs text-muted mt-0.5">{t.admin.apartments.ownerHint}</span>
            </span>
          </label>
          {valid && (
            <p className="text-xs text-muted">{t.admin.apartments.code}: <b className="text-ink">{bName}/{num}</b></p>
          )}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
          <button
            onClick={save}
            disabled={!valid || saving}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t.admin.apartments.create}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EditApartmentModal({ apartment, buildings, typeLabels, onClose, onSaved }: {
  apartment: Apartment
  buildings: Building[]
  typeLabels: Record<AptType, string>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [buildingId, setBuildingId] = useState<string>(String(apartment.building_id))
  const [number, setNumber] = useState(apartment.number)
  const [type, setType] = useState<AptType>(apartment.type)
  const [isOwner, setIsOwner] = useState(apartment.is_owner)
  const [saving, setSaving] = useState(false)

  const originalType = apartment.type
  const typeChanged = type !== originalType
  const bName = buildings.find((b) => String(b.id) === buildingId)?.name ?? ''
  const num = number.trim()
  const valid = bName.length > 0 && num.length > 0 && num.length <= 20 && !num.includes('/')

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await updateApartment({
        id: apartment.id,
        buildingId: Number(buildingId),
        buildingName: bName,
        number: num,
        type,
        isOwner,
      })
      toast(t.admin.apartments.updated, 'success')
      onSaved()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center px-6">
      <div className="bg-surface rounded-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{t.admin.apartments.editTitle}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.apartments.building}</label>
            <select
              value={buildingId}
              onChange={(e) => setBuildingId(e.target.value)}
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none"
            >
              {buildings.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.apartments.number}</label>
            <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={20} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.apartments.type}</label>
            <select value={type} onChange={(e) => setType(e.target.value as AptType)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none">
              {typeOrder.map((tp) => <option key={tp} value={tp}>{typeLabels[tp]}</option>)}
            </select>
            {typeChanged && (
              <p className="text-xs text-warn mt-1">{t.admin.apartments.editTypeWarn}</p>
            )}
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)}
              className="w-4 h-4 mt-0.5 shrink-0 accent-[var(--accent)]" />
            <span className="text-sm text-ink">
              {t.admin.apartments.ownerToggle}
              <span className="block text-xs text-muted mt-0.5">{t.admin.apartments.ownerHint}</span>
            </span>
          </label>
          {valid && (
            <p className="text-xs text-muted">{t.admin.apartments.code}: <b className="text-ink">{bName}/{num}</b></p>
          )}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
          <button
            onClick={save}
            disabled={!valid || saving}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t.admin.apartments.editSubmit}
          </button>
        </div>
      </div>
    </div>
  )
}
