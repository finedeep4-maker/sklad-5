import { describe, it, expect } from 'vitest'
import { mergeNorms } from './norms'
import type { NormRuleRow } from '@/lib/database.types'

function makeRow(
  id: number,
  normType: NormRuleRow['norm_type'],
  itemId: number,
  qty: number,
  isTemplate: boolean,
  aptType: NormRuleRow['apt_type'] = null,
  apartmentId: NormRuleRow['apartment_id'] = null,
  note: string | null = null,
): NormRuleRow {
  return {
    id,
    norm_type: normType,
    apt_type: isTemplate ? aptType : null,
    apartment_id: isTemplate ? null : apartmentId,
    item_id: itemId,
    qty,
    note,
  }
}

describe('mergeNorms', () => {
  it('returns template-only rows with source=template', () => {
    const templates = [
      makeRow(1, 'asset_standing', 10, 2, true, 'studio'),
      makeRow(2, 'asset_standing', 20, 5, true, 'studio'),
    ]
    const result = mergeNorms(templates, [])
    const asset = result.get('asset_standing')!
    expect(asset).toHaveLength(2)
    expect(asset[0]).toMatchObject({ itemId: 10, qty: 2, source: 'template', excluded: false })
    expect(asset[1]).toMatchObject({ itemId: 20, qty: 5, source: 'template', excluded: false })
  })

  it('override replaces template row with source=custom', () => {
    const templates = [makeRow(1, 'asset_standing', 10, 2, true, 'studio')]
    const overrides = [makeRow(100, 'asset_standing', 10, 8, false, null, 1)]
    const result = mergeNorms(templates, overrides)
    const asset = result.get('asset_standing')!
    expect(asset).toHaveLength(1)
    expect(asset[0]).toMatchObject({ itemId: 10, qty: 8, source: 'custom', excluded: false, overrideId: 100, templateQty: 2 })
  })

  it('override with qty=0 is marked excluded', () => {
    const templates = [makeRow(1, 'asset_standing', 10, 2, true, 'studio')]
    const overrides = [makeRow(100, 'asset_standing', 10, 0, false, null, 1)]
    const result = mergeNorms(templates, overrides)
    const asset = result.get('asset_standing')!
    expect(asset).toHaveLength(1)
    expect(asset[0]).toMatchObject({ itemId: 10, qty: 0, source: 'custom', excluded: true, templateQty: 2 })
  })

  it('override without template counterpart is source=custom with no templateQty', () => {
    const overrides = [makeRow(100, 'turnover_replenish', 30, 3, false, null, 1)]
    const result = mergeNorms([], overrides)
    const turnover = result.get('turnover_replenish')!
    expect(turnover).toHaveLength(1)
    expect(turnover[0]).toMatchObject({ itemId: 30, qty: 3, source: 'custom', excluded: false })
    expect(turnover[0].templateQty).toBeUndefined()
  })

  it('three norm types stay independent', () => {
    const templates = [
      makeRow(1, 'asset_standing', 10, 2, true, 'studio'),
      makeRow(2, 'turnover_replenish', 20, 5, true, 'studio'),
      makeRow(3, 'cleaning_consumption', 30, 1, true, 'studio'),
    ]
    const overrides = [
      makeRow(100, 'turnover_replenish', 20, 0, false, null, 1),
      makeRow(101, 'cleaning_consumption', 40, 3, false, null, 1),
    ]
    const result = mergeNorms(templates, overrides)

    expect(result.get('asset_standing')!).toHaveLength(1)
    expect(result.get('asset_standing')![0]).toMatchObject({ source: 'template', itemId: 10 })

    expect(result.get('turnover_replenish')!).toHaveLength(1)
    expect(result.get('turnover_replenish')![0]).toMatchObject({ source: 'custom', excluded: true, itemId: 20 })

    expect(result.get('cleaning_consumption')!).toHaveLength(2)
    const cleaning = result.get('cleaning_consumption')!
    expect(cleaning.find((r) => r.itemId === 30)).toMatchObject({ source: 'template', qty: 1 })
    expect(cleaning.find((r) => r.itemId === 40)).toMatchObject({ source: 'custom', qty: 3 })
  })

  it('returns empty lists for types with no rows', () => {
    const result = mergeNorms([], [])
    expect(result.get('asset_standing')).toEqual([])
    expect(result.get('turnover_replenish')).toEqual([])
    expect(result.get('cleaning_consumption')).toEqual([])
  })
})
