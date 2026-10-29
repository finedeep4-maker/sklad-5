import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { Users, Wrench, Phone, ExternalLink, CircleUser as UserCircle, ChevronRight, ClipboardList, FolderTree, FileText, ShoppingCart, ClipboardCheck, QrCode, ChartBar as BarChart3, History, BadgeCheck } from 'lucide-react'
import { useAuth } from '@/modules/core/store'

export function AdminMore() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const signOut = useAuth((s) => s.signOut)
  const profile = useAuth((s) => s.profile)

  const items = [
    { icon: FolderTree, label: t.admin.more.catalog, path: '/admin/more/catalog' },
    { icon: UserCircle, label: t.admin.more.staff, path: '/admin/more/staff' },
    { icon: Users, label: t.admin.more.users, path: '/admin/more/users' },
    { icon: Wrench, label: t.admin.more.incidents, path: '/admin/more/incidents' },
    { icon: BadgeCheck, label: t.admin.more.cleaningApprovals, path: '/admin/more/cleaning-approvals' },
    { icon: Phone, label: t.admin.more.contacts, path: '/admin/more/contacts' },
    { icon: ClipboardList, label: t.admin.more.normTemplates, path: '/admin/more/norm-templates' },
    { icon: ShoppingCart, label: t.admin.more.orders, path: '/admin/more/orders' },
    { icon: ClipboardCheck, label: t.admin.more.inventory, path: '/admin/more/inventory' },
    { icon: FileText, label: t.admin.more.documents, path: '/admin/more/documents' },
    { icon: QrCode, label: t.admin.more.qr, path: '/admin/more/qr' },
    { icon: BarChart3, label: t.admin.more.reports, path: '/admin/more/reports' },
    { icon: History, label: t.admin.more.history, path: '/admin/more/history' },
  ]

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.more.title}</h1>

      <div className="bg-surface rounded-xl border border-line divide-y divide-[var(--line)] mb-4">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-app transition-colors"
            >
              <Icon className="w-5 h-5 text-muted" />
              <span className="flex-1 text-sm text-ink">{item.label}</span>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>
          )
        })}
      </div>

      <button
        onClick={() => navigate('/sv')}
        className="w-full bg-surface rounded-xl border border-line px-4 py-3.5 flex items-center gap-3 text-left hover:bg-app transition-colors"
      >
        <ExternalLink className="w-5 h-5 text-accent" />
        <span className="flex-1 text-sm text-accent font-medium">{t.admin.more.openAsSv}</span>
      </button>

      {profile && (
        <div className="mt-6">
          <div className="bg-surface rounded-xl border border-line px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{profile.full_name}</p>
              <p className="text-xs text-muted">{profile.login}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full mt-3 bg-surface border border-line text-bad rounded-xl py-3 font-medium"
          >
            {t.profile.logout}
          </button>
        </div>
      )}
    </div>
  )
}
