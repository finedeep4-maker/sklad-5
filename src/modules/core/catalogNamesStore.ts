import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { fetchAllPages } from '@/lib/paginate'
import { buildNameIndex, type NameIndex } from '@/lib/catalogNames'

interface CatalogNamesStore {
  index: NameIndex
  loaded: boolean
  load: () => Promise<void>
}

const emptyIndex: NameIndex = { items: new Map(), categories: new Map() }

export const useCatalogNames = create<CatalogNamesStore>((set) => ({
  index: emptyIndex,
  loaded: false,

  load: async () => {
    try {
      const [items, categories] = await Promise.all([
        fetchAllPages<{ name: string; name_en: string | null; name_ar: string | null }>(
          (from, to) =>
            supabase
              .from('items')
              .select('name,name_en,name_ar')
              .range(from, to),
        ),
        fetchAllPages<{ name: string; name_en: string | null; name_ar: string | null }>(
          (from, to) =>
            supabase
              .from('categories')
              .select('name,name_en,name_ar')
              .range(from, to),
        ),
      ])
      const index = buildNameIndex(items, categories)
      set({ index, loaded: true })
    } catch {
      // keep previous index on error — don't show anything to the user
    }
  },
}))
