import { useI18n, type Lang } from '@/i18n'

const langs: { code: Lang; label: string; flag: string }[] = [
  { code: 'ru', label: 'RU', flag: '🇷🇺' },
  { code: 'en', label: 'EN', flag: '🇬🇧' },
  { code: 'ar', label: 'AR', flag: '🇪🇬' },
]

export function LangSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n()

  if (compact) {
    return (
      <div className="inline-flex bg-surface border border-line rounded-lg p-0.5">
        {langs.map((l) => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              lang === l.code ? 'bg-accent text-white' : 'text-muted'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="inline-flex bg-surface border border-line rounded-lg p-0.5">
      {langs.map((l) => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
            lang === l.code ? 'bg-accent text-white' : 'text-muted'
          }`}
        >
          <span>{l.flag}</span>
          <span className="font-medium">{l.label}</span>
        </button>
      ))}
    </div>
  )
}
