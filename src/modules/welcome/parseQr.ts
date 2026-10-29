/**
 * Extracts the apartment id from the text of a scanned QR code.
 * Apartment QR codes encode `<origin>/qr.html#/qr/<id>`; plain `/qr/<id>` links are accepted too.
 * Only the numeric id is used, so a foreign link can never redirect the app to another site.
 */
export function parseApartmentId(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const match = text.match(/\/qr\/(\d{1,9})(?:[/?#]|$)/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
