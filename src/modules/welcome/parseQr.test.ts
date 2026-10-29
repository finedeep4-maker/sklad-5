import { describe, it, expect } from 'vitest'
import { parseApartmentId } from './parseQr'

describe('parseApartmentId', () => {
  it('reads the id from a QR link with a hash route', () => {
    expect(parseApartmentId('https://example.com/qr.html#/qr/12')).toBe(12)
  })

  it('reads the id from a plain path link', () => {
    expect(parseApartmentId('https://example.com/qr/305')).toBe(305)
  })

  it('ignores a trailing action, query or whitespace', () => {
    expect(parseApartmentId(' https://example.com/qr.html#/qr/7/clean ')).toBe(7)
    expect(parseApartmentId('https://example.com/qr/7?x=1')).toBe(7)
  })

  it('rejects text that is not an apartment link', () => {
    expect(parseApartmentId('')).toBeNull()
    expect(parseApartmentId('hello')).toBeNull()
    expect(parseApartmentId('12')).toBeNull()
    expect(parseApartmentId('https://example.com/qr/abc')).toBeNull()
    expect(parseApartmentId('https://example.com/qr/0')).toBeNull()
    expect(parseApartmentId('https://example.com/qr/1234567890')).toBeNull()
  })
})
