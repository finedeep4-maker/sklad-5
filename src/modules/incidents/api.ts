import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import { compressImage } from '@/lib/compress'
import { isHeicFile, validateVideo, resolveMime } from '@/lib/files'
import { currentDict } from '@/i18n'
import type { Incident, IncidentKind, SvItem } from '@/lib/database.types'
import { fetchAllPages } from '@/lib/paginate'

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

export async function fetchMyIncidents(userId: string): Promise<Incident[]> {
  return fetchAllPages<Incident>((from, to) =>
    supabase
      .from('incidents')
      .select('id,apartment_id,item_id,free_text,kind,qty,status,photo_paths,comment,created_by,created_at,resolved_by,resolved_at,resolution_note,writeoff_move_id,client_op_id')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )
}

export async function createIncident(params: {
  apartmentId: number
  itemId: number | null
  freeText: string | null
  kind: IncidentKind
  qty: number
  comment: string | null
  photoPaths: string[]
  clientOpId: string
}): Promise<void> {
  const { error, status } = await supabase.from('incidents').insert({
    apartment_id: params.apartmentId,
    item_id: params.itemId,
    free_text: params.freeText,
    kind: params.kind,
    qty: params.qty,
    comment: params.comment,
    photo_paths: params.photoPaths,
    status: 'new',
    client_op_id: params.clientOpId,
  })
  if (error) {
    const apiError = toApiError(error, status)
    if (apiError.code === '23505') return
    throw apiError
  }
}

export async function cleanupPhotos(photoPaths: string[]): Promise<void> {
  if (photoPaths.length === 0) return
  await supabase.storage.from('incident-photos').remove(photoPaths)
}

export async function uploadIncidentPhoto(
  userId: string,
  file: File,
): Promise<string> {
  const mime = resolveMime(file)

  if (mime && (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'video/webm')) {
    const ext = mime === 'video/quicktime' ? '.mov' : mime === 'video/webm' ? '.webm' : '.mp4'
    const path = `${userId}/${crypto.randomUUID()}${ext}`
    const { error } = await supabase.storage
      .from('incident-photos')
      .upload(path, file, { contentType: mime })
    if (error) throw toApiError(error)
    return path
  }

  const uuid = crypto.randomUUID()
  const path = `${userId}/${uuid}.jpg`

  let uploadBlob: Blob = file
  if (isHeicFile(file)) {
    try {
      uploadBlob = await compressImage(file, 1280, 0.8)
    } catch {
      throw toApiError(new Error(currentDict().heicNotSupported))
    }
  } else {
    uploadBlob = await compressImage(file, 1280, 0.8)
  }
  const { error } = await supabase.storage
    .from('incident-photos')
    .upload(path, uploadBlob, { contentType: 'image/jpeg' })
  if (error) throw toApiError(error)
  return path
}

export async function uploadNoteVideo(
  userId: string,
  apartmentId: number,
  file: File,
): Promise<string> {
  const validationError = validateVideo(file)
  if (validationError) throw toApiError(new Error(validationError))

  const mime = file.type || 'video/mp4'
  const ext = mime === 'video/quicktime' ? '.mov' : mime === 'video/webm' ? '.webm' : '.mp4'
  const path = `${userId}/notes/${apartmentId}/${crypto.randomUUID()}${ext}`

  const { error } = await supabase.storage
    .from('incident-photos')
    .upload(path, file, { contentType: mime })
  if (error) throw toApiError(error)
  return path
}
