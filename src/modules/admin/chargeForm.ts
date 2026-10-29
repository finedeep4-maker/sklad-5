import type { IncidentChargePreview, IncidentKind } from '@/lib/database.types'

export interface ChargeFormState {
  billable: boolean
  tenantNote: string
  baseCost: string
  coef: string
  baseCostDirty: boolean
  coefDirty: boolean
}

const BILLABLE_KINDS: IncidentKind[] = ['lost', 'broken', 'damaged']

export function defaultBillable(kind: IncidentKind): boolean {
  return BILLABLE_KINDS.includes(kind)
}

export function initChargeState(kind: IncidentKind): ChargeFormState {
  return {
    billable: defaultBillable(kind),
    tenantNote: '',
    baseCost: '',
    coef: '',
    baseCostDirty: false,
    coefDirty: false,
  }
}

export function applyPreview(state: ChargeFormState, preview: IncidentChargePreview | null): ChargeFormState {
  if (!preview) return state
  // значения, которые админ уже ввёл руками, превью не перезаписывает
  return {
    ...state,
    baseCost: state.baseCostDirty ? state.baseCost : (preview.base_cost != null ? String(preview.base_cost) : ''),
    coef: state.coefDirty ? state.coef : (preview.coef != null ? String(preview.coef) : ''),
  }
}

export interface ChargePayload {
  tenant_note: string | null
  base_cost?: number
  coef?: number
}

export function buildChargePayload(state: ChargeFormState): ChargePayload | null {
  if (!state.billable) return null
  const payload: ChargePayload = {
    tenant_note: state.tenantNote.trim() || null,
  }
  if (state.baseCostDirty) {
    const v = Number(state.baseCost)
    if (!isNaN(v) && v >= 0) payload.base_cost = v
  }
  if (state.coefDirty) {
    const v = Number(state.coef)
    if (!isNaN(v) && v > 0) payload.coef = v
  }
  return payload
}

export function canSubmit(state: ChargeFormState, hasItem: boolean): boolean {
  if (!state.billable) return true
  const baseCostNum = Number(state.baseCost)
  const coefNum = Number(state.coef)
  const baseCostValid = !isNaN(baseCostNum) && baseCostNum >= 0 && state.baseCost !== ''
  const coefValid = !isNaN(coefNum) && coefNum > 0 && state.coef !== ''
  if (!hasItem) {
    return baseCostValid && coefValid
  }
  return baseCostValid && coefValid
}

export function computeAmount(state: ChargeFormState, qty: number): number | null {
  const baseCostNum = Number(state.baseCost)
  const coefNum = Number(state.coef)
  if (state.baseCost === '' || state.coef === '' || isNaN(baseCostNum) || isNaN(coefNum) || coefNum <= 0 || baseCostNum < 0) return null
  return Math.round(qty * baseCostNum * coefNum * 100) / 100
}
