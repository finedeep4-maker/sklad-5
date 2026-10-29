import { describe, it, expect } from 'vitest'
import { pickName, matchesName, buildNameIndex, localizeName } from './catalogNames'
import type { NameIndex } from './catalogNames'

describe('pickName', () => {
  it('returns base for ru', () => {
    expect(pickName('Матрас', 'Mattress', 'مرتبة', 'ru')).toBe('Матрас')
  })

  it('returns en when non-empty for en', () => {
    expect(pickName('Матрас', 'Mattress', 'مرتبة', 'en')).toBe('Mattress')
  })

  it('returns ar when non-empty for ar', () => {
    expect(pickName('Матрас', 'Mattress', 'مرتبة', 'ar')).toBe('مرتبة')
  })

  it('falls back to base when en is null', () => {
    expect(pickName('Матрас', null, 'مرتبة', 'en')).toBe('Матрас')
  })

  it('falls back to base when ar is empty string', () => {
    expect(pickName('Матрас', 'Mattress', '', 'ar')).toBe('Матрас')
  })
})

describe('matchesName', () => {
  it('returns true for empty query', () => {
    expect(matchesName('', 'Матрас', 'Mattress', 'مرتبة')).toBe(true)
  })

  it('matches base name case-insensitively', () => {
    expect(matchesName('матр', 'Матрас', null, null)).toBe(true)
  })

  it('matches english name', () => {
    expect(matchesName('matt', 'Матрас', 'Mattress', null)).toBe(true)
  })

  it('matches arabic name', () => {
    expect(matchesName('مرت', 'Матрас', 'Mattress', 'مرتبة')).toBe(true)
  })

  it('returns false when no match', () => {
    expect(matchesName('pillow', 'Матрас', 'Mattress', 'مرتبة')).toBe(false)
  })

  it('handles null en and ar', () => {
    expect(matchesName('матрас', 'Матрас', null, null)).toBe(true)
  })
})

describe('buildNameIndex', () => {
  const items = [
    { name: 'Матрас', name_en: 'Mattress', name_ar: 'مرتبة' },
    { name: 'Одеяло', name_en: null, name_ar: 'بطانية' },
  ]
  const categories = [
    { name: 'Мебель', name_en: 'Furniture', name_ar: 'أثاث' },
  ]

  const index = buildNameIndex(items, categories) as NameIndex

  it('indexes items by base name', () => {
    expect(index.items.get('Матрас')).toEqual({ name_en: 'Mattress', name_ar: 'مرتبة' })
  })

  it('indexes categories by base name', () => {
    expect(index.categories.get('Мебель')).toEqual({ name_en: 'Furniture', name_ar: 'أثاث' })
  })

  it('handles null translations', () => {
    expect(index.items.get('Одеяло')).toEqual({ name_en: null, name_ar: 'بطانية' })
  })
})

describe('localizeName', () => {
  const index = buildNameIndex(
    [{ name: 'Матрас', name_en: 'Mattress', name_ar: 'مرتبة' }],
    [{ name: 'Мебель', name_en: 'Furniture', name_ar: 'أثاث' }],
  )

  it('returns localized item name for en', () => {
    expect(localizeName(index, 'item', 'Матрас', 'en')).toBe('Mattress')
  })

  it('returns localized category name for ar', () => {
    expect(localizeName(index, 'category', 'Мебель', 'ar')).toBe('أثاث')
  })

  it('returns base when item not in index', () => {
    expect(localizeName(index, 'item', 'Подушка', 'en')).toBe('Подушка')
  })

  it('returns base for ru', () => {
    expect(localizeName(index, 'item', 'Матрас', 'ru')).toBe('Матрас')
  })
})
