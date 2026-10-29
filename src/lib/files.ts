import { currentDict } from '@/i18n'

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

export function resolveMime(file: File): string | null {
  const raw = file.type?.trim()
  if (raw && raw !== 'application/octet-stream') return raw
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? null
}

export function extForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return '.jpg'
    case 'image/png': return '.png'
    case 'image/webp': return '.webp'
    case 'application/pdf': return '.pdf'
    case 'video/mp4': return '.mp4'
    case 'video/quicktime': return '.mov'
    case 'video/webm': return '.webm'
    default: return '.bin'
  }
}

const RECEIPT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const RECEIPT_MAX = 10 * 1024 * 1024

export function validateReceipt(file: File): string | null {
  const mime = resolveMime(file)
  const d = currentDict().common
  if (!mime || !RECEIPT_MIMES.has(mime)) return d.receiptFormat
  if (file.size > RECEIPT_MAX) return d.receiptTooBig
  return null
}

const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
export const VIDEO_MAX = 50 * 1024 * 1024

export function validateVideo(file: File): string | null {
  const mime = resolveMime(file)
  const d = currentDict().common
  if (!mime || !VIDEO_MIMES.has(mime)) return d.videoFormat
  if (file.size > VIDEO_MAX) return d.videoTooBig
  return null
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function isImageFile(file: File): boolean {
  const mime = resolveMime(file)
  return !!mime && IMAGE_MIMES.has(mime)
}

const CLEANING_MEDIA_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
const CLEANING_MEDIA_MAX = 50 * 1024 * 1024

export function validateCleaningMedia(file: File): string | null {
  const mime = resolveMime(file)
  const d = currentDict().cleaning
  if (!mime || !CLEANING_MEDIA_MIMES.has(mime)) return d.mediaError
  if (file.size > CLEANING_MEDIA_MAX) return d.mediaTooBig
  return null
}

export function isVideoFile(file: File): boolean {
  const mime = resolveMime(file)
  return !!mime && VIDEO_MIMES.has(mime)
}

export function isHeicFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif'
}
