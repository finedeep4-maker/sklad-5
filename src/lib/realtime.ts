import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Единая realtime-подписка на изменения данных (Supabase postgres_changes).
 * Один канал на всё приложение; экраны подписываются через useLiveRefresh.
 * Доступ к строкам определяется RLS: пользователь получает только то, что может читать.
 * Страховка: при потере связи, возврате в приложение и раз в минуту выполняется полная пересинхронизация.
 */
export const LIVE_TABLES = [
  'apartments', 'apartment_notes', 'buildings', 'categories', 'items', 'staff', 'norm_rules',
  'cleaning_events', 'cleaning_event_staff', 'cleaning_event_lines', 'incidents', 'contacts',
  'documents', 'stock_moves', 'locations', 'suppliers', 'inventories', 'inventory_lines',
  'purchase_orders', 'purchase_order_lines', 'events',
  'rooms', 'room_norms', 'room_stock',
] as const

const DEBOUNCE_MS = 400
const FALLBACK_SYNC_MS = 60_000

type Listener = (table: string) => void

const listeners = new Set<Listener>()
let channel: ReturnType<typeof supabase.channel> | null = null
let wasSubscribed = false
let fallbackTimer: ReturnType<typeof setInterval> | null = null

function emit(table: string): void {
  for (const l of listeners) l(table)
}

const onVisible = () => { if (document.visibilityState === 'visible') emit('*') }
const onOnline = () => emit('*')

function start(): void {
  if (channel) return
  let ch = supabase.channel('app-live')
  for (const table of LIVE_TABLES) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => emit(table))
  }
  channel = ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (wasSubscribed) emit('*')
      wasSubscribed = true
    }
  })
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  fallbackTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) emit('*')
  }, FALLBACK_SYNC_MS)
}

function stopIfIdle(): void {
  if (listeners.size > 0 || !channel) return
  supabase.removeChannel(channel)
  channel = null
  wasSubscribed = false
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onOnline)
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null }
}

/**
 * Вызывает reload (с задержкой 400 мс, схлопывая серии событий) при изменении любой из tables.
 * reload получает таблицу, которая изменилась; "*" — общая пересинхронизация (возврат в приложение, сеть, таймер).
 */
export function useLiveRefresh(tables: readonly string[], reload: (table: string) => void): void {
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload })
  const key = tables.join(',')

  useEffect(() => {
    const watched = new Set(key.split(','))
    let timer: ReturnType<typeof setTimeout> | null = null
    let changed: string | null = null   // a specific table seen in this debounce window
    const listener: Listener = (table) => {
      if (table !== '*' && !watched.has(table)) return
      if (table !== '*') changed = table
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const which = changed ?? '*'
        changed = null
        reloadRef.current(which)
      }, DEBOUNCE_MS)
    }
    listeners.add(listener)
    start()
    return () => {
      listeners.delete(listener)
      if (timer) clearTimeout(timer)
      stopIfIdle()
    }
  }, [key])
}
