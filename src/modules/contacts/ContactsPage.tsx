import { useState, useEffect, useMemo } from 'react'
import { fetchContacts } from '@/modules/contacts/api'
import type { Contact } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { Phone, MessageCircle, User } from 'lucide-react'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { useLiveRefresh } from '@/lib/realtime'

export function ContactsPage() {
  const { t } = useI18n()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    fetchContacts().then(setContacts).catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) }).finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => { load() }, [])
  useLiveRefresh(['contacts'], () => load(true))

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>()
    for (const c of contacts) {
      const key = c.group_name ?? t.common.noGroup
      const list = map.get(key) ?? []
      list.push(c)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [contacts, t.common.noGroup])

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.contacts.title}</h1>
      {loading ? (
        <p className="text-center text-muted mt-8">{t.app.loading}</p>
      ) : loadError ? (
        <ErrorState onRetry={load} />
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-16 text-muted">
          <Phone className="w-10 h-10 mb-3" />
          <p className="text-sm">{t.contacts.noContacts}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([group, list]) => (
            <div key={group}>
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 px-1">{group}</h2>
              <div className="space-y-2">
                {list.map((c) => (
                  <div key={c.id} className="bg-surface rounded-xl border border-line px-4 py-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 bg-app rounded-lg flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink">{c.name}</p>
                        {c.role_title && <p className="text-xs text-muted">{c.role_title}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-12">
                      <a href={`tel:${c.phone_e164}`} className="flex items-center gap-1.5 bg-accent-soft text-accent rounded-lg px-3 py-1.5 text-xs font-medium">
                        <Phone className="w-3.5 h-3.5" />
                        {t.contacts.call}
                      </a>
                      {c.has_whatsapp && (
                        <a href={`https://wa.me/${c.phone_e164.replace('+', '')}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 bg-ok-soft text-ok rounded-lg px-3 py-1.5 text-xs font-medium">
                          <MessageCircle className="w-3.5 h-3.5" />
                          {t.contacts.whatsapp}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
