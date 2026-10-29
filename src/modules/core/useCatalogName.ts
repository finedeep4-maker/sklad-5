import { useMemo } from 'react'
import { useI18n } from '@/i18n'
import { useCatalogNames } from './catalogNamesStore'
import { localizeName, matchesName } from '@/lib/catalogNames'

export function useCatalogName() {
  const { lang } = useI18n()
  const index = useCatalogNames((s) => s.index)

  return useMemo(
    () => ({
      itemName: (base: string) => localizeName(index, 'item', base, lang),
      categoryName: (base: string) => localizeName(index, 'category', base, lang),
      matches: (query: string, base: string, kind: 'item' | 'category') => {
        const map = kind === 'item' ? index.items : index.categories
        const entry = map.get(base)
        return matchesName(query, base, entry?.name_en ?? null, entry?.name_ar ?? null)
      },
    }),
    [index, lang],
  )
}
