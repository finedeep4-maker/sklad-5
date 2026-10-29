import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  fetchApartmentsAdmin,
  fetchApartmentGaps,
  fetchNormRules,
  fetchTemplateNorms,
  fetchAllStaff,
  fetchBuildings,
  issueMissing,
  reverseCleaning,
  recalculateCleaning,
} from '@/modules/admin/api'
import type { Apartment, ApartmentGapRow, NormRuleRow, Staff, IssueMissingResult, Building } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { cairoLocalToISO } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { ClipboardList, History, Gift, X, Loader as Loader2, Wrench, Boxes, CreditCard as Edit3 } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { CleaningHistoryList } from '@/modules/history/CleaningHistoryList'
import { IncidentHistoryList } from '@/modules/history/IncidentHistoryList'
import { NormsTab } from './NormsTab'
import { RoomsPanel } from '@/modules/rooms/RoomsPanel'
import { useLiveRefresh } from '@/lib/realtime'
import { OwnerBadge } from '@/components/OwnerBadge'
import { EditApartmentModal } from './AdminApartmentList'
import { useCatalogName } from '@/modules/core/useCatalogName'

type Tab = 'norms' | 'rooms' | 'cleaning' | 'incidents'

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

export function AdminApartmentDetail() {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const aptId = Number(id)
  const [apartment, setApartment] = useState<Apartment | null>(null)
  const [allApartments, setAllApartments] = useState<Apartment[]>([])
  const [gaps, setGaps] = useState<ApartmentGapRow[]>([])
  const [overrideNorms, setOverrideNorms] = useState<NormRuleRow[]>([])
  const [templateNorms, setTemplateNorms] = useState<NormRuleRow[]>([])
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [tab, setTab] = useState<Tab>('norms')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [issueResult, setIssueResult] = useState<IssueMissingResult | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [reverseEventId, setReverseEventId] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [recalcEventId, setRecalcEventId] = useState<string | null>(null)
  const [recalcDate, setRecalcDate] = useState('')
  const [recalcStaffIds, setRecalcStaffIds] = useState<number[]>([])
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [editingApt, setEditingApt] = useState<Apartment | null>(null)
  const [buildings, setBuildings] = useState<Building[]>([])

  const loadedAptIdRef = useRef<number | null>(null)

  const loadAll = useCallback((opts?: { silent?: boolean }) => {
    if (!aptId) return
    const silent = opts?.silent ?? false
    const isFirstLoad = loadedAptIdRef.current !== aptId
    if (isFirstLoad && !silent) {
      setLoading(true)
      setLoadError(null)
    }
    Promise.all([
      fetchApartmentsAdmin(),
      fetchApartmentGaps(),
      fetchNormRules(aptId),
      fetchAllStaff(),
      fetchBuildings(),
    ])
      .then(([apts, ga, norms, st, bld]) => {
        const apt = apts.find((a) => a.id === aptId) ?? null
        setApartment(apt)
        setAllApartments(apts)
        setGaps(ga.filter((g) => g.apartment_id === aptId))
        setOverrideNorms(norms)
        setBuildings(bld)
        if (apt) {
          fetchTemplateNorms(apt.type).then(setTemplateNorms).catch((e) => console.error(friendlyMessage(e)))
        }
        setStaffList(st)
        loadedAptIdRef.current = aptId
      })
      .catch((e) => {
        if (isFirstLoad && !silent) {
          setLoadError(friendlyMessage(e))
        } else {
          toast(friendlyMessage(e), 'error')
        }
      })
      .finally(() => {
        if (isFirstLoad && !silent) setLoading(false)
      })
  }, [aptId])

  useEffect(() => {
    loadAll()
  }, [loadAll])
  useLiveRefresh(['apartments', 'norm_rules', 'staff', 'items', 'cleaning_events', 'stock_moves'], () => loadAll({ silent: true }))

  const gapItems = useMemo(() => gaps.filter((g) => g.gap > 0), [gaps])
  const roomTotals = useMemo(() => new Map(gaps.map((g) => [g.item_id, Number(g.actual)])), [gaps])

  const handleIssueAll = async () => {
    setIssuing(true)
    try {
      const result = await issueMissing(aptId)
      setIssueResult(result)
      if (result.issued.length === 0 && result.short.length > 0) {
        toast(t.admin.apartments.nothingIssued, 'error')
      } else {
        toast(t.admin.apartments.issued, 'success')
      }
      loadAll({ silent: true })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setIssuing(false)
    }
  }

  const handleReverse = async () => {
    if (!reverseEventId) return
    try {
      await reverseCleaning(reverseEventId, reverseReason.trim() || null)
      toast(t.admin.apartments.reversed, 'success')
      setReverseEventId(null)
      setReverseReason('')
      setHistoryRefresh((k) => k + 1)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const handleRecalc = async () => {
    if (!recalcEventId) return
    try {
      const cleanedAt = recalcDate ? cairoLocalToISO(recalcDate) : null
      const staffIds = recalcStaffIds.length > 0 ? recalcStaffIds : null
      const leadStaffId = staffIds && staffIds.length > 0 ? staffIds[0] : null
      await recalculateCleaning(recalcEventId, cleanedAt, staffIds, leadStaffId)
      toast(t.admin.apartments.recalculate, 'success')
      setRecalcEventId(null)
      setRecalcDate('')
      setRecalcStaffIds([])
      setHistoryRefresh((k) => k + 1)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const close = () => navigate('/admin/apartments')

  const totalNorms = gaps.length
  const missingCount = gapItems.length
  const completenessPct = totalNorms > 0 ? Math.round(((totalNorms - missingCount) / totalNorms) * 100) : 100

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[60] anim-scrim" onClick={close} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-[440px] bg-surface z-[61] overflow-auto border-l border-line anim-drawer">
        {loading ? (
          <div className="p-6 text-center text-muted text-sm">{t.app.loading}</div>
        ) : loadError ? (
          <div className="p-6"><ErrorState onRetry={() => loadAll()} /></div>
        ) : !apartment ? (
          <div className="p-6 text-center text-muted text-sm">{t.common.notFound}</div>
        ) : (
          <div className="p-5 pb-8">
            <div className="flex items-center justify-between mb-4">
              <button onClick={close} className="bg-surface border border-line text-ink rounded-lg px-3 py-1.5 text-sm font-medium">
                {t.common.close}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-ink m-0">{apartment.code}</h2>
              {apartment.is_owner && <OwnerBadge />}
              <button
                onClick={() => setEditingApt(apartment)}
                className="ms-auto p-1.5 rounded-lg border border-line text-muted hover:text-accent flex items-center gap-1 text-xs"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {t.admin.apartments.edit}
              </button>
            </div>
            <p className="text-muted text-sm">{apartment.type}</p>

            {/* Completeness */}
            <div className="font-semibold text-sm text-ink mt-4 mb-2">{t.admin.apartments.completeness} {n(String(completenessPct))}%</div>
            <ProgressBar value={completenessPct} color={pctColor(completenessPct)} />

            {/* Gap list + issue all */}
            <div className="font-semibold text-sm text-ink mt-4 mb-2">{t.admin.apartments.gap}</div>
            {gapItems.length > 0 ? (
              <>
                <div className="bg-surface border border-line rounded-lg divide-y divide-[var(--line)]">
                  {gapItems.map((g) => (
                    <div key={`${g.item_id}`} className="px-3 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-ink">{cat.itemName(g.name)}</span>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-bad-soft text-bad">−{n(String(g.gap))}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleIssueAll}
                  disabled={issuing}
                  className="mt-3 bg-accent text-white rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
                >
                  {issuing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
                  {t.admin.apartments.issueAll}
                </button>
              </>
            ) : (
              <p className="text-muted text-sm">{t.common.fullyStocked}</p>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mt-5 border-b border-line overflow-x-auto">
              <TabButton active={tab === 'norms'} onClick={() => setTab('norms')} icon={ClipboardList} label={t.admin.apartments.norms} />
              <TabButton active={tab === 'rooms'} onClick={() => setTab('rooms')} icon={Boxes} label={t.rooms.tab} />
              <TabButton active={tab === 'cleaning'} onClick={() => setTab('cleaning')} icon={History} label={t.admin.apartments.cleaningHistory} />
              <TabButton active={tab === 'incidents'} onClick={() => setTab('incidents')} icon={Wrench} label={t.history.incidentsTab} />
            </div>

            {/* Norms tab */}
            {tab === 'norms' && (
              <NormsTab
                apartmentId={aptId}
                overrideNorms={overrideNorms}
                templateNorms={templateNorms}
                apartments={allApartments}
                onReload={() => loadAll({ silent: true })}
              />
            )}

            {/* Rooms tab */}
            {tab === 'rooms' && (
              <div className="mt-4">
                <RoomsPanel apartmentId={aptId} aptType={apartment.type} canEdit={true} totals={roomTotals} />
              </div>
            )}

            {/* Cleaning history tab */}
            {tab === 'cleaning' && (
              <div className="mt-4">
                <CleaningHistoryList
                  apartmentId={aptId}
                  canDelete={true}
                  onRecalculate={(eid) => setRecalcEventId(eid)}
                  onReverse={(eid) => setReverseEventId(eid)}
                  refreshKey={historyRefresh}
                />
              </div>
            )}

            {/* Incidents tab */}
            {tab === 'incidents' && (
              <div className="mt-4">
                <IncidentHistoryList apartmentId={aptId} canDelete={true} refreshKey={historyRefresh} />
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Issue result sheet */}
      {issueResult && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[70]" onClick={() => setIssueResult(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:anim-sheet">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-ink">{t.admin.apartments.issueAll}</h2>
              <button onClick={() => setIssueResult(null)} className="p-1">
                <X className="w-5 h-5 text-muted" />
              </button>
            </div>
            {issueResult.doc_number && (
              <p className="text-sm text-muted mb-3">{t.common.document}: {n(issueResult.doc_number)}</p>
            )}
            {issueResult.issued.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-medium text-ok mb-2">{t.admin.apartments.issued}</p>
                <div className="bg-ok-soft rounded-lg border border-line divide-y divide-[var(--line)]">
                  {issueResult.issued.map((it) => (
                    <div key={it.item_id} className="px-3 py-2 flex items-center justify-between">
                      <span className="text-sm text-ink">{cat.itemName(it.name)}</span>
                      <span className="text-sm text-ok">{n(String(it.qty))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {issueResult.short.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-bad mb-2">{t.admin.apartments.short}</p>
                <div className="bg-bad-soft rounded-lg border border-line divide-y divide-[var(--line)]">
                  {issueResult.short.map((it) => (
                    <div key={it.item_id} className="px-3 py-2 flex items-center justify-between">
                      <span className="text-sm text-ink">{cat.itemName(it.name)}</span>
                      <span className="text-sm text-bad">{n(String(it.issued))}/{n(String(it.need))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={() => setIssueResult(null)} className="w-full bg-app text-ink rounded-lg py-3 font-medium text-sm">
              {t.common.ok}
            </button>
          </div>
        </>
      )}

      {/* Reverse modal */}
      {reverseEventId && (
        <Modal title={t.admin.apartments.reverseConfirm} onClose={() => setReverseEventId(null)}>
          <input
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder={t.admin.apartments.reverseReason}
            className="w-full bg-app rounded-lg px-4 py-3 text-sm focus:outline-none mb-4"
          />
          <div className="flex gap-3">
            <button onClick={() => setReverseEventId(null)} className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm">
              {t.cleaning.cancel}
            </button>
            <button onClick={handleReverse} className="flex-1 bg-bad text-white rounded-lg py-3 font-medium text-sm">
              {t.admin.apartments.reverse}
            </button>
          </div>
        </Modal>
      )}

      {/* Recalc modal */}
      {recalcEventId && (
        <Modal title={t.admin.apartments.recalcConfirm} onClose={() => { setRecalcEventId(null); setRecalcDate(''); setRecalcStaffIds([]) }}>
          <p className="text-xs text-warn bg-warn-soft rounded-lg px-3 py-2 mb-3">{t.admin.apartments.recalcWarn}</p>
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-sm text-muted mb-1">{t.admin.apartments.recalcDate}</label>
              <input
                type="datetime-local"
                value={recalcDate}
                onChange={(e) => setRecalcDate(e.target.value)}
                className="w-full bg-app rounded-lg px-4 py-2.5 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">{t.admin.apartments.recalcStaff}</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {staffList.filter((s) => s.active).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 bg-app rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recalcStaffIds.includes(s.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRecalcStaffIds((prev) => [...prev, s.id])
                        } else {
                          setRecalcStaffIds((prev) => prev.filter((id) => id !== s.id))
                        }
                      }}
                      className="w-4 h-4 accent-[var(--accent)]"
                    />
                    <span className="text-sm text-ink">
                      {s.full_name}
                      {recalcStaffIds[0] === s.id && ` ${t.admin.apartments.recalcLead}`}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setRecalcEventId(null); setRecalcDate(''); setRecalcStaffIds([]) }} className="flex-1 bg-app text-ink rounded-lg py-3 font-medium text-sm">
              {t.cleaning.cancel}
            </button>
            <button onClick={handleRecalc} className="flex-1 bg-accent text-white rounded-lg py-3 font-medium text-sm">
              {t.admin.apartments.recalculate}
            </button>
          </div>
        </Modal>
      )}

      {editingApt && (
        <EditApartmentModal
          apartment={editingApt}
          buildings={buildings}
          typeLabels={{
            studio: t.apartments.typeStudio,
            '1br': t.apartments.type1br,
            '2br': t.apartments.type2br,
          }}
          onClose={() => setEditingApt(null)}
          onSaved={() => { setEditingApt(null); loadAll({ silent: true }) }}
        />
      )}
    </>
  )
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${active ? 'border-accent text-accent font-medium' : 'border-transparent text-muted'}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
        <h3 className="text-base font-semibold text-ink mb-4">{title}</h3>
        {children}
      </div>
    </>
  )
}
