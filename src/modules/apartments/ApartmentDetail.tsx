import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchApartmentById, fetchNorms, fetchNotes, addNote } from '@/modules/apartments/api'
import type { SvApartment, SvNorm, ApartmentNote, NormType } from '@/lib/database.types'
import { useAuth } from '@/modules/core/store'
import { useI18n } from '@/i18n'
import { formatDateTime, isToday, formatQty } from '@/lib/format'
import { toast } from '@/lib/toast'
import { ArrowLeft, Wrench, Sparkles, ClipboardList, Send, CircleCheck as CheckCircle2, History, Boxes } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { CleaningHistoryList } from '@/modules/history/CleaningHistoryList'
import { IncidentHistoryList } from '@/modules/history/IncidentHistoryList'
import { useLiveRefresh } from '@/lib/realtime'
import { RoomsPanel } from '@/modules/rooms/RoomsPanel'
import { OwnerBadge } from '@/components/OwnerBadge'

type Tab = 'norms' | 'rooms' | 'comments' | 'cleaning' | 'incidents'

const normTypeOrder: NormType[] = ['asset_standing', 'turnover_replenish', 'cleaning_consumption']

export function ApartmentDetail() {
  const { t, n } = useI18n()
  const normTypeLabels: Record<NormType, string> = {
    asset_standing: t.apartments.normInventory,
    turnover_replenish: t.apartments.normTurnover,
    cleaning_consumption: t.apartments.normCleaning,
  }
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile = useAuth((s) => s.profile)
  const aptId = Number(id)
  const [apartment, setApartment] = useState<SvApartment | null>(null)
  const [norms, setNorms] = useState<SvNorm[]>([])
  const [notes, setNotes] = useState<ApartmentNote[]>([])
  const [tab, setTab] = useState<Tab>('norms')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [sendingNote, setSendingNote] = useState(false)

  const loadAll = (silent?: boolean) => {
    if (!aptId || !profile) return
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    Promise.all([fetchApartmentById(aptId), fetchNorms(profile.id, aptId), fetchNotes(aptId)])
      .then(([a, n, no]) => { setApartment(a); setNorms(n); setNotes(no) })
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aptId, profile?.id])
  useLiveRefresh(['apartments', 'apartment_notes', 'norm_rules', 'items', 'cleaning_events'], () => loadAll(true))

  const groupedNorms = useMemo(() => {
    const map = new Map<NormType, SvNorm[]>()
    for (const nr of norms) {
      if (nr.qty <= 0) continue
      const list = map.get(nr.norm_type) ?? []
      list.push(nr)
      map.set(nr.norm_type, list)
    }
    return map
  }, [norms])

  const visibleNormCount = useMemo(() => norms.filter((nr) => nr.qty > 0).length, [norms])

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setSendingNote(true)
    try {
      await addNote(aptId, noteText.trim())
      setNoteText('')
      setNotes(await fetchNotes(aptId))
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setSendingNote(false)
    }
  }

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (loadError) return <ErrorState onRetry={loadAll} />
  if (!apartment) return <div className="px-4 pt-8 text-center text-muted">{t.common.notFound}</div>

  return (
    <div className="min-h-screen bg-app">
      <div className="bg-surface border-b border-line sticky top-11 z-30">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/sv')} className="p-1 -ml-1">
            <ArrowLeft className="w-5 h-5 text-muted" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-ink">{apartment.code}</h1>
            {apartment.is_owner && <OwnerBadge />}
            <p className="text-xs text-muted">{apartment.building}</p>
          </div>
          <span className="text-xs text-muted">
            {apartment.last_cleaned_at
              ? isToday(apartment.last_cleaned_at)
                ? t.apartments.cleanedToday
                : `${t.apartments.lastCleaned}: ${n(formatDateTime(apartment.last_cleaned_at))}`
              : t.apartments.noCleaning}
          </span>
        </div>
        <div className="flex px-4 gap-1 overflow-x-auto">
          <TabButton active={tab === 'norms'} onClick={() => setTab('norms')} icon={ClipboardList} label={t.apartments.norms} />
          <TabButton active={tab === 'rooms'} onClick={() => setTab('rooms')} icon={Boxes} label={t.rooms.tab} />
          <TabButton active={tab === 'comments'} onClick={() => setTab('comments')} icon={Sparkles} label={t.apartments.comments} />
          <TabButton active={tab === 'cleaning'} onClick={() => setTab('cleaning')} icon={History} label={t.admin.apartments.cleaningHistory} />
          <TabButton active={tab === 'incidents'} onClick={() => setTab('incidents')} icon={Wrench} label={t.history.incidentsTab} />
        </div>
      </div>

      <div className="px-4 pt-4 pb-[calc(12rem+env(safe-area-inset-bottom,0px))]">
        {tab === 'norms' && (
          <div className="space-y-5">
            {visibleNormCount === 0 && <p className="text-sm text-muted text-center mt-8">{t.apartments.noNorms}</p>}
            {normTypeOrder.map((nt) => {
              const items = groupedNorms.get(nt)
              if (!items || items.length === 0) return null
              return (
                <div key={nt}>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{normTypeLabels[nt]}</h3>
                  <div className="bg-surface rounded-xl border border-line divide-y divide-[var(--line)]">
                    {items.map((nr) => (
                      <div key={`${nr.item_id}-${nr.norm_type}`} className="px-4 py-3 flex items-center justify-between">
                        <span className="text-sm text-ink">{nr.item_name}</span>
                        <span className="text-sm text-muted">
                          {n(formatQty(nr.qty, { base_unit: nr.base_unit, pack_size: nr.pack_size, pack_label: nr.pack_label }))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'rooms' && (
          <RoomsPanel apartmentId={aptId} aptType={apartment.type} canEdit={false} />
        )}

        {tab === 'comments' && (
          <div className="space-y-3">
            {notes.length === 0 && <p className="text-sm text-muted text-center mt-8">{t.apartments.noComments}</p>}
            {notes.map((note) => (
              <div key={note.id} className="bg-surface rounded-xl border border-line px-4 py-3">
                <p className="text-sm text-ink">{note.body}</p>
                <p className="text-xs text-muted mt-1.5">{n(formatDateTime(note.created_at))}</p>
              </div>
            ))}
            <div className="fixed bottom-[7.5rem] left-0 right-0 z-10 bg-surface/95 backdrop-blur border-t border-line px-4 py-3">
              <div className="max-w-lg mx-auto flex gap-2">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={t.apartments.commentPlaceholder}
                  className="flex-1 min-w-0 bg-app rounded-xl px-4 py-2.5 text-sm border border-line focus:border-accent focus:outline-none"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !sendingNote) handleAddNote() }}
                />
                <button onClick={handleAddNote} aria-label={t.qr.send} disabled={sendingNote || !noteText.trim()} className="bg-accent text-white rounded-xl min-w-[44px] min-h-[44px] px-4 py-2.5 flex items-center justify-center disabled:opacity-40">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'cleaning' && (
          <CleaningHistoryList apartmentId={aptId} canDelete={false} />
        )}

        {tab === 'incidents' && (
          <IncidentHistoryList apartmentId={aptId} canDelete={false} />
        )}
      </div>

      <div className="fixed bottom-16 left-0 right-0 z-20 bg-surface/95 backdrop-blur border-t border-line px-4 pt-3 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="max-w-lg mx-auto grid grid-cols-2 gap-2">
          <button
            onClick={() => navigate(`/sv/apartments/${aptId}/clean`)}
            className="min-h-[48px] bg-accent text-white rounded-xl px-2 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
          >
            <CheckCircle2 className="w-5 h-5" />
            {t.apartments.cleaned}
          </button>
          <button
            onClick={() => navigate(`/sv/incidents/new?apt=${aptId}`)}
            className="min-h-[48px] bg-surface border border-line text-ink rounded-xl px-2 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors hover:bg-app"
          >
            <Wrench className="w-5 h-5" />
            {t.apartments.reportBreakdown}
          </button>
        </div>
      </div>
    </div>
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
