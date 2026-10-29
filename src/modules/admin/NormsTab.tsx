import { useState, useMemo, useEffect, useCallback } from 'react'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { Plus, Trash2, CreditCard as Edit3, MoveVertical as MoreVertical, RotateCcw, Copy, Download, Ban } from 'lucide-react'
import type { NormRuleRow, NormType, Apartment, BaseUnit } from '@/lib/database.types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NormEditor } from './NormEditor'
import { NormCopyModal } from './NormCopyModal'
import {
  mergeNorms,
  fetchNormCatalog,
  apartmentNormsMaterialize,
  apartmentNormsReset,
  apartmentNormsCopy,
  type NormCatalogItem,
  type MergedNormRow,
} from './norms'
import { upsertNormRule, deleteNormRule } from './api'
import { formatQty } from '@/lib/format'
import { friendlyMessage } from '@/lib/errors'

const normTypeOrder: NormType[] = ['asset_standing', 'turnover_replenish', 'cleaning_consumption']

interface EditingState {
  normType: NormType
  itemId: number | null
  qty: number
  note: string | null
  overrideId?: number
  isEdit: boolean
}

interface Props {
  apartmentId: number
  overrideNorms: NormRuleRow[]
  templateNorms: NormRuleRow[]
  apartments: Apartment[]
  onReload: () => void
}

