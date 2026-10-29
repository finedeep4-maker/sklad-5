import { useI18n } from '@/i18n'

export function OwnerBadge({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-owner-soft text-owner ${className}`}>
      {t.admin.apartments.owner}
    </span>
  )
}
