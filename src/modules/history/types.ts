import type { EventStatus, IncidentKind, IncidentStatus, NormType, BaseUnit } from '@/lib/database.types'

export interface SvCleaningEventRow {
  id: string
  apartment_id: number
  cleaned_at: string
  status: EventStatus
  note: string | null
  staff_names: string | null
  revision: number
  lead_staff_name: string | null
  author_name: string | null
  reversed_at: string | null
  reversed_by_name: string | null
  reverse_reason: string | null
  search_text: string | null
  media_paths: string[] | null
  /** pending = ждёт подтверждения админа, posted = проведена, rejected = отклонена */
  posting_status?: 'pending' | 'posted' | 'rejected' | null
}

export interface SvCleaningEventLineRow {
  event_id: string
  item_id: number
  item_name: string | null
  norm_type: NormType
  qty: number
  base_unit: BaseUnit
}

export interface SvApartmentIncidentRow {
  id: string
  apartment_id: number
  created_at: string
  kind: IncidentKind
  status: IncidentStatus
  qty: number
  item_name: string | null
  free_text: string | null
  comment: string | null
  photo_paths: string[]
  author_name: string | null
  resolved_at: string | null
  resolved_by_name: string | null
  resolution_note: string | null
  search_text: string | null
}

export interface CleaningHistoryFilters {
  search: string
  dateFrom: string
  dateTo: string
  hasMedia: boolean
  status: EventStatus | ''
  leadStaff: string
}

export interface IncidentHistoryFilters {
  search: string
  dateFrom: string
  dateTo: string
  hasMedia: boolean
  status: IncidentStatus | ''
  kind: IncidentKind | ''
}

export const PAGE_SIZE = 20

export function emptyCleaningFilters(): CleaningHistoryFilters {
  return { search: '', dateFrom: '', dateTo: '', hasMedia: false, status: '', leadStaff: '' }
}

export function emptyIncidentFilters(): IncidentHistoryFilters {
  return { search: '', dateFrom: '', dateTo: '', hasMedia: false, status: '', kind: '' }
}

export function escapeIlike(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function shiftDateUTC(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
