import { useState, useMemo } from 'react'
import { useI18n } from '@/i18n'
import { X, Check, Loader as Loader2, Search } from 'lucide-react'
import type { NormType, Apartment } from '@/lib/database.types'

export interface CopyMode {
  direction: 'from' | 'to'
  currentApartmentId: number
  currentNormType: NormType
  apartments: Apartment[]
  onConfirm: (sourceId: number, targetIds: number[], normTypes: NormType[], replace: boolean) => Promise<void>
  onClose: () => void
}

export function NormCopyModal({
  direction,
  currentApartmentId,
  currentNormType,
  apartments,
  onConfirm,
  onClose,
}: CopyMode) {
  const { t } = useI18n()
  const normTypeLabels: Record<NormType, string> = {
    asset_standing: t.apartments.normInventory,
    turnover_replenish: t.apartments.normTurnover,
    cleaning_consumption: t.apartments.normCleaning,
  }
  const allTypes: NormType[] = ['asset_standing', 'turnover_replenish', 'cleaning_consumption']

  const [selectedTypes, setSelectedTypes] = useState<Set<NormType>>(new Set([currentNormType]))
  const [replace, setReplace] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const otherApartments = useMemo(
    () => apartments.filter((a) => a.id !== currentApartmentId),
    [apartments, currentApartmentId],
  )

  const filteredApts = useMemo(() => {
    const q = search.toLowerCase().trim()
    return otherApartments.filter((a) => !q || a.code.toLowerCase().includes(q))
  }, [otherApartments, search])

  const toggleType = (nt: NormType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(nt)) { next.delete(nt) } else { next.add(nt) }
      return next
    })
  }

  const toggleApt = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const canConfirm = direction === 'from'
    ? selectedIds.size > 0 && selectedTypes.size > 0
    : sourceId !== null && selectedTypes.size > 0

  const handleConfirm = async () => {
    if (!canConfirm) return
    setSaving(true)
    try {
      if (direction === 'from') {
        await onConfirm(currentApartmentId, Array.from(selectedIds), Array.from(selectedTypes), replace)
      } else {
        await onConfirm(sourceId!, [currentApartmentId], Array.from(selectedTypes), replace)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">
            {direction === 'from' ? t.admin.apartments.copyToApts : t.admin.apartments.copyFromApt}
          </h3>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-2">{t.admin.apartments.copyTypes}</label>
            <div className="space-y-1.5">
              {allTypes.map((nt) => (
                <label key={nt} className="flex items-center gap-2 px-3 py-2 bg-app rounded-lg cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(nt)}
                    onChange={() => toggleType(nt)}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                  <span className="text-sm text-ink">{normTypeLabels[nt]}</span>
                </label>
              ))}
            </div>
          </div>

          {direction === 'from' ? (
            <div>
              <label className="block text-sm text-muted mb-2">{t.admin.apartments.copySelectTargets}</label>
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.admin.apartments.searchByCode}
                  className="w-full bg-app rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none"
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {filteredApts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 px-3 py-2 bg-app rounded-lg cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleApt(a.id)}
                      className="w-4 h-4 accent-[var(--accent)]"
                    />
                    <span className="text-sm text-ink">{a.code} <span className="text-muted">({a.type})</span></span>
                  </label>
                ))}
                {filteredApts.length === 0 && (
                  <p className="text-sm text-muted px-3">{t.common.notFound}</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm text-muted mb-2">{t.admin.apartments.copySelectSource}</label>
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.admin.apartments.searchByCode}
                  className="w-full bg-app rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none"
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {filteredApts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 px-3 py-2 bg-app rounded-lg cursor-pointer min-h-[44px]">
                    <input
                      type="radio"
                      name="source-apt"
                      checked={sourceId === a.id}
                      onChange={() => setSourceId(a.id)}
                      className="w-4 h-4 accent-[var(--accent)]"
                    />
                    <span className="text-sm text-ink">{a.code} <span className="text-muted">({a.type})</span></span>
                  </label>
                ))}
                {filteredApts.length === 0 && (
                  <p className="text-sm text-muted px-3">{t.common.notFound}</p>
                )}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 px-3 py-2 bg-app rounded-lg cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent)]"
            />
            <span className="text-sm text-ink">{t.admin.apartments.copyReplace}</span>
          </label>
          {replace && (
            <p className="text-xs text-warn px-3">{t.admin.apartments.copyReplaceWarn}</p>
          )}
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm min-h-[44px]">
            {t.cleaning.cancel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || saving}
            className="flex-1 bg-accent text-white rounded-lg py-3 font-medium text-sm disabled:opacity-40 flex items-center justify-center gap-2 min-h-[44px]"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t.admin.apartments.copyApply}
          </button>
        </div>
      </div>
    </>
  )
}
