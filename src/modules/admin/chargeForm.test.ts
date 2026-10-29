import { describe, it, expect } from 'vitest'
import {
  defaultBillable,
  buildChargePayload,
  canSubmit,
  computeAmount,
  initChargeState,
  applyPreview,
  type ChargeFormState,
} from './chargeForm'
import type { IncidentChargePreview } from '@/lib/database.types'

describe('defaultBillable', () => {
  it('returns true for lost', () => {
    expect(defaultBillable('lost')).toBe(true)
  })
  it('returns true for broken', () => {
    expect(defaultBillable('broken')).toBe(true)
  })
  it('returns true for damaged', () => {
    expect(defaultBillable('damaged')).toBe(true)
  })
  it('returns false for breakdown', () => {
    expect(defaultBillable('breakdown')).toBe(false)
  })
  it('returns false for other', () => {
    expect(defaultBillable('other')).toBe(false)
  })
})

describe('buildChargePayload', () => {
  const preview: IncidentChargePreview = {
    qty: 1,
    item_id: 10,
    base_cost: 100,
    base_source: 'company',
    coef: 1.5,
    coef_source: 'item',
  }

  it('returns null when billable is off', () => {
    const state: ChargeFormState = { ...initChargeState('lost'), billable: false }
    expect(buildChargePayload(state)).toBeNull()
  })

  it('sends only tenant_note when nothing was edited', () => {
    const state = applyPreview(initChargeState('lost'), preview)
    state.tenantNote = 'John'
    const payload = buildChargePayload(state)
    expect(payload).toEqual({ tenant_note: 'John' })
  })

  it('sends base_cost when admin edited it', () => {
    const state = applyPreview(initChargeState('lost'), preview)
    state.baseCost = '200'
    state.baseCostDirty = true
    const payload = buildChargePayload(state)
    expect(payload).toEqual({ tenant_note: null, base_cost: 200 })
  })

  it('sends coef when admin edited it', () => {
    const state = applyPreview(initChargeState('lost'), preview)
    state.coef = '2'
    state.coefDirty = true
    const payload = buildChargePayload(state)
    expect(payload).toEqual({ tenant_note: null, coef: 2 })
  })

  it('sends both when both edited', () => {
    const state = applyPreview(initChargeState('lost'), preview)
    state.baseCost = '50'
    state.coef = '3'
    state.baseCostDirty = true
    state.coefDirty = true
    const payload = buildChargePayload(state)
    expect(payload).toEqual({ tenant_note: null, base_cost: 50, coef: 3 })
  })

  it('trims tenant_note to null when empty', () => {
    const state = applyPreview(initChargeState('lost'), preview)
    state.tenantNote = '   '
    const payload = buildChargePayload(state)
    expect(payload).toEqual({ tenant_note: null })
  })
})

describe('canSubmit', () => {
  it('returns true when billable is off', () => {
    const state: ChargeFormState = { ...initChargeState('breakdown'), billable: false }
    expect(canSubmit(state, true)).toBe(true)
  })

  it('returns true when both fields filled for item incident', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '100',
      coef: '1.5',
    }
    expect(canSubmit(state, true)).toBe(true)
  })

  it('returns false when coef is missing', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '100',
      coef: '',
    }
    expect(canSubmit(state, true)).toBe(false)
  })

  it('returns false when baseCost is missing for no-item incident', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '',
      coef: '1.5',
    }
    expect(canSubmit(state, false)).toBe(false)
  })

  it('returns false when coef is 0 or negative', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '100',
      coef: '0',
    }
    expect(canSubmit(state, true)).toBe(false)
  })

  it('returns false when baseCost is negative', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '-1',
      coef: '1.5',
    }
    expect(canSubmit(state, true)).toBe(false)
  })

  it('returns true for no-item incident when both filled manually', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '200',
      coef: '2',
    }
    expect(canSubmit(state, false)).toBe(true)
  })
})

describe('computeAmount', () => {
  it('computes qty × baseCost × coef rounded to 2 decimals', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '100',
      coef: '1.5',
    }
    expect(computeAmount(state, 2)).toBe(300)
  })

  it('returns null when baseCost is empty', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '',
      coef: '1.5',
    }
    expect(computeAmount(state, 1)).toBeNull()
  })

  it('returns null when coef is empty', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '100',
      coef: '',
    }
    expect(computeAmount(state, 1)).toBeNull()
  })

  it('returns null when coef is 0', () => {
    const state: ChargeFormState = {
      ...initChargeState('lost'),
      billable: true,
      baseCost: '100',
      coef: '0',
    }
    expect(computeAmount(state, 1)).toBeNull()
  })
})

describe('applyPreview keeps manual input', () => {
  const preview = { qty: 1, item_id: 5, base_cost: 100, base_source: 'company' as const, coef: 1.5, coef_source: 'item' as const }

  it('does not overwrite a manually entered base cost', () => {
    const state = { ...initChargeState('lost'), baseCost: '77', baseCostDirty: true }
    const next = applyPreview(state, preview)
    expect(next.baseCost).toBe('77')
    expect(next.coef).toBe('1.5')
  })

  it('does not overwrite a manually entered coefficient', () => {
    const state = { ...initChargeState('lost'), coef: '2', coefDirty: true }
    const next = applyPreview(state, preview)
    expect(next.coef).toBe('2')
    expect(next.baseCost).toBe('100')
  })

  it('keeps the billable toggle chosen by the admin', () => {
    const state = { ...initChargeState('lost'), billable: false }
    expect(applyPreview(state, preview).billable).toBe(false)
  })
})