export function NormsTab({
  apartmentId,
  overrideNorms,
  templateNorms,
  apartments,
  onReload,
}: Props) {
  const { t, n } = useI18n()
  const normTypeLabels: Record<NormType, string> = {
    asset_standing: t.apartments.normInventory,
    turnover_replenish: t.apartments.normTurnover,
    cleaning_consumption: t.apartments.normCleaning,
  }
  const [catalog, setCatalog] = useState<NormCatalogItem[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [catalogError, setCatalogError] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [savingNorm, setSavingNorm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; hasTemplate: boolean } | null>(null)
  const [confirmResetType, setConfirmResetType] = useState<NormType | null>(null)
  const [confirmMaterializeType, setConfirmMaterializeType] = useState<NormType | null>(null)
  const [confirmReplaceCopy, setConfirmReplaceCopy] = useState<(() => Promise<void>) | null>(null)
  const [copyModal, setCopyModal] = useState<{ direction: 'from' | 'to'; normType: NormType } | null>(null)
  const [openMenu, setOpenMenu] = useState<NormType | null>(null)
  const [sectionLoading, setSectionLoading] = useState<NormType | null>(null)

  const loadCatalog = useCallback((silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) setCatalogError(false)
    let cancelled = false
    fetchNormCatalog()
      .then((items) => { if (!cancelled) { setCatalog(items); setCatalogLoaded(true) } })
      .catch((e) => { if (!cancelled) { if (!quiet) setCatalogError(true); toast(friendlyMessage(e), 'error') } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (catalogLoaded) return
    return loadCatalog()
  }, [catalogLoaded, loadCatalog])

  useLiveRefresh(['norm_rules', 'items'], () => {
    if (!editing && !copyModal && !confirmDelete && !confirmResetType && !confirmMaterializeType && !confirmReplaceCopy) {
      onReload()
      loadCatalog(true)
    }
  })

  const merged = useMemo(
    () => mergeNorms(templateNorms, overrideNorms),
    [templateNorms, overrideNorms],
  )

  const handleAdd = (nt: NormType) => {
    setEditing({ normType: nt, itemId: null, qty: 1, note: null, isEdit: false })
  }

  const handleEdit = (row: MergedNormRow, nt: NormType) => {
    setEditing({
      normType: nt,
      itemId: row.itemId,
      qty: row.qty,
      note: row.note,
      overrideId: row.overrideId,
      isEdit: true,
    })
  }

  const handleSave = async (itemId: number, qty: number, note: string | null) => {
    if (!editing) return
    setSavingNorm(true)
    try {
      await upsertNormRule({
        id: editing.overrideId || undefined,
        norm_type: editing.normType,
        apartment_id: apartmentId,
        apt_type: null,
        item_id: itemId,
        qty,
        note: note ?? null,
      })
      setEditing(null)
      onReload()
    } catch (e) {
      const msg = errorMessage(e)
      if (msg.includes('23505') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        toast(t.admin.normTemplates.duplicate, 'error')
      } else {
        toast(msg, 'error')
      }
    } finally {
      setSavingNorm(false)
    }
  }

  const handleExclude = async (row: MergedNormRow, nt: NormType) => {
    setSectionLoading(nt)
    try {
      await upsertNormRule({
        id: row.overrideId || undefined,
        norm_type: nt,
        apartment_id: apartmentId,
        apt_type: null,
        item_id: row.itemId,
        qty: 0,
        note: row.note,
      })
      onReload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSectionLoading(null)
    }
  }

  const handleResetToTemplate = (row: MergedNormRow) => {
    if (!row.overrideId) return
    setConfirmDelete({ id: row.overrideId, hasTemplate: row.templateQty !== undefined })
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteNormRule(confirmDelete.id)
      setConfirmDelete(null)
      onReload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const handleMaterialize = async (nt: NormType) => {
    setSectionLoading(nt)
    setConfirmMaterializeType(null)
    try {
      await apartmentNormsMaterialize(apartmentId, [nt])
      toast(t.admin.apartments.materialized, 'success')
      onReload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSectionLoading(null)
    }
  }

  const handleResetSection = async (nt: NormType) => {
    setSectionLoading(nt)
    setConfirmResetType(null)
    try {
      await apartmentNormsReset(apartmentId, [nt])
      toast(t.admin.apartments.resetDone, 'success')
      onReload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSectionLoading(null)
    }
  }

  const handleCopy = async (
    sourceId: number,
    targetIds: number[],
    normTypes: NormType[],
    replace: boolean,
  ) => {
    try {
      await apartmentNormsCopy(sourceId, targetIds, normTypes, replace)
      toast(t.admin.apartments.copyDone, 'success')
      onReload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const handleCopyWithConfirm = (
    sourceId: number,
    targetIds: number[],
    normTypes: NormType[],
    replace: boolean,
  ): Promise<void> => {
    if (replace) {
      setConfirmReplaceCopy(() => () => handleCopy(sourceId, targetIds, normTypes, true))
      return Promise.resolve()
    }
    return handleCopy(sourceId, targetIds, normTypes, false)
  }

  const getItemName = (itemId: number): string => {
    const item = catalog.find((i) => i.id === itemId)
    if (!item) return `#${n(String(itemId))}`
    return item.active ? item.name : `${item.name} (${t.admin.apartments.itemInactive})`
  }

  const getItemInfo = (itemId: number) => catalog.find((i) => i.id === itemId)

  const badgeFor = (row: MergedNormRow) => {
    if (row.excluded) {
      return <span className="inline-block px-1.5 py-0.5 rounded-full text-xs font-medium bg-bad-soft text-bad">{t.admin.apartments.badgeExcluded}</span>
    }
    if (row.source === 'template') {
      return <span className="inline-block px-1.5 py-0.5 rounded-full text-xs font-medium bg-app text-muted">{t.admin.apartments.template}</span>
    }
    return <span className="inline-block px-1.5 py-0.5 rounded-full text-xs font-medium bg-accent-soft text-accent">{t.admin.apartments.badgeCustom}</span>
  }

  return (
    <div className="mt-4 space-y-5">
      <p className="text-xs text-muted bg-app rounded-xl px-3 py-2.5">
        {t.admin.apartments.normsHint}
      </p>

      {catalogError && !catalogLoaded && (
        <button
          onClick={() => loadCatalog()}
          className="text-accent text-xs px-2 min-h-[44px]"
        >
          {t.retry}
        </button>
      )}

      {normTypeOrder.map((nt) => {
        const rows = merged.get(nt) ?? []
        return (
          <div key={nt}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">{normTypeLabels[nt]}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAdd(nt)}
                  disabled={!catalogLoaded}
                  className="text-accent text-xs flex items-center gap-1 min-h-[44px] px-2 disabled:opacity-40"
                >
                  <Plus className="w-3 h-3" /> {t.admin.apartments.addNorm}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === nt ? null : nt)}
                    className="text-muted hover:text-ink p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {openMenu === nt && (
                    <>
                      <div className="fixed inset-0 z-[65]" onClick={() => setOpenMenu(null)} />
                      <div className="absolute right-0 top-full mt-1 z-[66] bg-surface border border-line rounded-lg shadow-lg py-1 min-w-[200px]">
                        <button
                          onClick={() => { setConfirmMaterializeType(nt); setOpenMenu(null) }}
                          className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-app flex items-center gap-2 min-h-[44px]"
                        >
                          <Download className="w-4 h-4 text-muted" />
                          {t.admin.apartments.makeIndependent}
                        </button>
                        <button
                          onClick={() => { setConfirmResetType(nt); setOpenMenu(null) }}
                          className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-app flex items-center gap-2 min-h-[44px]"
                        >
                          <RotateCcw className="w-4 h-4 text-muted" />
                          {t.admin.apartments.resetSection}
                        </button>
                        <button
                          onClick={() => { setCopyModal({ direction: 'from', normType: nt }); setOpenMenu(null) }}
                          className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-app flex items-center gap-2 min-h-[44px]"
                        >
                          <Copy className="w-4 h-4 text-muted" />
                          {t.admin.apartments.copyToApts}
                        </button>
                        <button
                          onClick={() => { setCopyModal({ direction: 'to', normType: nt }); setOpenMenu(null) }}
                          className="w-full text-left px-3 py-2.5 text-sm text-ink hover:bg-app flex items-center gap-2 min-h-[44px]"
                        >
                          <Copy className="w-4 h-4 text-muted" />
                          {t.admin.apartments.copyFromApt}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted mb-2">{t.admin.apartments.sectionHints[nt]}</p>

            {sectionLoading === nt ? (
              <div className="bg-surface border border-line rounded-lg p-4 text-center text-muted text-sm">{t.app.loading}</div>
            ) : rows.length === 0 ? (
              <div className="bg-surface border border-line rounded-lg p-4 text-center text-muted text-sm">{t.admin.apartments.noNorms}</div>
            ) : (
              <div className="bg-surface border border-line rounded-lg divide-y divide-[var(--line)]">
                {rows.map((row) => {
                  const info = getItemInfo(row.itemId)
                  const name = getItemName(row.itemId)
                  return (
                    <div
                      key={row.itemId}
                      className={`px-3 py-2.5 flex items-center justify-between gap-2 ${row.excluded ? 'opacity-50' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm text-ink ${row.excluded ? 'line-through' : ''}`}>{name}</span>
                          {badgeFor(row)}
                        </div>
                        {info && (
                          <span className="text-xs text-muted block">
                            {n(formatQty(row.qty, { base_unit: info.base_unit as BaseUnit, pack_size: info.pack_size, pack_label: info.pack_label }))}
                          </span>
                        )}
                        {!info && (
                          <span className="text-xs text-muted block">{n(String(row.qty))}</span>
                        )}
                        {row.note && <span className="text-xs text-muted block">{row.note}</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleEdit(row, nt)}
                          disabled={!catalogLoaded}
                          className="text-muted hover:text-accent p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-40"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {!row.excluded && (
                          <button
                            onClick={() => handleExclude(row, nt)}
                            className="text-muted hover:text-warn p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center"
                            title={t.admin.apartments.exclude}
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {row.source === 'custom' && (
                          <button
                            onClick={() => handleResetToTemplate(row)}
                            className="text-muted hover:text-bad p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center"
                            title={row.templateQty !== undefined ? t.admin.apartments.resetToTemplate : t.admin.apartments.deleteNorm}
                          >
                            {row.templateQty !== undefined ? <RotateCcw className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {editing && (
        <NormEditor
          normType={editing.normType}
          itemId={editing.itemId}
          qty={editing.qty}
          note={editing.note}
          isEdit={editing.isEdit}
          catalog={catalog}
          excludeItemIds={new Set(
            Array.from(merged.entries())
              .filter(([nt]) => nt === editing.normType || (nt !== 'asset_standing' && editing.normType !== 'asset_standing'))
              .flatMap(([, rows]) => rows.map((r) => r.itemId)),
          )}
          saving={savingNorm}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title={confirmDelete.hasTemplate ? t.admin.apartments.resetToTemplate : t.admin.apartments.deleteNorm}
          message={confirmDelete.hasTemplate ? t.admin.apartments.resetToTemplateConfirm : t.admin.apartments.deleteNormConfirm}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmResetType && (
        <ConfirmDialog
          open={true}
          title={t.admin.apartments.resetSection}
          message={t.admin.apartments.resetSectionConfirm}
          onConfirm={() => handleResetSection(confirmResetType)}
          onCancel={() => setConfirmResetType(null)}
        />
      )}

      {confirmMaterializeType && (
        <ConfirmDialog
          open={true}
          title={t.admin.apartments.makeIndependent}
          message={t.admin.apartments.makeIndependentConfirm}
          tone="warn"
          onConfirm={() => handleMaterialize(confirmMaterializeType)}
          onCancel={() => setConfirmMaterializeType(null)}
        />
      )}

      {confirmReplaceCopy && (
        <ConfirmDialog
          open={true}
          title={t.admin.apartments.copyReplace}
          message={t.admin.apartments.copyReplaceConfirm}
          onConfirm={() => { confirmReplaceCopy(); setConfirmReplaceCopy(null) }}
          onCancel={() => setConfirmReplaceCopy(null)}
        />
      )}

      {copyModal && (
        <NormCopyModal
          direction={copyModal.direction}
          currentApartmentId={apartmentId}
          currentNormType={copyModal.normType}
          apartments={apartments}
          onConfirm={handleCopyWithConfirm}
          onClose={() => setCopyModal(null)}
        />
      )}
    </div>
  )
}
