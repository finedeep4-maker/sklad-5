import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n, currentDict } from '@/i18n'
import { toast, errorMessage } from '@/lib/toast'
import { Plus, Trash2, Eye, EyeOff, Copy, Check, X, Lock, CreditCard as Edit3, Shield, QrCode, UserCheck, ShieldCheck } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import type { AppRole } from '@/lib/database.types'

const EDGE_ERROR_CODES = new Set([
  'weak_password', 'invalid_login', 'name_too_long', 'login_taken', 'create_failed', 'update_failed',
])

function mapEdgeError(code: string, serverMessage: string | undefined): string {
  const d = currentDict()
  switch (code) {
    case 'weak_password':
      return serverMessage ? `${d.admin.users.errWeakPassword}: ${serverMessage}` : d.admin.users.errWeakPassword
    case 'invalid_login':
      return d.admin.users.errInvalidLogin
    case 'name_too_long':
      return d.admin.users.errNameTooLong
    case 'login_taken':
      return d.admin.users.errLoginTaken
    case 'create_failed':
      return d.admin.users.errCreateFailed
    case 'update_failed':
      return d.admin.users.errUpdateFailed
    default:
      return serverMessage ?? code
  }
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (!error && data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    const bodyData = data as { error: string; message?: string }
    if (EDGE_ERROR_CODES.has(bodyData.error)) {
      throw new Error(mapEdgeError(bodyData.error, bodyData.message))
    }
    throw new Error(bodyData.error)
  }
  if (!error) return (data ?? {}) as Record<string, unknown>
  const context = (error as { context?: Response }).context
  if (context instanceof Response) {
    try {
      const text = await context.text()
      if (text) {
        const bodyData = JSON.parse(text) as { error?: string; message?: string; code?: string }
        const code = bodyData.error ?? bodyData.code
        if (code) {
          if (EDGE_ERROR_CODES.has(code)) {
            throw new Error(mapEdgeError(code, bodyData.message))
          }
          throw new Error(code)
        }
        if (bodyData.message) throw new Error(bodyData.message)
      }
    } catch (extracted) {
      if (extracted instanceof Error) throw extracted
    }
  }
  throw error
}

interface AdminUser {
  id: string
  login: string
  full_name: string
  role: AppRole
  active: boolean
  created_at: string
}

const ROLE_BADGE: Record<AppRole, { bg: string; text: string; icon: typeof Shield }> = {
  admin: { bg: 'bg-warn-soft', text: 'text-warn', icon: Shield },
  manager: { bg: 'bg-accent-soft', text: 'text-accent', icon: QrCode },
  supervisor: { bg: 'bg-ok-soft', text: 'text-ok', icon: UserCheck },
}

