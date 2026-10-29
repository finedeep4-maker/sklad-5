import { useState, useEffect } from 'react'
import { fetchAllContacts, createContact, updateContact, deleteContact } from '@/modules/admin/api'
import type { Contact } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { Plus, Trash2, CreditCard as Edit3, X, Check, Phone, MessageCircle } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { useLiveRefresh } from '@/lib/realtime'

export function AdminContacts() {
  const { t } = useI18n()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [adding, setAdding] = useState(false)

  const load = (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    fetchAllContacts().then(setContacts).catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) }).finally(() => { if (!quiet) setLoading(false) })
  }
  useEffect(() => { load() }, [])
  useLiveRefresh(['contacts'], () => load(true))

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (loadError) return <ErrorState onRetry={load} />

  return (
    <div className="px-4 pt-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.adminContacts.title}</h1>
        <button onClick={() => setAdding(true)} className="bg-accent text-white rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-1.5">
          <Plus className="w-4 h-4" />{t.admin.adminContacts.add}
        </button>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.adminContacts.noContacts}</p>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="bg-surface rounded-xl border border-line px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-muted">{c.group_name ?? '—'} · {c.role_title ?? '—'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone_e164}</span>
                    {c.has_whatsapp && <span className="text-xs text-ok flex items-center gap-1"><MessageCircle className="w-3 h-3" />WA</span>}
                  </div>
                </div>
                <button onClick={() => setEditing(c)} className="text-muted hover:text-accent">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || adding) && (
        <ContactEditor
          contact={editing}
          onClose={() => { setEditing(null); setAdding(false) }}
          onSave={async (name, group, roleTitle, phone, whatsapp, active, notify) => {
            try {
              if (editing) {
                await updateContact(editing.id, { name, group_name: group, role_title: roleTitle, phone_e164: phone, has_whatsapp: whatsapp, notify_on_events: notify, active })
              } else {
                await createContact({ name, group_name: group, role_title: roleTitle, phone_e164: phone, has_whatsapp: whatsapp, notify_on_events: notify, sort: 0 })
              }
              toast(t.admin.adminContacts.save, 'success')
              setEditing(null); setAdding(false); load()
            } catch (e) { toast(errorMessage(e), 'error') }
          }}
          onDelete={editing ? async () => {
            try { await deleteContact(editing.id); toast(t.admin.adminContacts.delete, 'success'); setEditing(null); load() }
            catch (e) { toast(errorMessage(e), 'error') }
          } : undefined}
        />
      )}
    </div>
  )
}

function ContactEditor({
  contact,
  onClose,
  onSave,
  onDelete,
}: {
  contact: Contact | null
  onClose: () => void
  onSave: (name: string, group: string | null, roleTitle: string | null, phone: string, whatsapp: boolean, active: boolean, notify: boolean) => void
  onDelete?: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(contact?.name ?? '')
  const [group, setGroup] = useState(contact?.group_name ?? '')
  const [roleTitle, setRoleTitle] = useState(contact?.role_title ?? '')
  const [phone, setPhone] = useState(contact?.phone_e164 ?? '+2')
  const [whatsapp, setWhatsapp] = useState(contact?.has_whatsapp ?? true)
  const [active, setActive] = useState(contact?.active ?? true)
  const [notify, setNotify] = useState(contact?.notify_on_events ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
      <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{contact ? t.admin.adminContacts.title : t.admin.adminContacts.add}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.adminContacts.name}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.adminContacts.group}</label>
            <input value={group} onChange={(e) => setGroup(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.adminContacts.roleTitle}</label>
            <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.adminContacts.phone}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20123456789" className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm text-ink">{t.admin.adminContacts.whatsapp}</span>
          </label>
          {whatsapp && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-ink">{t.admin.adminContacts.notify}</span>
            </label>
          )}
          {contact && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-ink">{t.admin.adminContacts.active}</span>
            </label>
          )}
        </div>
        <div className="flex gap-3 mt-4">
          {onDelete && (
            <button onClick={() => setConfirmDelete(true)} className="bg-bad-soft text-bad rounded-xl px-4 py-3 font-medium">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
          <button
            onClick={() => onSave(name.trim(), group.trim() || null, roleTitle.trim() || null, phone.trim(), whatsapp, active, whatsapp && notify)}
            disabled={!name.trim() || !phone.trim()}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />{t.admin.adminContacts.save}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t.admin.adminContacts.confirmDelete}
        onConfirm={() => { setConfirmDelete(false); onDelete?.() }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
