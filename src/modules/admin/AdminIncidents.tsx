import { useState, useEffect, useMemo } from 'react'
import { fetchAllIncidents, approveIncident, takeIncident, fetchIncidentChargePreview, fetchIncidentCharges, setIncidentChargeStatus } from '@/modules/admin/api'
import { fetchApartmentsAdmin, fetchItems } from '@/modules/admin/api'
import type { Incident, Apartment, IncidentStatus, IncidentKind, IncidentCharge, IncidentChargePreview, ChargeStatus } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatDateTime, formatEGP } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { Wrench, Package, CircleAlert as AlertCircle, Check, X, Loader as Loader2, ChevronRight, Image as ImageIcon, Receipt, Info } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { IncidentDetailModal, fetchProfileName } from '@/modules/incidents/IncidentDetailModal'
import { useLiveRefresh } from '@/lib/realtime'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  initChargeState, applyPreview, buildChargePayload, canSubmit, computeAmount,
  type ChargeFormState,
} from '@/modules/admin/chargeForm'

const statusColors: Record<IncidentStatus, string> = {
  new: 'bg-warn-soft text-warn',
  in_progress: 'bg-accent-soft text-accent',
  confirmed: 'bg-ok-soft text-ok',
  rejected: 'bg-bad-soft text-bad',
}

const kindIcons: Record<IncidentKind, React.ComponentType<{ className?: string }>> = {
  breakdown: Wrench,
  broken: AlertCircle,
  damaged: AlertCircle,
  lost: Package,
  other: AlertCircle,
}

