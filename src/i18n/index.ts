import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ru } from './ru'
import { en } from './en'
import { ar } from './ar'
import type { Dict } from './ru'

export type Lang = 'ru' | 'en' | 'ar'

const dicts: Record<Lang, Dict> = { ru, en, ar }

const arabicIndic = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

export function convertNumbers(text: string, lang: Lang): string {
  if (lang !== 'ar') return text
  return text.replace(/[0-9]/g, (d) => arabicIndic[Number(d)])
}

interface I18nState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      lang: 'ru',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'lang' },
  ),
)

export function useI18n(): { t: Dict; lang: Lang; setLang: (l: Lang) => void; n: (s: string) => string } {
  const lang = useI18nStore((s) => s.lang)
  const setLang = useI18nStore((s) => s.setLang)
  // A stale/corrupt persisted value must not make dicts[lang] undefined (white screen).
  const safeLang: Lang = lang in dicts ? lang : 'ru'
  const t = dicts[safeLang]
  const n = (s: string) => convertNumbers(s, safeLang)
  return { t, lang: safeLang, setLang, n }
}

export function currentLang(): Lang {
  const lang = useI18nStore.getState().lang
  return lang in dicts ? lang : 'ru'
}

export function currentDict(): Dict {
  return dicts[currentLang()]
}

export function useDocumentDir(): void {
  const lang = useI18nStore((s) => s.lang)
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
  }, [lang])
}
