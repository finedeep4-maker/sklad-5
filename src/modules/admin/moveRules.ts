import type { OwnerStockRow } from '@/lib/database.types'

export type LineSource = 'owner' | 'company' | null

export type MoveOp =
  | 'receipt'
  | 'issue_apartment'
  | 'return_apartment'
  | 'writeoff_apartment'
  | 'writeoff_warehouse'
  | 'issue_holder'
  | 'return_holder'
  | 'writeoff_holder'
  | 'transfer_apartment'
  | 'transfer_holder'

export type ItemKind = 'asset' | 'consumable'

/**
 * Determines which stock shelf a line item is sourced from for a given operation.
 * - 'owner' for assets when issuing to / returning from an owner apartment
 * - 'company' for consumables or regular apartments
 * - null when the operation doesn't pull from stock (receipt, writeoff from apartment, transfers)
 */
export function lineSource(
  op: MoveOp,
  aptIsOwner: boolean,
  kind: ItemKind,
): LineSource {
  if (op === 'issue_apartment' || op === 'return_apartment') {
    if (aptIsOwner && kind === 'asset') return 'owner'
    return 'company'
  }
  return null
}

/**
 * Whether a transfer is blocked by the server for this item/kind.
 * Assets belonging to an owner apartment cannot be moved between apartments or to a holder.
 * Consumables are never blocked (they always belong to the company).
 */
export function isTransferBlocked(
  kind: ItemKind,
  fromAptIsOwner: boolean,
  toAptIsOwner: boolean,
): boolean {
  if (kind !== 'asset') return false
  return fromAptIsOwner || toAptIsOwner
}

/**
 * Returns the owner-stock balance for a given apartment+item, or 0 if not found.
 */
export function ownerAvailable(
  map: Map<string, number>,
  apartmentId: number,
  itemId: number,
): number {
  return map.get(`${apartmentId}:${itemId}`) ?? 0
}

/**
 * Builds a lookup map from owner stock rows, keyed by "apartmentId:itemId".
 */
export function buildOwnerStockMap(rows: OwnerStockRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(`${r.apartment_id}:${r.item_id}`, r.qty)
  }
  return map
}

/**
 * Which ends of a transfer are owner apartments.
 * transfer_apartment: from = selected apartment, to = target apartment.
 * transfer_holder: staff holder -> selected apartment (the holder's stock is company stock).
 */
export function transferOwnerFlags(
  op: 'transfer_apartment' | 'transfer_holder',
  selectedAptIsOwner: boolean,
  toAptIsOwner: boolean,
): { fromOwner: boolean; toOwner: boolean } {
  if (op === 'transfer_holder') return { fromOwner: false, toOwner: selectedAptIsOwner }
  return { fromOwner: selectedAptIsOwner, toOwner: toAptIsOwner }
}