export function AdminIncidents() {
  const { t, n } = useI18n()
  const statusLabels: Record<IncidentStatus, string> = {
    new: t.incidents.statusNew,
    in_progress: t.incidents.statusInProgress,
    confirmed: t.incidents.statusConfirmed,
    rejected: t.incidents.statusRejected,
  }
  const kindLabels: Record<IncidentKind, string> = {
    breakdown: t.incidents.kindBreakdown,
    broken: t.incidents.kindBroken,
    damaged: t.incidents.kindDamaged,
    lost: t.incidents.kindLost,
    other: t.incidents.kindOther,
  }
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [charges, setCharges] = useState<Map<string, IncidentCharge>>(new Map())
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [itemNames, setItemNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionIncident, setActionIncident] = useState<{ incident: Incident; decision: 'confirm' | 'reject' } | null>(null)
  const [note, setNote] = useState('')
  const [force, setForce] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [takingId, setTakingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Incident | null>(null)
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [resolverName, setResolverName] = useState<string | null>(null)
  const [chargeState, setChargeState] = useState<ChargeFormState | null>(null)
  const [chargePreview, setChargePreview] = useState<IncidentChargePreview | null>(null)
  const [chargeLoading, setChargeLoading] = useState(false)
  const [chargeError, setChargeError] = useState<string | null>(null)
  const [statusDialog, setStatusDialog] = useState<{ incidentId: string; toStatus: ChargeStatus } | null>(null)
  const [statusProcessing, setStatusProcessing] = useState(false)

  const load = (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    Promise.all([fetchAllIncidents(), fetchApartmentsAdmin(), fetchItems()])
      .then(([inc, apts, items]) => {
        setIncidents(inc)
        setApartments(apts)
        setItemNames(new Map(items.map((i) => [i.id, i.name])))
      })
      .catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) })
      .finally(() => { if (!quiet) setLoading(false) })
    fetchIncidentCharges()
      .then((chs) => setCharges(new Map(chs.map((c) => [c.incident_id, c]))))
      .catch(() => { if (!quiet) toast(t.admin.adminIncidents.chargesLoadError, 'error') })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLiveRefresh(['incidents', 'apartments'], () => load(true))

  const aptMap = useMemo(() => new Map(apartments.map((a) => [a.id, a.code])), [apartments])

  useEffect(() => {
    if (!selected) return
    setAuthorName(null)
    setResolverName(null)
    if (selected.created_by) fetchProfileName(selected.created_by).then(setAuthorName)
    if (selected.resolved_by) fetchProfileName(selected.resolved_by).then(setResolverName)
  }, [selected])

  // Fetch charge preview when confirm dialog opens
  useEffect(() => {
    if (!actionIncident || actionIncident.decision !== 'confirm') {
      setChargeState(null)
      setChargePreview(null)
      setChargeError(null)
      setChargeLoading(false)
      return
    }
    let cancelled = false
    const inc = actionIncident.incident
    const state = initChargeState(inc.kind)
    setChargeState(state)
    setChargePreview(null)
    setChargeError(null)
    if (!inc.item_id) return
    setChargeLoading(true)
    fetchIncidentChargePreview(inc.id)
      .then((preview) => {
        if (cancelled) return
        setChargePreview(preview)
        setChargeState((prev) => (prev ? applyPreview(prev, preview) : prev))
      })
      .catch((e) => { if (!cancelled) setChargeError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setChargeLoading(false) })
    // ответ по закрытой или другой заявке не должен попадать в текущий диалог
    return () => { cancelled = true }
  }, [actionIncident])

  const handleAction = async () => {
    if (!actionIncident) return
    setProcessing(true)
    try {
      const charge = chargeState?.billable
        ? buildChargePayload(chargeState)
        : null
      await approveIncident(
        actionIncident.incident.id,
        actionIncident.decision,
        note.trim() || null,
        force,
        charge,
      )
      toast(actionIncident.decision === 'confirm' ? t.admin.adminIncidents.approved : t.admin.adminIncidents.rejected, 'success')
      setActionIncident(null)
      setNote('')
      setForce(false)
      const [inc] = await Promise.all([fetchAllIncidents()])
      setIncidents(inc)
      try {
        const chs = await fetchIncidentCharges()
        setCharges(new Map(chs.map((c) => [c.incident_id, c])))
      } catch { /* charges load error already toasted */ }
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setProcessing(false)
    }
  }

  const handleTake = async (id: string) => {
    setTakingId(id)
    try {
      await takeIncident(id)
      toast(t.admin.adminIncidents.taken, 'success')
      setIncidents(await fetchAllIncidents())
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setTakingId(null)
    }
  }

  const handleStatusChange = async () => {
    if (!statusDialog) return
    setStatusProcessing(true)
    try {
      await setIncidentChargeStatus(statusDialog.incidentId, statusDialog.toStatus)
      const chs = await fetchIncidentCharges()
      setCharges(new Map(chs.map((c) => [c.incident_id, c])))
      toast(t.common.saved, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setStatusProcessing(false)
      setStatusDialog(null)
    }
  }

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (loadError) return <ErrorState onRetry={load} />

  const hasItem = actionIncident?.incident.item_id != null
  const amount = chargeState && actionIncident ? computeAmount(chargeState, actionIncident.incident.qty) : null
  const submitReady = chargeState ? canSubmit(chargeState, hasItem) : true
  const confirmLabel = chargeState?.billable && amount != null
    ? t.admin.adminIncidents.confirmAndCharge.replace('{amount}', formatEGP(amount))
    : t.admin.adminIncidents.confirmNoCharge

  const disableReason = (() => {
    if (processing) return null
    if (!chargeState || !chargeState.billable) return null
    const baseCostNum = Number(chargeState.baseCost)
    const coefNum = Number(chargeState.coef)
    if (chargeState.baseCost === '' || isNaN(baseCostNum) || baseCostNum < 0) return t.admin.adminIncidents.chargeRequiredBaseCost
    if (chargeState.coef === '' || isNaN(coefNum) || coefNum <= 0) return t.admin.adminIncidents.chargeRequiredCoef
    return null
  })()

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.adminIncidents.title}</h1>

      {incidents.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.adminIncidents.noIncidents}</p>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => {
            const Icon = kindIcons[inc.kind]
            const hasPhotos = inc.photo_paths.length > 0
            const charge = charges.get(inc.id)
            return (
              <div key={inc.id} className="bg-surface rounded-xl border border-line px-4 py-3">
                <button
                  onClick={() => setSelected(inc)}
                  className="w-full text-start"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-app rounded-lg flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-ink">{aptMap.get(inc.apartment_id) ?? `#${n(String(inc.apartment_id))}`}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[inc.status]}`}>{statusLabels[inc.status]}</span>
                      </div>
                      <p className="text-sm text-ink line-clamp-2">{inc.free_text ?? (inc.item_id != null ? (itemNames.get(inc.item_id) ?? `#${n(String(inc.item_id))}`) : '—')}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted">{kindLabels[inc.kind]}</span>
                        <span className="text-xs text-muted">·</span>
                        <span className="text-xs text-muted">{n(String(inc.qty))} {t.common.units.pcs}</span>
                        <span className="text-xs text-muted">·</span>
                        <span className="text-xs text-muted">{n(formatDateTime(inc.created_at))}</span>
                      </div>
                      {inc.comment && <p className="text-xs text-muted mt-1.5 bg-app rounded-lg px-2.5 py-1.5 line-clamp-2">{inc.comment}</p>}
                      {hasPhotos && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted">
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>{inc.photo_paths.length}</span>
                        </div>
                      )}
                      {inc.resolution_note && <p className="text-xs text-muted mt-1 line-clamp-1">{inc.resolution_note}</p>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted shrink-0 mt-1" />
                  </div>
                </button>

                {/* Charge row for confirmed incidents */}
                {charge && (
                  <div className="mt-2 ps-12">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${charge.status === 'pending' ? 'bg-warn-soft text-warn' : charge.status === 'paid' ? 'bg-ok-soft text-ok' : 'bg-app text-muted'}`}>
                        {charge.status === 'pending'
                          ? `${t.admin.adminIncidents.chargePending} ${formatEGP(charge.amount)}`
                          : charge.status === 'paid'
                            ? t.admin.adminIncidents.chargePaid
                            : t.admin.adminIncidents.chargeWaived}
                      </span>
                      {charge.tenant_note && <span className="text-xs text-muted">{charge.tenant_note}</span>}
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      {charge.status === 'pending' && (
                        <>
                          <button
                            onClick={() => setStatusDialog({ incidentId: inc.id, toStatus: 'paid' })}
                            className="text-xs bg-ok-soft text-ok rounded-lg px-3 py-1.5"
                          >
                            {t.admin.adminIncidents.chargeMarkPaid}
                          </button>
                          <button
                            onClick={() => setStatusDialog({ incidentId: inc.id, toStatus: 'waived' })}
                            className="text-xs bg-app text-muted rounded-lg px-3 py-1.5"
                          >
                            {t.admin.adminIncidents.chargeMarkWaived}
                          </button>
                        </>
                      )}
                      {charge.status !== 'pending' && (
                        <button
                          onClick={() => setStatusDialog({ incidentId: inc.id, toStatus: 'pending' })}
                          className="text-xs bg-warn-soft text-warn rounded-lg px-3 py-1.5"
                        >
                          {t.admin.adminIncidents.chargeMarkPending}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {(inc.status === 'new' || inc.status === 'in_progress') && (
                  <div className="flex gap-2 mt-2 ps-12">
                    {inc.status === 'new' && (
                      <button
                        onClick={() => handleTake(inc.id)}
                        disabled={takingId === inc.id}
                        className="text-xs bg-accent-soft text-accent rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {takingId === inc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        {t.admin.adminIncidents.take}
                      </button>
                    )}
                    <button
                      onClick={() => { setActionIncident({ incident: inc, decision: 'confirm' }); setNote(''); setForce(false) }}
                      className="text-xs bg-ok-soft text-ok rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <Check className="w-3 h-3" />
                      {t.admin.adminIncidents.confirm}
                    </button>
                    <button
                      onClick={() => { setActionIncident({ incident: inc, decision: 'reject' }); setNote(''); setForce(false) }}
                      className="text-xs bg-bad-soft text-bad rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <X className="w-3 h-3" />
                      {t.admin.adminIncidents.reject}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {selected && (
        <IncidentDetailModal
          incident={selected}
          apartmentCode={aptMap.get(selected.apartment_id)}
          authorName={authorName}
          resolverName={resolverName}
          onClose={() => setSelected(null)}
        />
      )}

      {actionIncident && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6" onClick={() => !processing && setActionIncident(null)}>
          <div className="bg-surface border border-line rounded-2xl w-full max-w-sm p-5 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ink mb-4">
              {actionIncident.decision === 'confirm' ? t.admin.adminIncidents.confirmTitle : t.admin.adminIncidents.rejectTitle}
            </h3>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.admin.adminIncidents.note}
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none mb-3"
            />
            {actionIncident.decision === 'confirm' && actionIncident.incident.item_id && (
              <label className="flex items-center gap-2 mb-3">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="w-4 h-4" />
                <span className="text-sm text-ink">{t.admin.adminIncidents.force}</span>
              </label>
            )}

            {/* Charge block — only for confirm */}
            {actionIncident.decision === 'confirm' && chargeState && (
              <div className="mb-4 border border-line rounded-xl p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-muted" />
                  <span className="text-sm font-medium text-ink">{t.admin.adminIncidents.chargeTitle}</span>
                </div>

                {/* Billable toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chargeState.billable}
                    onChange={(e) => setChargeState({ ...chargeState, billable: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-ink">{t.admin.adminIncidents.billTenant}</span>
                </label>

                {chargeState.billable && (
                  <>
                    {chargeLoading && (
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t.admin.adminIncidents.chargeLoading}
                      </div>
                    )}
                    {chargeError && !chargeLoading && (
                      <p className="text-xs text-bad">{chargeError}</p>
                    )}
                    {!hasItem && (
                      <div className="flex items-start gap-2 bg-warn-soft text-warn rounded-lg px-3 py-2 text-xs">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{t.admin.adminIncidents.chargeNoItem}</span>
                      </div>
                    )}

                    {/* Tenant note */}
                    <div>
                      <label className="block text-xs text-muted mb-1">{t.admin.adminIncidents.tenant}</label>
                      <input
                        value={chargeState.tenantNote}
                        onChange={(e) => setChargeState({ ...chargeState, tenantNote: e.target.value.slice(0, 200) })}
                        placeholder={t.admin.adminIncidents.tenantHint}
                        className="w-full bg-app rounded-lg px-3 py-2 text-sm focus:outline-none"
                      />
                    </div>

                    {/* Base cost */}
                    <div>
                      <label className="block text-xs text-muted mb-1">{t.admin.adminIncidents.baseCost}</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={chargeState.baseCost}
                        onChange={(e) => setChargeState({ ...chargeState, baseCost: e.target.value, baseCostDirty: true })}
                        className="w-full bg-app rounded-lg px-3 py-2 text-sm focus:outline-none"
                      />
                      <p className="text-xs text-muted mt-0.5">
                        {chargeState.baseCostDirty
                          ? t.admin.adminIncidents.baseCostManual
                          : chargePreview?.base_source === 'owner'
                            ? t.admin.adminIncidents.baseCostOwner
                            : chargePreview?.base_source === 'company'
                              ? t.admin.adminIncidents.baseCostCompany
                              : t.admin.adminIncidents.baseCostManual}
                      </p>
                    </div>

                    {/* Coefficient */}
                    <div>
                      <label className="block text-xs text-muted mb-1">{t.admin.adminIncidents.coef}</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={chargeState.coef}
                        onChange={(e) => setChargeState({ ...chargeState, coef: e.target.value, coefDirty: true })}
                        className={`w-full bg-app rounded-lg px-3 py-2 text-sm focus:outline-none ${chargeState.coef === '' || Number(chargeState.coef) <= 0 ? 'border border-bad' : ''}`}
                      />
                      <p className={`text-xs mt-0.5 ${chargeState.coef === '' || Number(chargeState.coef) <= 0 ? 'text-bad' : 'text-muted'}`}>
                        {chargeState.coef === '' || Number(chargeState.coef) <= 0
                          ? t.admin.adminIncidents.coefMissing
                          : chargeState.coefDirty
                            ? t.admin.adminIncidents.baseCostManual
                            : chargePreview?.coef_source === 'item'
                              ? t.admin.adminIncidents.coefFromItem
                              : chargePreview?.coef_source === 'category'
                                ? t.admin.adminIncidents.coefFromCategory
                                : t.admin.adminIncidents.coefMissing}
                      </p>
                    </div>

                    {/* Amount preview */}
                    <div className="bg-app rounded-lg px-3 py-2">
                      <span className="text-xs text-muted">{t.admin.adminIncidents.amount}: </span>
                      {amount != null ? (
                        <span className="text-sm font-semibold text-ink">
                          {n(String(actionIncident.incident.qty))} × {chargeState.baseCost} × {chargeState.coef} = {formatEGP(amount)}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setActionIncident(null)} disabled={processing} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium disabled:opacity-40">
                {t.cleaning.cancel}
              </button>
              <button
                onClick={handleAction}
                disabled={processing || (actionIncident.decision === 'confirm' && !submitReady)}
                className={`flex-1 text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2 ${actionIncident.decision === 'confirm' ? 'bg-ok' : 'bg-bad'}`}
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {actionIncident.decision === 'confirm' ? confirmLabel : t.admin.adminIncidents.reject}
              </button>
            </div>
            {disableReason && (
              <p className="text-xs text-bad text-center mt-2">{disableReason}</p>
            )}
          </div>
        </div>
      )}

      {/* Charge status change dialog */}
      {statusDialog && (
        <ConfirmDialog
          open={true}
          title={t.admin.adminIncidents.chargeStatusTitle}
          message={
            statusDialog.toStatus === 'paid' ? t.admin.adminIncidents.chargeConfirmPaid
              : statusDialog.toStatus === 'waived' ? t.admin.adminIncidents.chargeConfirmWaived
                : t.admin.adminIncidents.chargeConfirmPending
          }
          confirmLabel={
            statusDialog.toStatus === 'paid' ? t.admin.adminIncidents.chargeMarkPaid
              : statusDialog.toStatus === 'waived' ? t.admin.adminIncidents.chargeMarkWaived
                : t.admin.adminIncidents.chargeMarkPending
          }
          tone={statusDialog.toStatus === 'waived' ? 'bad' : 'warn'}
          onConfirm={handleStatusChange}
          onCancel={() => !statusProcessing && setStatusDialog(null)}
        />
      )}

      {/* Overlay for status processing */}
      {statusProcessing && (
        <div className="fixed inset-0 bg-black/30 z-[71] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-white animate-spin" />
        </div>
      )}
    </div>
  )
}
