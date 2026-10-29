export interface CatalogGroup<C, I> {
  category: C
  items: I[]
  /** true, если категория попала в выдачу из-за поискового запроса */
  matched: boolean
}

type Matcher = (query: string, base: string, kind: 'item' | 'category') => boolean

/**
 * Поиск по каталогу: если совпала категория, показываются все её предметы,
 * иначе только совпавшие предметы; категории без совпадений скрываются.
 */
export function filterCatalog<C extends { id: number; name: string }, I extends { name: string; category_id: number }>(
  categories: C[],
  items: I[],
  query: string,
  match: Matcher,
): CatalogGroup<C, I>[] {
  const q = query.trim()
  const byCat = new Map<number, I[]>()
  for (const it of items) {
    const list = byCat.get(it.category_id) ?? []
    list.push(it)
    byCat.set(it.category_id, list)
  }
  const out: CatalogGroup<C, I>[] = []
  for (const category of categories) {
    const all = byCat.get(category.id) ?? []
    if (!q) {
      out.push({ category, items: all, matched: false })
      continue
    }
    const categoryHit = match(q, category.name, 'category')
    const hits = categoryHit ? all : all.filter((it) => match(q, it.name, 'item'))
    if (categoryHit || hits.length > 0) out.push({ category, items: hits, matched: true })
  }
  return out
}
