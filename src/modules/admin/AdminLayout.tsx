import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { Chrome as Home, Package, Plus, Building2, MoveHorizontal as MoreHorizontal, ArrowLeft } from 'lucide-react'


export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  useDocumentDir()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // Sub-pages of "More" (one level below it) get a common back link; two pages already have their own header with one.
  const showBack = /^\/admin\/more\/[^/]+$/.test(pathname) && pathname !== '/admin/more/norm-templates'

  const tabs = [
    { to: '/admin', icon: Home, label: t.admin.nav.home, end: true },
    { to: '/admin/stock', icon: Package, label: t.admin.nav.stock },
    { to: '/admin/move', icon: Plus, label: t.admin.nav.move, end: true },
    { to: '/admin/apartments', icon: Building2, label: t.admin.nav.apartments },
    { to: '/admin/more', icon: MoreHorizontal, label: t.admin.nav.more },
  ]

  return (
    <div className="min-h-screen bg-app flex flex-col lg:grid lg:grid-cols-[208px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col bg-surface border-r border-line sticky top-0 h-screen p-5 pb-8 no-print">
        <div className="flex items-center justify-between px-2.5 pb-4.5">
          <span className="font-semibold text-lg text-ink">{t.app.name}</span>
          <LangSwitcher compact />
        </div>
        <nav className="flex flex-col gap-0.5">
          {tabs.map((tab) => {
            const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to)
            const Icon = tab.icon
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={`flex items-center gap-2.5 w-full px-2.5 py-2.5 rounded-lg text-left transition-colors ${
                  active
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'text-muted hover:bg-app'
                }`}
              >
                <Icon className="w-5 h-5 flex-none" strokeWidth={active ? 2.2 : 1.8} />
                <span className="text-sm">{tab.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:px-7 lg:py-6 pb-24 lg:pb-8 max-w-[1180px] w-full">
        {/* Mobile top bar with language switcher */}
        <div className="lg:hidden flex items-center justify-between px-4 h-11 bg-surface border-b border-line sticky top-0 z-30 no-print">
          <span className="font-semibold text-ink text-sm">{t.app.name}</span>
          <LangSwitcher compact />
        </div>
        {showBack && (
          <button
            onClick={() => navigate('/admin/more')}
            aria-label={t.common.back}
            className="flex items-center gap-1.5 px-4 pt-4 -mb-2 text-sm text-muted hover:text-accent lg:px-0 lg:pt-0 lg:mb-2 no-print"
          >
            <ArrowLeft className="w-4 h-4" />
            {t.common.back}
          </button>
        )}
        {children}
      </main>

      {/* Mobile bottom bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line z-50 flex no-print">
        {tabs.map((tab) => {
          const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to)
          const Icon = tab.icon
          const isPlus = tab.to === '/admin/move'
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              aria-label={tab.label}
              className="flex-1 flex flex-col items-center gap-0.5 py-2"
              style={{ paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {isPlus ? (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center -mt-1 transition-colors ${active ? 'bg-accent' : 'bg-[var(--line)]'}`}>
                  <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
              ) : (
                <Icon
                  className={`w-5 h-5 transition-colors ${active ? 'text-accent' : 'text-muted'}`}
                  strokeWidth={active ? 2.2 : 1.8}
                />
              )}
              <span className={`text-[10px] transition-colors ${active ? 'text-accent font-medium' : 'text-muted'}`}>
                {tab.label}
              </span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
