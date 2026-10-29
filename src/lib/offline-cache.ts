import { get, set } from 'idb-keyval'
import { toApiError } from '@/lib/errors'

interface CacheEntry<T> {
  data: T
  ts: number
}

async function readCache<T>(key: string): Promise<T | null> {
  const entry = await get<CacheEntry<T>>(key)
  return entry?.data ?? null
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  await set(key, { data, ts: Date.now() } satisfies CacheEntry<T>)
}

export async function swrFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean; stale: boolean }> {
  const cached = await get<CacheEntry<T>>(cacheKey)

  if (!navigator.onLine) {
    if (cached) {
      return { data: cached.data, fromCache: true, stale: true }
    }
    throw toApiError(new Error('network'))
  }

  try {
    const data = await fetcher()
    await writeCache(cacheKey, data)
    return { data, fromCache: false, stale: false }
  } catch (error) {
    const apiError = toApiError(error)
    if (apiError.isNetwork && cached) {
      return { data: cached.data, fromCache: true, stale: true }
    }
    throw apiError
  }
}

export async function swrFetchWithFallback<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  try {
    const result = await swrFetch(cacheKey, fetcher)
    return { data: result.data, fromCache: result.fromCache }
  } catch {
    const cached = await readCache<T>(cacheKey)
    if (cached) return { data: cached, fromCache: true }
    throw toApiError(new Error('network'))
  }
}

export function cacheKey(userId: string, name: string): string {
  return `sv_${userId}_${name}`
}

export function normCacheKey(userId: string, apartmentId: number): string {
  return `sv_${userId}_norms_${apartmentId}`
}

export { readCache, writeCache }
