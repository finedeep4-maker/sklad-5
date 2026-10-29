import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { currentDict } from '@/i18n'
import type { Contact } from '@/lib/database.types'

/** WhatsApp contacts the admin marked as recipients of QR app messages. */
export async function fetchNotifyContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id,group_name,name,role_title,phone_e164,has_whatsapp,sort,active,notify_on_events')
    .eq('active', true)
    .eq('has_whatsapp', true)
    .eq('notify_on_events', true)
    .order('sort')
    .order('name')
  if (error) throw error
  return (data ?? []) as Contact[]
}

let cache: Contact[] = []

/** Empty list when nobody is marked (or the column is missing): the feature then stays hidden. */
export function useNotifyContacts(): Contact[] {
  const [contacts, setContacts] = useState<Contact[]>(cache)
  useEffect(() => {
    let alive = true
    fetchNotifyContacts()
      .then((list) => {
        cache = list
        if (alive) setContacts(list)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return contacts
}

export function whatsappUrl(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/[^0-9]/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

interface Base {
  code: string
  building?: string | null
  author?: string | null
}

function header(b: Base): string {
  return `🏠 ${b.code}${b.building ? ` (${b.building})` : ''}`
}

function footer(b: Base): string | null {
  return b.author ? `${currentDict().notify.from}: ${b.author}` : null
}

function join(lines: Array<string | null | undefined | false>): string {
  return lines.filter((l): l is string => !!l).join('\n')
}

export function incidentMessage(p: Base & { kindLabel: string; what: string; qty: number; comment: string | null }): string {
  const n = currentDict().notify
  return join([
    header(p),
    `⚠️ ${n.incident}: ${p.kindLabel}`,
    `${p.what} × ${p.qty}`,
    p.comment,
    footer(p),
  ])
}

export function cleaningMessage(p: Base & { staff: string[]; note: string | null; pending: boolean }): string {
  const n = currentDict().notify
  return join([
    header(p),
    `✅ ${n.cleaned}${p.pending ? ` (${n.awaiting})` : ''}`,
    p.staff.length > 0 && `${n.staff}: ${p.staff.join(', ')}`,
    p.note,
    footer(p),
  ])
}

export function commentMessage(p: Base & { body: string }): string {
  const n = currentDict().notify
  return join([header(p), `💬 ${n.comment}:`, p.body, footer(p)])
}
