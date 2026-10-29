import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const ALLOWED = process.env.E2E_ALLOW === '1'
const SUPA_URL = process.env.E2E_SUPABASE_URL!
const SUPA_ANON = process.env.E2E_SUPABASE_ANON_KEY!
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN!
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD!
const SV_LOGIN = process.env.E2E_SV_LOGIN!
const SV_PW = process.env.E2E_SV_PASSWORD!

test.skip(!ALLOWED, 'E2E_ALLOW=1 required')

function anonClient() {
  return createClient(SUPA_URL, SUPA_ANON)
}

async function svClient() {
  const c = createClient(SUPA_URL, SUPA_ANON)
  const email = `${SV_LOGIN.toLowerCase().trim()}@sklad.internal`
  await c.auth.signInWithPassword({ email, password: SV_PW })
  return c
}

async function adminClient() {
  const c = createClient(SUPA_URL, SUPA_ANON)
  const email = `${ADMIN_LOGIN.toLowerCase().trim()}@sklad.internal`
  await c.auth.signInWithPassword({ email, password: ADMIN_PW })
  return c
}

const ALLOWED_ERROR_CODES = ['42501', 'PGRST202']

function expectBlocked(error: unknown) {
  expect(error).toBeTruthy()
  const code = (error as { code?: string }).code
  expect(ALLOWED_ERROR_CODES).toContain(code)
}

test.describe('Security — anon', () => {
  test('privileged RPCs are blocked for anon', async () => {
    const c = anonClient()
    const { error: e1 } = await c.rpc('_insert_move' as never, {
      p_item: 1, p_from: 1, p_to: 2, p_qty: 1, p_cost: null,
      p_src: 'manual', p_src_id: null, p_apt: null, p_staff: null,
      p_doc: null, p_note: null, p_moved: new Date().toISOString(),
      p_reverses: null,
    } as never)
    expectBlocked(e1)
    const { error: e2 } = await c.rpc('_next_doc_number' as never, {
      p_type: 'receipt',
    } as never)
    expectBlocked(e2)
    const { error: e3 } = await c.rpc('post_move' as never, {
      p_op: 'receipt', p_item: 1, p_qty: 1,
    } as never)
    expectBlocked(e3)
  })

  test('needs_bootstrap works for anon', async () => {
    const c = anonClient()
    const { data, error } = await c.rpc('needs_bootstrap')
    expect(error).toBeNull()
    expect(typeof data).toBe('boolean')
  })
})

test.describe('Security — supervisor', () => {
  test('privileged RPCs are blocked for supervisor', async () => {
    const c = await svClient()
    const { error: e1 } = await c.rpc('_insert_move' as never, {
      p_item: 1, p_from: 1, p_to: 2, p_qty: 1, p_cost: null,
      p_src: 'manual', p_src_id: null, p_apt: null, p_staff: null,
      p_doc: null, p_note: null, p_moved: new Date().toISOString(),
      p_reverses: null,
    } as never)
    expectBlocked(e1)
    const { error: e2 } = await c.rpc('_reverse_cleaning_moves' as never, {
      p_event: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test',
    } as never)
    expectBlocked(e2)
    const { error: e3 } = await c.rpc('post_document' as never, {
      p_op: 'receipt', p_lines: [{ item_id: 1, qty: 1 }],
    } as never)
    expect(e3).toBeTruthy()
    expect((e3 as { code?: string }).code).toBe('42501')

    const { error: e4 } = await c.rpc('post_move' as never, {
      p_op: 'receipt', p_item: 1, p_qty: 1,
    } as never)
    expect(e4).toBeTruthy()
    expect((e4 as { code?: string }).code).toBe('42501')
  })

  test('supervisor cannot read stock_moves or items', async () => {
    const c = await svClient()
    const { data: sm, error: sme } = await c.from('stock_moves').select()
    if (sme) {
      expect(sme).toBeTruthy()
    } else {
      expect(sm).toHaveLength(0)
    }
    const { data: it, error: ite } = await c.from('items').select()
    if (ite) {
      expect(ite).toBeTruthy()
    } else {
      expect(it).toHaveLength(0)
    }
  })

  test('supervisor cannot update events.processed_at', async () => {
    const c = await svClient()
    const admin = await adminClient()

    const { data: ev } = await admin
      .from('events')
      .select('id,processed_at')
      .order('id', { ascending: false })
      .limit(1)
      .single()

    const targetId = ev?.id ?? 999999
    const beforeValue = ev?.processed_at ?? null

    const { error } = await c
      .from('events')
      .update({ processed_at: new Date().toISOString() } as never)
      .eq('id', targetId as never)
    expect(error).toBeTruthy()

    const { data: evAfter } = await admin
      .from('events')
      .select('processed_at')
      .eq('id', targetId)
      .single()
    expect(evAfter?.processed_at).toBe(beforeValue)
  })
})

test.describe('Security — stock_moves integrity', () => {
  test('blocked RPCs do not create stock_moves', async () => {
    const admin = await adminClient()

    const { count: before } = await admin
      .from('stock_moves')
      .select('id', { count: 'exact', head: true })

    const c = await svClient()
    try {
      await c.rpc('_insert_move' as never, {
        p_item: 1, p_from: 1, p_to: 2, p_qty: 1, p_cost: null,
        p_src: 'manual', p_src_id: null, p_apt: null, p_staff: null,
        p_doc: null, p_note: null, p_moved: new Date().toISOString(),
        p_reverses: null,
      } as never)
    } catch {
      // RPC must be blocked; any error is fine
    }

    const { count: after } = await admin
      .from('stock_moves')
      .select('id', { count: 'exact', head: true })

    expect(after).toBe(before)
  })
})
