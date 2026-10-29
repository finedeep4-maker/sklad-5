import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import { cairoLocalToISO } from '@/lib/format'
import type {
  SvCleaningEventRow,
  SvCleaningEventLineRow,
  SvApartmentIncidentRow,
  CleaningHistoryFilters,
  IncidentHistoryFilters,
} from './types'
import { PAGE_SIZE, escapeIlike, shiftDateUTC } from './types'

export interface PagedResult<T> {
  rows: T[]
  total: number
}

function buildCleaningQuery(apartmentId: number | null, filters: CleaningHistoryFilters, from: number) {
  let q = supabase
    .from('sv_cleaning_events')
    .select('id,apartment_id,cleaned_at,status,note,staff_names,revision,lead_staff_name,author_name,reversed_at,reversed_by_name,reverse_reason,search_text,media_paths,posting_status', { count: 'exact' })
    .order('cleaned_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  if (apartmentId != null) q = q.eq('apartment_id', apartmentId)
  if (filters.search.trim()) q = q.ilike('search_text', `%${escapeIlike(filters.search.trim())}%`)
  if (filters.dateFrom) {
    const iso = cairoLocalToISO(filters.dateFrom + 'T00:00')
    if (iso) q = q.gte('cleaned_at', iso)
  }
  if (filters.dateTo) {
    const next = shiftDateUTC(filters.dateTo, 1)
    const iso = cairoLocalToISO(next + 'T00:00')
    if (iso) q = q.lt('cleaned_at', iso)
  }
  if (filters.hasMedia) q = q.not('media_paths', 'eq', '{}')
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.leadStaff.trim()) q = q.ilike('lead_staff_name', `%${escapeIlike(filters.leadStaff.trim())}%`)

  return q
}

export async function fetchCleaningHistory(
  apartmentId: number | null,
  filters: CleaningHistoryFilters,
  page: number,
): Promise<PagedResult<SvCleaningEventRow>> {
  const from = page * PAGE_SIZE
  const { data, error, count } = await buildCleaningQuery(apartmentId, filters, from)
  if (error) throw toApiError(error)
  return { rows: (data ?? []) as SvCleaningEventRow[], total: count ?? 0 }
}

export async function fetchCleaningLines(eventId: string): Promise<SvCleaningEventLineRow[]> {
  const { data, error } = await supabase
    .from('sv_cleaning_event_lines')
    .select('event_id,item_id,item_name,norm_type,qty,base_unit')
    .eq('event_id', eventId)
    .order('item_name', { ascending: true })

  if (error) throw toApiError(error)
  return (data ?? []) as SvCleaningEventLineRow[]
}

function buildIncidentQuery(apartmentId: number | null, filters: IncidentHistoryFilters, from: number) {
  let q = supabase
    .from('sv_apartment_incidents')
    .select('id,apartment_id,created_at,kind,status,qty,item_name,free_text,comment,photo_paths,author_name,resolved_at,resolved_by_name,resolution_note,search_text', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  if (apartmentId != null) q = q.eq('apartment_id', apartmentId)
  if (filters.search.trim()) q = q.ilike('search_text', `%${escapeIlike(filters.search.trim())}%`)
  if (filters.dateFrom) {
    const iso = cairoLocalToISO(filters.dateFrom + 'T00:00')
    if (iso) q = q.gte('created_at', iso)
  }
  if (filters.dateTo) {
    const next = shiftDateUTC(filters.dateTo, 1)
    const iso = cairoLocalToISO(next + 'T00:00')
    if (iso) q = q.lt('created_at', iso)
  }
  if (filters.hasMedia) q = q.not('photo_paths', 'eq', '{}')
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.kind) q = q.eq('kind', filters.kind)

  return q
}

export async function fetchIncidentHistory(
  apartmentId: number | null,
  filters: IncidentHistoryFilters,
  page: number,
): Promise<PagedResult<SvApartmentIncidentRow>> {
  const from = page * PAGE_SIZE
  const { data, error, count } = await buildIncidentQuery(apartmentId, filters, from)
  if (error) throw toApiError(error)
  return { rows: (data ?? []) as SvApartmentIncidentRow[], total: count ?? 0 }
}

export async function deleteCleaningEvent(eventId: string, reason: string): Promise<string[]> {
  const { data, error, status } = await supabase.rpc('delete_cleaning_event', {
    p_event: eventId,
    p_reason: reason,
  })
  if (error) throw toApiError(error, status)
  return (data ?? []) as string[]
}

export async function deleteIncidentRecord(incidentId: string, reason: string): Promise<string[]> {
  const { data, error, status } = await supabase.rpc('delete_incident', {
    p_id: incidentId,
    p_reason: reason,
  })
  if (error) throw toApiError(error, status)
  return (data ?? []) as string[]
}

export async function removeStorageFiles(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw toApiError(error)
}

export async function createSignedUrls(bucket: string, paths: string[]): Promise<{ path: string; url: string | null }[]> {
  if (paths.length === 0) return []
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600)
  if (error) throw toApiError(error)
  return (paths).map((path) => {
    const signed = data?.find((d) => d.path === path)
    return { path, url: signed?.signedUrl ?? null }
  })
}
