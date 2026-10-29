import { describe, it, expect } from 'vitest'
import { resolveCoef, calcCharge } from './charges'

describe('resolveCoef', () => {
  it('uses request coef first', () => {
    expect(resolveCoef(2, 1.5, 1)).toBe(2)
  })
  it('falls back to item coef', () => {
    expect(resolveCoef(null, 1.5, 1)).toBe(1.5)
  })
  it('falls back to category coef', () => {
    expect(resolveCoef(null, null, 1.5)).toBe(1.5)
  })
  it('returns null when none set', () => {
    expect(resolveCoef(null, null, null)).toBeNull()
  })
  it('ignores zero/negative request coef', () => {
    expect(resolveCoef(0, 1.5, 1)).toBe(1.5)
  })
})

describe('calcCharge', () => {
  it('rounds to 2 decimals', () => {
    expect(calcCharge(1, 100, 1.5)).toBe(150)
  })
  it('rounds half-up', () => {
    expect(calcCharge(3, 0.1, 1.005)).toBe(0.3)
  })
})
