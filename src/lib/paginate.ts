const PAGE_SIZE = 1000

export function chunk<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllPages<T>(buildQuery: (rangeFrom: number, rangeTo: number) => PromiseLike<any>): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await buildQuery(start, start + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}
