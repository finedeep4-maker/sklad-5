import { describe, it, expect } from 'vitest'
import { filterCatalog } from './catalogFilter'

const cats = [
  { id: 1, name: 'Мебель' },
  { id: 2, name: 'Посуда' },
]
const items = [
  { name: 'Стул', category_id: 1 },
  { name: 'Стол', category_id: 1 },
  { name: 'Тарелка', category_id: 2 },
]
// «перевод»: английское название ищется как подстрока
const match = (q: string, base: string, kind: 'item' | 'category') => {
  const en: Record<string, string> = { 'Мебель': 'Furniture', 'Стул': 'Chair', 'Тарелка': 'Plate' }
  void kind
  return `${base} ${en[base] ?? ''}`.toLowerCase().includes(q.toLowerCase())
}

describe('filterCatalog', () => {
  it('empty query keeps every category with all its items', () => {
    const r = filterCatalog(cats, items, '  ', match)
    expect(r.map((g) => g.items.length)).toEqual([2, 1])
    expect(r.every((g) => !g.matched)).toBe(true)
  })

  it('a category hit shows all its items, other categories are hidden', () => {
    const r = filterCatalog(cats, items, 'furniture', match)
    expect(r).toHaveLength(1)
    expect(r[0].category.id).toBe(1)
    expect(r[0].items).toHaveLength(2)
    expect(r[0].matched).toBe(true)
  })

  it('an item hit shows only matching items of its category', () => {
    const r = filterCatalog(cats, items, 'chair', match)
    expect(r).toHaveLength(1)
    expect(r[0].items.map((i) => i.name)).toEqual(['Стул'])
  })

  it('no matches gives an empty list', () => {
    expect(filterCatalog(cats, items, 'zzz', match)).toEqual([])
  })
})
