import type { ReportStockMoveRow, ChargeStatus } from '@/lib/database.types'

export type OwnershipFilter = 'company' | 'owner' | 'all'

export interface ExpenseGroupKey {
  apartmentId: number | null
  itemId: number
  isOwner: boolean
}

export interface ExpenseRow {
  apartment: string
  item: string
  category: string
  qtyPacks: number
  cost: number | null
  partial: boolean
  isOwner: boolean
  ownerCode: string | null
}

export function filterByOwnership<T extends { owner_apartment_id: number | null }>(
  rows: T[],
  filter: OwnershipFilter,
): T[] {
  if (filter === 'company') return rows.filter((r) => r.owner_apartment_id == null)
  if (filter === 'owner') return rows.filter((r) => r.owner_apartment_id != null)
  return rows
}

export function expenseKey(move: ReportStockMoveRow): ExpenseGroupKey {
  return {
    apartmentId: move.apartment_id,
    itemId: move.item_id,
    isOwner: move.owner_apartment_id != null,
  }
}

export function groupExpense(moves: ReportStockMoveRow[]): ExpenseRow[] {
  const grouped = new Map<string, ExpenseRow>()
  for (const move of moves) {
    if (move.sink_flow === 0) continue
    const key = `${move.apartment_id ?? 'none'}-${move.item_id}-${move.owner_apartment_id != null ? 'o' : 'c'}`
    const sign = move.sink_flow
    const existing = grouped.get(key) ?? {
      apartment: move.apartment_code ?? '—',
      item: move.item_name,
      category: move.category,
      qtyPacks: 0,
      cost: null,
      partial: false,
      isOwner: move.owner_apartment_id != null,
      ownerCode: move.owner_code ?? null,
    }
    existing.qtyPacks += sign * (move.qty / (move.pack_size || 1))
    if (move.unit_cost == null) existing.partial = true
    else existing.cost = (existing.cost ?? 0) + sign * move.qty * move.unit_cost
    grouped.set(key, existing)
  }
  return Array.from(grouped.values())
    .filter((row) => Math.abs(row.qtyPacks) > 0.0001)
    .sort((a, b) => a.apartment.localeCompare(b.apartment) || a.item.localeCompare(b.item))
}

export interface ChargesTotals {
  pending: { count: number; sum: number }
  paid: { count: number; sum: number }
  waived: { count: number; sum: number }
}

export function chargesTotals(rows: Array<{ status: ChargeStatus; amount: number }>): ChargesTotals {
  const totals: ChargesTotals = {
    pending: { count: 0, sum: 0 },
    paid: { count: 0, sum: 0 },
    waived: { count: 0, sum: 0 },
  }
  for (const row of rows) {
    if (row.status === 'pending') { totals.pending.count++; totals.pending.sum += row.amount }
    else if (row.status === 'paid') { totals.paid.count++; totals.paid.sum += row.amount }
    else if (row.status === 'waived') { totals.waived.count++; totals.waived.sum += row.amount }
  }
  return totals
}

export function ownershipLabel(
  isOwner: boolean,
  ownerCode: string | null,
  companyLabel: string,
  ownerLabel: string,
): string {
  if (isOwner) return `${ownerLabel} ${ownerCode ?? ''}`.trim()
  return companyLabel
}
