import type { BaseUnit, Item } from '@/lib/database.types'
import { currentDict, currentLang } from '@/i18n'

const cairoTz = 'Africa/Cairo'

function locale(): string {
  return currentLang() === 'ar' ? 'ar-EG' : 'ru-RU'
}

function unitShort(unit: BaseUnit): string {
  return currentDict().common.units[unit]
}

export function unitLabel(unit: BaseUnit): string {
  return unitShort(unit)
}

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(locale(), { timeZone: cairoTz, day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(locale(), {
    timeZone: cairoTz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.toLocaleDateString('ru-RU', { timeZone: cairoTz }) === now.toLocaleDateString('ru-RU', { timeZone: cairoTz })
}

export function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffD = Math.floor(diffH / 24)
  const dict = currentDict()
  const loc = locale()
  if (diffMin < 1) return dict.common.justNow
  if (diffMin < 60) return `${diffMin.toLocaleString(loc)} ${dict.common.minutesAgo}`
  if (diffH < 24) return `${diffH.toLocaleString(loc)} ${dict.common.hoursAgo}`
  if (diffD < 7) return `${diffD.toLocaleString(loc)} ${dict.common.daysAgo}`
  return formatDate(iso)
}

export function formatQty(qty: number, item: Pick<Item, 'base_unit' | 'pack_size' | 'pack_label'>): string {
  const loc = locale()
  const isConsumable = item.pack_size > 1
  if (isConsumable) {
    const packs = qty / item.pack_size
    const packsStr = packs.toLocaleString(loc, { maximumFractionDigits: 1 })
    const baseStr = Math.round(qty).toLocaleString(loc)
    return `${packsStr} ${item.pack_label} (${baseStr} ${unitShort(item.base_unit)})`
  }
  return `${qty.toLocaleString(loc, { maximumFractionDigits: 3 })} ${unitShort(item.base_unit)}`
}

export function formatEGP(amount: number): string {
  const loc = locale()
  if (loc === 'ar-EG') {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(amount)
  }
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EGP' }).format(amount)
}

export function formatNum(value: number, opts?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(locale(), opts)
}

function cairoOffsetMs(instant: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: cairoTz,
    timeZoneName: 'shortOffset',
  })
  const parts = fmt.formatToParts(instant)
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2'
  const m = tz.match(/GMT([+-])(\d+)(?::(\d+))?/)
  if (!m) return 2 * 3600_000
  const sign = m[1] === '-' ? -1 : 1
  const hours = parseInt(m[2], 10)
  const mins = parseInt(m[3] ?? '0', 10)
  return sign * (hours * 60 + mins) * 60_000
}

export function cairoLocalToISO(localStr: string): string | null {
  if (!localStr) return null
  const fakeUTC = new Date(localStr + ':00Z')
  const offset1 = cairoOffsetMs(fakeUTC)
  const candidate = new Date(fakeUTC.getTime() - offset1)
  const offset2 = cairoOffsetMs(candidate)
  return new Date(fakeUTC.getTime() - offset2).toISOString()
}
