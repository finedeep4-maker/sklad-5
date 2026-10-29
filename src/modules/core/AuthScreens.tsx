import { useState } from 'react'
import { useAuth } from '@/modules/core/store'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { Package } from 'lucide-react'


export function BootstrapScreen() {
  const { t } = useI18n()
  useDocumentDir()
  const { bootstrap } = useAuth()
  const error = useAuth((s) => s.error)
  const [login, setLogin] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    bootstrap(login, fullName, password)
  }

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center px-6" data-theme="dark">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <LangSwitcher />
        </div>
        <div className="flex items-center gap-3 justify-center mb-8">
          <Package className="w-8 h-8 text-accent" />
          <span className="text-2xl font-semibold text-ink">{t.app.name}</span>
        </div>
        <h1 className="text-lg text-muted text-center mb-6">{t.auth.bootstrapTitle}</h1>
        <form onSubmit={submit} className="space-y-4">
          <Input label={t.auth.bootstrapName} value={fullName} onChange={setFullName} name="fullName" autoComplete="name" />
          <Input label={t.auth.bootstrapLogin} value={login} onChange={setLogin} name="username" autoComplete="username" />
          <Input label={t.auth.bootstrapPassword} value={password} onChange={setPassword} type="password" name="new-password" autoComplete="new-password" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <button type="submit" className="w-full bg-accent text-white rounded-xl py-3 font-medium transition-opacity hover:opacity-90">
            {t.auth.bootstrapSubmit}
          </button>
        </form>
      </div>
    </div>
  )
}

export function LoginScreen({ title, subtitle }: { title?: string; subtitle?: string } = {}) {
  const { t } = useI18n()
  useDocumentDir()
  const { signIn } = useAuth()
  const error = useAuth((s) => s.error)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    signIn(login, password)
  }

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center px-6" data-theme="dark">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <LangSwitcher />
        </div>
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 bg-accent rounded-2xl flex items-center justify-center">
            <Package className="w-7 h-7 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-ink">{title ?? t.auth.loginTitle}</h1>
            <p className="text-sm text-muted mt-1">{subtitle ?? t.auth.loginSubtitle}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4" data-testid="login-form">
          <Input label={t.auth.login} value={login} onChange={setLogin} name="username" autoComplete="username" />
          <Input label={t.auth.password} value={password} onChange={setPassword} type="password" name="password" autoComplete="current-password" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <button type="submit" className="w-full bg-accent text-white rounded-xl py-3 font-medium transition-opacity hover:opacity-90">
            {t.auth.loginSubmit}
          </button>
        </form>
      </div>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  name,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  name: string
  autoComplete: string
}) {
  return (
    <label className="block">
      <span className="block text-sm text-muted mb-1.5">{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface text-ink rounded-xl px-4 py-3 border border-line focus:border-accent focus:outline-none transition-colors"
      />
    </label>
  )
}
