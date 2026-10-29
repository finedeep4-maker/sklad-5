import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import { resolveMime, extForMime } from '@/lib/files'
import type { CleaningResult } from '@/lib/database.types'
import { addOutboxEntry } from '@/lib/outbox'
import { toast } from '@/lib/toast'
import { currentDict } from '@/i18n'

export async function completeCleaning(params: {
  userId: string
  apartmentId: number
  cleanedAt: string
  clientOpId: string
  staffIds: number[]
  leadStaffId: number | null
  note: string | null
  media?: Blob[]
}): Promise<CleaningResult> {
  const { data, error, status } = await supabase.rpc('complete_cleaning', {
    p_apartment_id: params.apartmentId,
    p_cleaned_at: params.cleanedAt,
    p_client_op_id: params.clientOpId,
    p_staff_ids: params.staffIds,
    p_lead_staff_id: params.leadStaffId,
    p_note: params.note,
  })
  if (error) {
    throw toApiError(error, status)
  }
  const result = data as CleaningResult

  if (params.media && params.media.length > 0) {
    try {
      await uploadAndAttachMedia(params.userId, params.clientOpId, params.media)
    } catch {
      try {
        await addOutboxEntry({
          id: crypto.randomUUID(),
          userId: params.userId,
          apartmentId: params.apartmentId,
          cleanedAt: params.cleanedAt,
          clientOpId: params.clientOpId,
          staffIds: params.staffIds,
          leadStaffId: params.leadStaffId,
          note: params.note,
          createdAt: Date.now(),
          media: params.media,
          status: 'done',
        })
        toast(currentDict().cleaning.mediaWillRetry, 'info')
      } catch {
        toast(currentDict().cleaning.mediaSaveFailed, 'error')
      }
    }
  }

  return result
}

async function uploadAndAttachMedia(userId: string, clientOpId: string, media: Blob[]): Promise<void> {
  const paths: string[] = []
  for (let i = 0; i < media.length; i++) {
    const blob = media[i]
    const mime = resolveMime(blob as File) ?? 'application/octet-stream'
    const ext = extForMime(mime)
    const path = `${userId}/${clientOpId}/${i}${ext}`
    const { error } = await supabase.storage
      .from('cleaning-media')
      .upload(path, blob, { contentType: mime, upsert: true })
    if (error) throw toApiError(error)
    paths.push(path)
  }
  const { error: rpcError } = await supabase.rpc('attach_cleaning_media', {
    p_client_op_id: clientOpId,
    p_paths: paths,
  })
  if (rpcError) throw toApiError(rpcError)
}

export async function queueCleaningOffline(params: {
  userId: string
  apartmentId: number
  cleanedAt: string
  clientOpId: string
  staffIds: number[]
  leadStaffId: number | null
  note: string | null
  media?: Blob[]
}): Promise<void> {
  await addOutboxEntry({
    id: crypto.randomUUID(),
    userId: params.userId,
    apartmentId: params.apartmentId,
    cleanedAt: params.cleanedAt,
    clientOpId: params.clientOpId,
    staffIds: params.staffIds,
    leadStaffId: params.leadStaffId,
    note: params.note,
    createdAt: Date.now(),
    media: params.media,
  })
}

export function isNetworkError(error: unknown): boolean {
  return toApiError(error).isNetwork
}
