import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import { compressImage } from '@/lib/compress'
import { resolveMime, validateVideo, isHeicFile, isImageFile } from '@/lib/files'
import { currentDict } from '@/i18n'
import type { SvApartment, SvNorm, SvItem, ApartmentNote, Contact, Incident } from '@/lib/database.types'
import { swrFetch, normCacheKey } from '@/lib/offline-cache'
import { fetchAllPages } from '@/lib/paginate'

export async function fetchApartment(id: number): Promise<SvApartment | null> {
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

export async function fetchItems(): Promise<SvItem[]> {
  return fetchAllPages<SvItem>((from, to) =>
    supabase
      .from('sv_items')
      .select('id,name,category,base_unit,pack_size,pack_label')
      .order('name')
      .order('id')
      .range(from, to),
  )
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

export async function addNote(apartmentId: number, body: string, photoPath: string | null): Promise<void> {
  const { error, status } = await supabase
    .from('apartment_notes')
    .insert({ apartment_id: apartmentId, body, photo_path: photoPath, visibility: 'all' })
  if (error) throw toApiError(error, status)
}

export async function uploadNoteFile(
  userId: string,
  apartmentId: number,
  file: File,
  isImage: boolean,
): Promise<string> {
  const ts = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${userId}/notes/${apartmentId}/${ts}-${safeName}`

  if (isImage) {
    let compressed: Awaited<ReturnType<typeof compressImage>>
    try {
      compressed = await compressImage(file, 1280, 0.8)
    } catch (e) {
      if (isHeicFile(file)) throw toApiError(new Error(currentDict().heicNotSupported))
      throw e
    }
    const { error } = await supabase.storage
      .from('incident-photos')
      .upload(path, compressed, { contentType: 'image/jpeg' })
    if (error) throw toApiError(error)
  } else {
    const validationError = validateVideo(file)
    if (validationError) throw toApiError(new Error(validationError))
    const mime = resolveMime(file) ?? 'video/mp4'
    const { error } = await supabase.storage
      .from('incident-photos')
      .upload(path, file, { contentType: mime })
    if (error) throw toApiError(error)
  }
  return path
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 7
const signedUrlCache = new Map<string, { url: string; expires: number }>()

export async function createSignedUrl(path: string): Promise<string> {
  const cached = signedUrlCache.get(path)
  if (cached && cached.expires > Date.now() + 60_000) return cached.url

  const { data, error } = await supabase.storage
    .from('incident-photos')
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error) throw toApiError(error)
  signedUrlCache.set(path, { url: data.signedUrl, expires: Date.now() + SIGNED_URL_TTL * 1000 })
  return data.signedUrl
}

export async function createSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const missing = paths.filter((p) => {
    const cached = signedUrlCache.get(p)
    if (cached && cached.expires > Date.now() + 60_000) {
      result.set(p, cached.url)
      return false
    }
    return true
  })
  if (missing.length === 0) return result

  const { data, error } = await supabase.storage
    .from('incident-photos')
    .createSignedUrls(missing, SIGNED_URL_TTL)
  if (error) throw toApiError(error)
  for (const item of data ?? []) {
    if (item.error || !item.signedUrl || !item.path) {
      if (item.path) {
        signedUrlCache.delete(item.path)
      }
      continue
    }
    result.set(item.path, item.signedUrl)
    signedUrlCache.set(item.path, { url: item.signedUrl, expires: Date.now() + SIGNED_URL_TTL * 1000 })
  }
  return result
}

export async function fetchWhatsappContacts(): Promise<Contact[]> {
  const { data, error, status } = await supabase
    .from('contacts')
    .select('id,group_name,name,role_title,phone_e164,has_whatsapp,sort,active')
    .eq('active', true)
    .eq('has_whatsapp', true)
    .order('sort')
    .order('name')
  if (error) throw toApiError(error, status)
  return data ?? []
}

export async function fetchApartmentIncidents(apartmentId: number): Promise<Incident[]> {
  const { data, error, status } = await supabase
    .from('incidents')
    .select('id,apartment_id,item_id,free_text,kind,qty,status,photo_paths,comment,created_by,created_at,resolved_by,resolved_at,resolution_note,client_op_id,writeoff_move_id')
    .eq('apartment_id', apartmentId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw toApiError(error, status)
  return data ?? []
}

export { isImageFile }