export function UsersPage() {
  const { t } = useI18n()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<{ login: string; password: string } | null>(null)
  const [copied, setCopied] = useState<'login' | 'password' | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [roleFilter, setRoleFilter] = useState<AppRole | 'all'>('all')
  const [changingRole, setChangingRole] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<string | null>(null)
  const [pwTarget, setPwTarget] = useState<AdminUser | null>(null)
  const [pwValue, setPwValue] = useState('')
  const [pwShow, setPwShow] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const load = async () => {
    try {
      const data = await invokeAdminUsers({ action: 'list' })
      setUsers((data.users ?? []) as AdminUser[])
      setLoadError(false)
    } catch (e) {
      setLoadError(true)
      toast(errorMessage(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSetActive = async (id: string, active: boolean) => {
    try {
      await invokeAdminUsers({ action: 'set_active', id, active: !active })
      toast(active ? t.admin.users.inactive : t.admin.users.active, 'success')
      load()
    } catch (e) {
      const msg = errorMessage(e)
      if (msg === 'self_deactivate') toast(t.admin.users.selfDeactivateError, 'error')
      else if (msg === 'last_admin') toast(t.admin.users.lastAdminError, 'error')
      else toast(msg, 'error')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await invokeAdminUsers({ action: 'delete', id })
      toast(t.admin.users.delete, 'success')
      load()
    } catch (e) {
      const msg = errorMessage(e)
      if (msg === 'self_delete') toast(t.admin.users.selfDeleteError, 'error')
      else if (msg === 'last_admin') toast(t.admin.users.lastAdminError, 'error')
      else toast(msg, 'error')
    }
  }

  const handleRoleChange = async (id: string, role: AppRole) => {
    try {
      await invokeAdminUsers({ action: 'set_role', id, role })
      toast(t.admin.users.roleChanged, 'success')
      load()
    } catch (e) {
      const msg = errorMessage(e)
      if (msg === 'last_admin') toast(t.admin.users.lastAdminError, 'error')
      else toast(msg, 'error')
    }
  }

  const submitPassword = async () => {
    if (!pwTarget || pwBusy) return
    if (pwValue.length < 8) { toast(t.admin.users.errWeakPassword, 'error'); return }
    setPwBusy(true)
    try {
      await invokeAdminUsers({ action: 'set_password', id: pwTarget.id, password: pwValue })
      toast(t.admin.users.passwordChanged, 'success')
      setPwTarget(null)
      setPwValue('')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setPwBusy(false)
    }
  }

  const copy = (text: string, what: 'login' | 'password') => {
    navigator.clipboard.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(null), 2000)
  }

  const roleLabel = (role: AppRole): string => {
    if (role === 'admin') return t.admin.users.filterAdmin
    if (role === 'manager') return t.admin.users.filterManager
    return t.admin.users.filterSupervisor
  }

  const filteredUsers = roleFilter === 'all' ? users : users.filter((u) => u.role === roleFilter)

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (loadError && users.length === 0) return <ErrorState onRetry={() => { setLoading(true); load() }} />

  return (
    <div className="px-4 pt-6 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">{t.admin.users.title}</h1>
        <button
          onClick={() => setAdding(true)}
          className="bg-accent text-white rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          {t.admin.users.add}
        </button>
      </div>

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {(['all', 'admin', 'manager', 'supervisor'] as const).map((rf) => (
          <button
            key={rf}
            onClick={() => setRoleFilter(rf)}
            className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors border ${
              roleFilter === rf ? 'bg-accent border-accent text-white' : 'bg-surface border-line text-muted'
            }`}
          >
            {rf === 'all' ? t.admin.users.filterAll : roleLabel(rf)}
          </button>
        ))}
      </div>

      {filteredUsers.length === 0 ? (
        <p className="text-sm text-muted text-center mt-8">{t.admin.users.noUsers}</p>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map((u) => {
            const badge = ROLE_BADGE[u.role] ?? ROLE_BADGE.supervisor
            const RoleIcon = badge.icon
            return (
              <div key={u.id} className="bg-surface rounded-xl border border-line px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink truncate">{u.full_name}</p>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${badge.bg} ${badge.text}`}>
                        <RoleIcon className="w-3 h-3" />
                        {roleLabel(u.role)}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{u.login}</p>
                  </div>
                  <button
                    onClick={() => (u.active ? setDeactivateTarget(u.id) : handleSetActive(u.id, false))}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium shrink-0 ${u.active ? 'bg-ok-soft text-ok' : 'bg-app text-muted'}`}
                  >
                    {u.active ? t.admin.users.active : t.admin.users.inactive}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPwTarget(u); setPwValue(''); setPwShow(false) }}
                    className="text-xs bg-app text-ink rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Lock className="w-3 h-3" />
                    {t.admin.users.setPassword}
                  </button>
                  <button
                    onClick={() => { setRenaming(u.id); setRenameValue(u.full_name) }}
                    className="text-xs bg-app text-ink rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3 h-3" />
                    {t.admin.users.rename}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(u.id)}
                    className="text-xs bg-bad-soft text-bad rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3 h-3" />
                    {t.admin.users.delete}
                  </button>
                  <button
                    onClick={() => setChangingRole(u.id)}
                    className="text-xs bg-app text-ink rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    {t.admin.users.roleLabel}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <UserCreateForm
          onClose={() => setAdding(false)}
          onCreated={(login, password) => {
            setAdding(false)
            setCreatedCreds({ login, password })
            load()
          }}
        />
      )}

      {deactivateTarget && (
        <ConfirmDialog
          open={true}
          title={t.admin.users.confirmDeactivate}
          onConfirm={() => { const id = deactivateTarget; setDeactivateTarget(null); handleSetActive(id, true) }}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
      {pwTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-ink">{t.admin.users.setPassword}</h3>
              <button onClick={() => setPwTarget(null)}><X className="w-5 h-5 text-muted" /></button>
            </div>
            <p className="text-xs text-muted mb-3">{pwTarget.full_name} · {pwTarget.login}</p>
            <div className="relative mb-4">
              <input
                type={pwShow ? 'text' : 'password'}
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                autoComplete="new-password"
                placeholder={t.admin.users.password}
                className="w-full bg-app rounded-xl pl-4 pr-11 py-2.5 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setPwShow((v) => !v)}
                aria-label={pwShow ? t.admin.users.hidePassword : t.admin.users.showPassword}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
              >
                {pwShow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPwTarget(null)} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
              <button
                onClick={submitPassword}
                disabled={pwBusy || pwValue.length < 8}
                className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40"
              >
                {t.admin.staff.save}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title={t.admin.users.confirmDelete}
          onConfirm={() => { const id = deleteTarget; setDeleteTarget(null); handleDelete(id) }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {renaming && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-ink">{t.admin.users.renameTitle}</h3>
              <button onClick={() => setRenaming(null)}><X className="w-5 h-5 text-muted" /></button>
            </div>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setRenaming(null)} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">
                {t.cleaning.cancel}
              </button>
              <button
                onClick={async () => {
                  try {
                    await invokeAdminUsers({ action: 'rename', id: renaming, full_name: renameValue.trim() })
                    toast(t.admin.users.renamed, 'success')
                    setRenaming(null)
                    load()
                  } catch (e) {
                    toast(errorMessage(e), 'error')
                  }
                }}
                disabled={!renameValue.trim()}
                className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40"
              >
                {t.admin.users.rename}
              </button>
            </div>
          </div>
        </div>
      )}

      {changingRole && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-ink">{t.admin.users.roleLabel}</h3>
              <button onClick={() => setChangingRole(null)}><X className="w-5 h-5 text-muted" /></button>
            </div>
            <div className="space-y-2">
              {(['admin', 'manager', 'supervisor'] as const).map((r) => {
                const badge = ROLE_BADGE[r]
                const RoleIcon = badge.icon
                return (
                  <button
                    key={r}
                    onClick={() => handleRoleChange(changingRole, r)}
                    className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors border ${
                      users.find((u) => u.id === changingRole)?.role === r ? 'border-accent bg-accent-soft' : 'border-line bg-app hover:bg-surface'
                    }`}
                  >
                    <RoleIcon className={`w-4 h-4 ${badge.text}`} />
                    <span className="text-sm text-ink">{roleLabel(r)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {createdCreds && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-ink">{t.admin.users.credentialsTitle}</h3>
              <button onClick={() => setCreatedCreds(null)}><X className="w-5 h-5 text-muted" /></button>
            </div>
            <p className="text-sm text-warn bg-warn-soft rounded-xl px-3 py-2.5 mb-4">{t.admin.users.credentialsHint}</p>
            <div className="space-y-3">
              <div className="bg-app rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted">{t.admin.users.login}</p>
                  <p className="text-sm font-medium text-ink">{createdCreds.login}</p>
                </div>
                <button onClick={() => copy(createdCreds.login, 'login')} className="text-accent">
                  {copied === 'login' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="bg-app rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted">{t.admin.users.password}</p>
                  <p className="text-sm font-medium text-ink">{createdCreds.password}</p>
                </div>
                <button onClick={() => copy(createdCreds.password, 'password')} className="text-accent">
                  {copied === 'password' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button onClick={() => setCreatedCreds(null)} className="w-full mt-4 bg-accent text-white rounded-xl py-3 font-medium">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function UserCreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (login: string, password: string) => void }) {
  const { t } = useI18n()
  const [login, setLogin] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('supervisor')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleCreate = async () => {
    setSubmitting(true)
    try {
      await invokeAdminUsers({ action: 'create', login, full_name: fullName, password, role })
      toast(t.admin.users.created, 'success')
      onCreated(login, password)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const roleOptions: { value: AppRole; label: string }[] = [
    { value: 'admin', label: t.admin.users.filterAdmin },
    { value: 'manager', label: t.admin.users.filterManager },
    { value: 'supervisor', label: t.admin.users.filterSupervisor },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
      <div className="bg-surface rounded-2xl w-full max-w-sm p-5 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{t.admin.users.add}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.users.login}</label>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase())}
              placeholder="a-z 0-9 . _ -"
              className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.users.fullName}</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full bg-app rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.users.roleLabel}</label>
            <div className="flex gap-1.5">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRole(opt.value)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors border ${
                    role === opt.value ? 'bg-accent border-accent text-white' : 'bg-app border-line text-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-ink mb-1">{t.admin.users.password}</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.admin.users.passwordAny}
                className="w-full bg-app rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none"
              />
              <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 bg-app text-ink rounded-xl py-3 font-medium">{t.cleaning.cancel}</button>
          <button
            onClick={handleCreate}
            disabled={submitting || !login.trim() || !fullName.trim() || !password}
            className="flex-1 bg-accent text-white rounded-xl py-3 font-medium disabled:opacity-40"
          >
            {t.admin.users.add}
          </button>
        </div>
      </div>
    </div>
  )
}
