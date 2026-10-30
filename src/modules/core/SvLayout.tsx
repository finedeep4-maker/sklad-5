import { NavLink, useLocation } from 'react-router-dom'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { Building2, Wrench, Phone, User, LayoutDashboard, QrCode } from 'lucide-react'

import { useAuth } from '@/modules/core/store'

export function SvLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  useDocumentDir()
  const { pathname } = useLocation()
  const profile = useAuth((s) => s.profile)

  const adminLink = profile?.role === 'admin'
    ? { to: '/admin', ariaLabel: t.admin.nav.home, external: false }
    : profile?.role === 'manager'
      ? { to: '/qr.html#/qr', ariaLabel: t.nav.qr, external: true }
      : null

  const tabs = [
    { to: '/sv', icon: Building2, label: t.nav.apartments, end: true },
    { to: '/sv/incidents', icon: Wrench, label: t.nav.incidents },
    { to: '/sv/contacts', icon: Phone, label: t.nav.contacts },
    { to: '/sv/profile', icon: User, label: t.nav.profile },
  ]

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <div className="flex items-center justify-between px-4 h-11 bg-surface border-b border-line sticky top-0 z-30 max-w-lg mx-auto w-full">
        <span className="font-semibold text-ink text-sm">{t.app.name}</span>
        <div className="flex items-center gap-2">
          {adminLink && (
            adminLink.external ? (
              <a
                href={adminLink.to}
                className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
                aria-label={adminLink.ariaLabel}
              >
                <QrCode className="w-4 h-4" />
              </a>
            ) : (
              <NavLink
                to={adminLink.to}
                className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
                aria-label={adminLink.ariaLabel}
              >
                <LayoutDashboard className="w-4 h-4" />
              </NavLink>
            )
          )}
          <LangSwitcher compact />
        </div>
      </div>
      <main className="flex-1 pb-20 max-w-lg mx-auto w-full">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-line z-40">
        <div className="max-w-lg mx-auto flex">
          {tabs.map((tab) => {
            const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to)
            const Icon = tab.icon
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                aria-label={tab.label}
                className="flex-1 flex flex-col items-center gap-0.5 py-3"
                style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom, 0px))' }}
              >
                <Icon
                  className={`w-5 h-5 transition-colors ${active ? 'text-accent' : 'text-muted'}`}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                <span className={`text-[11px] transition-colors ${active ? 'text-accent font-medium' : 'text-muted'}`}>
                  {tab.label}
                </span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
