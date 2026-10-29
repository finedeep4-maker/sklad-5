import { describe, it, expect } from 'vitest'
import {
  filterByOwnership,
  groupExpense,
  chargesTotals,
  ownershipLabel,
} from './reportRules'
import type { ReportStockMoveRow, ChargeStatus } from '@/lib/database.types'

function move(partial: Partial<ReportStockMoveRow>): ReportStockMoveRow {
  return {
    id: 1,
    item_id: 1,
    item_name: 'Towel',
    category: 'Linen',
    pack_size: 1,
    pack_label: 'pcs',
    qty: 2,
    unit_cost: 10,
    source_type: 'cleaning',
    apartment_id: 5,
    apartment_code: 'B1/101',
    sink_flow: 1,
    moved_at: '2026-10-27T10:00:00Z',
    owner_apartment_id: null,
    owner_code: null,
    ...partial,
  }
}

describe('filterByOwnership', () => {
  it('company filter excludes owner moves', () => {
    const rows = [move({}), move({ owner_apartment_id: 3, owner_code: 'B1/200' })]
    expect(filterByOwnership(rows, 'company')).toHaveLength(1)
    expect(filterByOwnership(rows, 'company')[0].owner_apartment_id).toBeNull()
  })
  it('owner filter excludes company moves', () => {
    const rows = [move({}), move({ owner_apartment_id: 3, owner_code: 'B1/200' })]
    expect(filterByOwnership(rows, 'owner')).toHaveLength(1)
    expect(filterByOwnership(rows, 'owner')[0].owner_apartment_id).toBe(3)
  })
  it('all filter returns everything', () => {
    const rows = [move({}), move({ owner_apartment_id: 3, owner_code: 'B1/200' })]
    expect(filterByOwnership(rows, 'all')).toHaveLength(2)
  })
})

describe('groupExpense', () => {
  it('groups by apartment + item + ownership, separates owner from company', () => {
    const moves = [
      move({ id: 1, apartment_id: 5, item_id: 1, sink_flow: 1, qty: 2, unit_cost: 10, owner_apartment_id: null }),
      move({ id: 2, apartment_id: 5, item_id: 1, sink_flow: 1, qty: 3, unit_cost: 10, owner_apartment_id: 7, owner_code: 'B1/200' }),
    ]
    const rows = groupExpense(moves)
    expect(rows).toHaveLength(2)
    const ownerRow = rows.find((r) => r.isOwner)
    expect(ownerRow).toBeDefined()
    expect(ownerRow!.qtyPacks).toBe(3)
    expect(ownerRow!.ownerCode).toBe('B1/200')
  })
  it('returns empty for non-sink moves', () => {
    expect(groupExpense([move({ sink_flow: 0 })])).toHaveLength(0)
  })
  it('handles return from sink (sink_flow -1)', () => {
    const rows = groupExpense([move({ sink_flow: 1, qty: 5 }), move({ sink_flow: -1, qty: 2 })])
    expect(rows).toHaveLength(1)
    expect(rows[0].qtyPacks).toBe(3)
  })
  it('marks partial when unit_cost is null', () => {
    const rows = groupExpense([move({ sink_flow: 1, unit_cost: null })])
    expect(rows[0].partial).toBe(true)
    expect(rows[0].cost).toBeNull()
  })
})

describe('chargesTotals', () => {
  it('sums amounts and counts by status', () => {
    const rows: Array<{ status: ChargeStatus; amount: number }> = [
      { status: 'pending', amount: 100 },
      { status: 'pending', amount: 50 },
      { status: 'paid', amount: 200 },
      { status: 'waived', amount: 75 },
    ]
    const totals = chargesTotals(rows)
    expect(totals.pending).toEqual({ count: 2, sum: 150 })
    expect(totals.paid).toEqual({ count: 1, sum: 200 })
    expect(totals.waived).toEqual({ count: 1, sum: 75 })
  })
  it('returns zeros for empty list', () => {
    const totals = chargesTotals([])
    expect(totals.pending).toEqual({ count: 0, sum: 0 })
    expect(totals.paid).toEqual({ count: 0, sum: 0 })
    expect(totals.waived).toEqual({ count: 0, sum: 0 })
  })
  it('ignores unknown status', () => {
    const totals = chargesTotals([{ status: 'pending' as ChargeStatus, amount: 10 }])
    expect(totals.pending.count).toBe(1)
    expect(totals.paid.count).toBe(0)
  })
})

describe('ownershipLabel', () => {
  it('returns company label for non-owner', () => {
    expect(ownershipLabel(false, null, 'Компания', 'Owner')).toBe('Компания')
  })
  it('returns owner label with code for owner', () => {
    expect(ownershipLabel(true, 'B1/200', 'Компания', 'Owner')).toBe('Owner B1/200')
  })
  it('returns owner label without code when null', () => {
    expect(ownershipLabel(true, null, 'Компания', 'Owner')).toBe('Owner')
  })
})
