import type { Lang } from '@/i18n'

export interface NameIndex {
  items: Map<string, { name_en: string | null; name_ar: string | null }>
  categories: Map<string, { name_en: string | null; name_ar: string | null }>
}

export function pickName(
  base: string,
  en: string | null,
  ar: string | null,
  lang: Lang,
): string {
  if (lang === 'en' && en) return en
  if (lang === 'ar' && ar) return ar
  return base
}

export function matchesName(
  query: string,
  base: string,
  en: string | null,
  ar: string | null,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    base.toLowerCase().includes(q) ||
    (en != null && en.toLowerCase().includes(q)) ||
    (ar != null && ar.toLowerCase().includes(q))
  )
}

export function buildNameIndex(
  items: Array<{ name: string; name_en: string | null; name_ar: string | null }>,
  categories: Array<{ name: string; name_en: string | null; name_ar: string | null }>,
): NameIndex {
  const itemMap = new Map<string, { name_en: string | null; name_ar: string | null }>()
  for (const it of items) {
    itemMap.set(it.name, { name_en: it.name_en, name_ar: it.name_ar })
  }
  const catMap = new Map<string, { name_en: string | null; name_ar: string | null }>()
  for (const c of categories) {
    catMap.set(c.name, { name_en: c.name_en, name_ar: c.name_ar })
  }
  return { items: itemMap, categories: catMap }
}

export function localizeName(
  index: NameIndex,
  kind: 'item' | 'category',
  base: string,
  lang: Lang,
): string {
  const map = kind === 'item' ? index.items : index.categories
  const entry = map.get(base)
  if (!entry) return base
  return pickName(base, entry.name_en, entry.name_ar, lang)
}
