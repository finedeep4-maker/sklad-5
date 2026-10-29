import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const ALLOWED = process.env.E2E_ALLOW === '1'
const SUPA_URL = process.env.E2E_SUPABASE_URL!
const SUPA_ANON = process.env.E2E_SUPABASE_ANON_KEY!
const DISABLED_LOGIN = process.env.E2E_DISABLED_LOGIN
const DISABLED_PW = process.env.E2E_DISABLED_PASSWORD

test.skip(!ALLOWED, 'E2E_ALLOW=1 required')

async function login(page: Page, login: string, password: string) {
  await page.goto('/')
  await page.getByTestId('login-form').waitFor()
  await page.fill('input[name="username"]', login)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
}

test.describe('Access control', () => {
  test('self-registered account has no data access and cannot enter app', async ({ page }) => {
    const c = createClient(SUPA_URL, SUPA_ANON)
    const loginName = `e2e_self_${Date.now()}`
    const email = `${loginName}@sklad.internal`
    const { data, error } = await c.auth.signUp({ email, password: 'TestPass123!' })
    expect(error).toBeNull()
    // If email confirmation is enabled, there's no session — skip
    if (!data.session) {
      test.skip(true, 'Email confirmation is enabled — signUp did not produce a session')
      return
    }

    // Verify this account cannot read apartment data
    const { data: aptData, error: aptErr } = await c.from('apartments').select('id').limit(1)
    expect(aptErr || aptData).toBeTruthy()
    if (!aptErr) {
      expect(aptData).toHaveLength(0)
    }

    // Verify privileged RPCs are blocked
    const { error: cleanErr } = await c.rpc('complete_cleaning', {
      p_apartment_id: 1,
      p_cleaned_at: new Date().toISOString(),
      p_client_op_id: '00000000-0000-0000-0000-000000000000',
      p_staff_ids: [],
      p_lead_staff_id: null,
      p_note: 'test',
    })
    expect(cleanErr).toBeTruthy()

    const { error: moveErr } = await c.rpc('post_move', {
      p_op: 'receipt',
      p_item: 1,
      p_qty: 1,
    })
    expect(moveErr).toBeTruthy()

    // Verify via UI: login stays on the login screen
    await login(page, loginName, 'TestPass123!')
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 10000 })
    await expect(page).not.toHaveURL(/\/(admin|sv)/)
  })

  test('disabled account cannot sign in', async ({ page }) => {
    if (!DISABLED_LOGIN || !DISABLED_PW) {
      test.skip(true, 'E2E_DISABLED_LOGIN / E2E_DISABLED_PASSWORD not set')
      return
    }

    await login(page, DISABLED_LOGIN, DISABLED_PW)
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 10000 })
    await expect(page).not.toHaveURL(/\/(admin|sv)/)
  })
})
