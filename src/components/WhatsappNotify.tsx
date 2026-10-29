import { MessageCircle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { whatsappUrl } from '@/lib/whatsappNotify'
import type { Contact } from '@/lib/database.types'

interface Props {
  contacts: Contact[]
  text: string
}

/** One tap opens WhatsApp with the ready text; the sender presses "send" there. */
export function WhatsappNotify({ contacts, text }: Props) {
  const { t } = useI18n()
  if (contacts.length === 0) return null
  return (
    <div className="bg-ok-soft border border-line rounded-xl px-3 py-3 space-y-2">
      <p className="text-xs text-ok">{t.notify.hint}</p>
      {contacts.map((c) => (
        <a
          key={c.id}
          href={whatsappUrl(c.phone_e164, text)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full min-h-[48px] bg-ok text-white rounded-xl px-4 py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          <span>{t.notify.send}{contacts.length > 1 ? `: ${c.name}` : ''}</span>
        </a>
      ))}
    </div>
  )
}
