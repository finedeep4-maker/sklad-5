import { describe, it, expect } from 'vitest'
import { cairoLocalToISO, formatDate } from './format'

describe('cairoLocalToISO', () => {
  it('converts a winter date correctly', () => {
    const iso = cairoLocalToISO('2026-01-15T10:00')
    expect(iso).toBe('2026-01-15T08:00:00.000Z')
  })

  it('converts a summer date correctly (DST)', () => {
    const iso = cairoLocalToISO('2026-07-15T10:00')
    expect(iso).toBe('2026-07-15T07:00:00.000Z')
  })

  it('round-trips through formatDate', () => {
    const input = '2026-03-15T14:30'
    const iso = cairoLocalToISO(input)
    expect(iso).not.toBeNull()
    expect(formatDate(iso)).toBe('15.03.2026')
  })

  it('handles midnight', () => {
    const iso = cairoLocalToISO('2026-06-01T00:00')
    expect(iso).toBe('2026-05-31T21:00:00.000Z')
  })

  it('returns null for empty string', () => {
    expect(cairoLocalToISO('')).toBeNull()
  })
})
