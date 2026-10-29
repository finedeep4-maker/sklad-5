export function resolveCoef(
  requestCoef: number | null | undefined,
  itemCoef: number | null | undefined,
  categoryCoef: number | null | undefined,
): number | null {
  if (requestCoef != null && requestCoef > 0) return requestCoef
  if (itemCoef != null && itemCoef > 0) return itemCoef
  if (categoryCoef != null && categoryCoef > 0) return categoryCoef
  return null
}

export function calcCharge(qty: number, baseCost: number, coef: number): number {
  return Math.round(qty * baseCost * coef * 100) / 100
}
