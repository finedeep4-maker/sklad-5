import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import type { SvApartment, SvNorm, ApartmentNote, SvStaff } from '@/lib/database.types'
import { swrFetch, cacheKey, normCacheKey } from '@/lib/offline-cache'

export async function fetchApartments(userId: string): Promise<SvApartment[]> {
  const { data } = await swrFetch(cacheKey(userId, 'apartments'), async () => {
    const { data, error, status } = await supabase
      .from('sv_apartments')
      .select('id,code,building,type,status,is_owner,last_cleaned_at')
      .order('code')
    if (error) throw toApiError(error, status)
    return data ?? []
  })
  return data
}

export async function fetchApartmentById(id: number): Promise<SvApartment | null> {
  const { data, error, status } = await supabase
    .from('sv_apartments')
    .select('id,code,building,type,status,is_owner,last_cleaned_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw toApiError(error, status)
  return data
}

export async function fetchNorms(userId: string, apartmentId: number): Promise<SvNorm[]> {
  const { data } = await swrFetch(normCacheKey(userId, apartmentId), async () => {
    const { data, error, status } = await supabase
      .from('sv_norms')
      .select('apartment_id,norm_type,item_id,item_name,base_unit,pack_label,qty,pack_size')
      .eq('apartment_id', apartmentId)
      .order('norm_type')
      .order('item_name')
    if (error) throw toApiError(error, status)
    return data ?? []
  })
  return data
}

export async function fetchNotes(apartmentId: number): Promise<ApartmentNote[]> {
  const { data, error, status } = await supabase
    .from('apartment_notes')
    .select('id,apartment_id,author,body,photo_path,visibility,created_at')
    .eq('apartment_id', apartmentId)
    .order('created_at', { ascending: false })
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function addNote(apartmentId: number, body: string): Promise<void> {
  const { error, status } = await supabase
    .from('apartment_notes')
    .insert({ apartment_id: apartmentId, body, visibility: 'all' })
  if (error) throw toApiError(error, status)
}

export async function fetchStaff(userId: string): Promise<SvStaff[]> {
  const { data } = await swrFetch(cacheKey(userId, 'staff'), async () => {
    const { data, error, status } = await supabase
      .from('sv_staff')
      .select('id,full_name')
      .order('full_name')
    if (error) throw toApiError(error, status)
    return data ?? []
  })
  return data
}
