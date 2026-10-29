import { useState, useEffect } from 'react'
import { fetchAllStaff, createStaff, updateStaff, deleteStaff, archiveStaff, staffHasHistory } from '@/modules/admin/api'
import type { Staff } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { Plus, Trash2, CreditCard as Edit3, X, Check, Phone } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { useLiveRefresh } from '@/lib/realtime'

export function StaffPage() {
  const { t } = useI18n()
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [adding, setAdding] = useState(false)

  const load = (silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setLoadError(null) }
    fetchAllStaff().then(setStaff).catch((e) => { if (!quiet) setLoadError(friendlyMessage(e)) }).finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => { load() }, [])
  useLiveRefresh(['staff'], () => load(true))

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (loadError) return <ErrorState onRetry={load} />

  return (
    <div className="px-4 pt-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.staff.title}</h1>
        <button
          onClick={() => setAdding(true)}
          className="bg-accent text-white rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          {t.admin.staff.add}
        </button>
      </div>

      {staff.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.staff.noStaff}</p>
      ) : (
        <div className="space-y-2">
          {staff.map((s) => (
            <div key={s.id} className="bg-surface rounded-xl border border-line px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{s.full_name}</p>
                  <p className="text-xs text-muted">{s.role === 'housekeeper' ? t.admin.staff.roleHousekeeper : s.role === 'other' ? t.admin.staff.roleOther : s.role}</p>
                  {s.phone && (
                    <p className="text-xs text-muted flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" />{s.phone}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.active ? 'bg-ok-soft text-ok' : 'bg-app text-muted'}`}>
                    {s.active ? t.admin.staff.active : t.admin.staff.inactive}
                  </span>
                  <button onClick={() => setEditing(s)} className="text-muted hover:text-accent">
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || adding) && (
        <StaffEditor
          staff={editing}
          onClose={() => { setEditing(null); setAdding(false) }}
          onSave={async (name, roleVal, phone, active) => {
            try {
              if (editing) {
                await updateStaff(editing.id, { full_name: name, role: roleVal, phone, active })
              } else {
                await createStaff(name, roleVal, phone)
              }
              toast(t.admin.staff.save, 'success')
              setEditing(null)
              setAdding(false)
              load()
            } catch (e) {
              toast(errorMessage(e), 'error')
            }
          }}
          onDelete={editing ? async () => {
            try {
              // Staff with stock moves or cleanings must stay in history: deactivate instead of deleting.
              if (await staffHasHistory(editing.id)) {
                await archiveStaff(editing.id)
                toast(t.admin.staff.archivedInstead, 'info')
              } else {
                try {
                  await deleteStaff(editing.id)
                  toast(t.admin.staff.delete, 'success')
                } catch {
                  await archiveStaff(editing.id)
                  toast(t.admin.staff.archivedInstead, 'info')
                }
              }
              setEditing(null)
              load()
            } catch (e) {
              toast(errorMessage(e), 'error')
            }
          } : undefined}
        />
      )}
    </div>
  )
}

function StaffEditor({
  staff,
  onClose,
  onSave,
  onDelete,
}: {
  staff: Staff | null
  onClose: () => void
  onSave: (name: string, role: string, phone: string, active: boolean) => void
  onDelete?: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(staff?.full_name ?? '')
  const [roleVal, setRoleVal] = useState(staff?.role ?? 'housekeeper')
  const [phone, setPhone] = useState(staff?.phone ?? '')
  const [active, setActive] = useState(staff?.active ?? true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
      <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{staff ? t.admin.staff.title : t.admin.staff.add}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.staff.name}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.staff.role}</label>
            <select value={roleVal} onChange={(e) => setRoleVal(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none">
              <option value="housekeeper">{t.admin.staff.roleHousekeeper}</option>
              <option value="other">{t.admin.staff.roleOther}</option>
              {roleVal !== 'housekeeper' && roleVal !== 'other' && <option value={roleVal}>{roleVal}</option>}
            </select>
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.staff.phone}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20123456789" className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          {staff && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-ink">{t.admin.staff.active}</span>
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
            onClick={() => onSave(name.trim(), roleVal.trim(), phone.trim(), active)}
            disabled={!name.trim()}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            {t.admin.staff.save}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t.admin.staff.confirmDelete}
        onConfirm={() => { setConfirmDelete(false); onDelete?.() }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
