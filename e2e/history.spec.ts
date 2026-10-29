import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const ALLOWED = process.env.E2E_ALLOW === '1'
const SUPA_URL = process.env.E2E_SUPABASE_URL!
const SUPA_ANON = process.env.E2E_SUPABASE_ANON_KEY!
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN!
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD!
const SV_LOGIN = process.env.E2E_SV_LOGIN!
const SV_PW = process.env.E2E_SV_PASSWORD!
const QR_APARTMENT_ID = process.env.E2E_QR_APARTMENT_ID!

test.skip(!ALLOWED, 'E2E_ALLOW=1 required')

async function login(page: Page, login: string, password: string) {
  await page.goto('/')
  await page.getByTestId('login-form').waitFor()
  await page.fill('input[name="username"]', login)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
}

async function adminClient() {
  const c = createClient(SUPA_URL, SUPA_ANON)
  const email = `${ADMIN_LOGIN.toLowerCase().trim()}@sklad.internal`
  const { error } = await c.auth.signInWithPassword({ email, password: ADMIN_PW })
  if (error) throw error
  return c
}

async function svClient() {
  const c = createClient(SUPA_URL, SUPA_ANON)
  const email = `${SV_LOGIN.toLowerCase().trim()}@sklad.internal`
  const { error } = await c.auth.signInWithPassword({ email, password: SV_PW })
  if (error) throw error
  return c
}

/**
 * Creates a cleaning event via RPC with a real staff member.
 * Returns the event row from sv_cleaning_events.
 * Skips the test if no active staff exist.
 */
async function createCleaning(c: Awaited<ReturnType<typeof adminClient>>, apartmentId: number, note: string) {
  const { data: staff, error: staffErr } = await c.from('sv_staff').select('id').limit(1)
  if (staffErr) throw staffErr
  if (!staff || staff.length === 0) {
    test.skip(true, 'No staff in sv_staff — complete_cleaning needs at least one staff member')
    return { clientOpId: '', eventId: '' }
  }
  const staffId = staff[0].id
  const clientOpId = randomUUID()
  const cleanedAt = new Date().toISOString()
  const { data, error } = await c.rpc('complete_cleaning', {
    p_apartment_id: apartmentId,
    p_cleaned_at: cleanedAt,
    p_client_op_id: clientOpId,
    p_staff_ids: [staffId],
    p_lead_staff_id: staffId,
    p_note: note,
  })
  if (error) throw error
  const eventId = (data as { event_id?: string }).event_id ?? ''
  return { clientOpId, eventId }
}

async function gotoHistory(page: Page) {
  await page.goto('/admin/more/history')
  await expect(page.getByTestId('history-filters')).toBeVisible({ timeout: 15000 })
}

async function waitForListLoaded(page: Page) {
  await expect(page.getByTestId('list-loading')).toBeHidden({ timeout: 15000 })
}

test.describe('History', () => {
  test('admin can open history page', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
    await gotoHistory(page)
    await expect(page.getByTestId('history-filters')).toBeVisible({ timeout: 10000 })
  })

  test('search filters by text', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
    await gotoHistory(page)

    const toggle = page.getByTestId('filters-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()

    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill('zzz-no-match-xyz')
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card')).toHaveCount(0, { timeout: 8000 })
    await expect(page.getByTestId('list-empty')).toBeVisible({ timeout: 5000 })
  })

  test('date filter narrows results', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
    await gotoHistory(page)

    const toggle = page.getByTestId('filters-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()

    const dateFrom = page.getByTestId('date-from')
    await expect(dateFrom).toBeVisible({ timeout: 5000 })
    await dateFrom.fill('2099-01-01')
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card')).toHaveCount(0, { timeout: 8000 })
    await expect(page.getByTestId('list-empty')).toBeVisible({ timeout: 5000 })
  })

  // Note: deletion does NOT reverse stock_moves (journal is append-only).
  // Only run on a test project — the operation is irreversible.
  test('admin can open a cleaning card and delete with reason', async ({ page }) => {
    const c = await adminClient()
    const aptId = Number(QR_APARTMENT_ID)
    const uniqueNote = `e2e-delete-${Date.now()}`
    const { clientOpId, eventId } = await createCleaning(c, aptId, uniqueNote)

    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
    await gotoHistory(page)

    const toggle = page.getByTestId('filters-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()

    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill(uniqueNote)
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card')).toHaveCount(1, { timeout: 10000 })

    const card = page.getByTestId('cleaning-card').first()
    await card.click()

    const detail = page.getByTestId('cleaning-detail')
    await expect(detail).toBeVisible({ timeout: 5000 })

    const deleteBtn = detail.getByTestId('cleaning-delete-btn')
    await expect(deleteBtn).toBeVisible({ timeout: 3000 })
    await deleteBtn.click()

    const reasonField = page.getByTestId('delete-reason')
    await expect(reasonField).toBeVisible({ timeout: 3000 })
    await reasonField.fill('e2e test deletion')

    const confirmDelete = page.getByTestId('confirm-delete')
    await expect(confirmDelete).toBeVisible()
    await confirmDelete.click()

    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card')).toHaveCount(0, { timeout: 10000 })

    // Verify the row is actually gone from the database
    const { data: row } = await c
      .from('cleaning_events')
      .select('id')
      .eq('id', eventId)
      .maybeSingle()
    expect(row).toBeNull()

    // Also verify by client_op_id
    const { data: rowByOp } = await c
      .from('cleaning_events')
      .select('id')
      .eq('client_op_id', clientOpId)
      .maybeSingle()
    expect(rowByOp).toBeNull()
  })

  test('supervisor has no delete button', async ({ page }) => {
    const c = await svClient()
    const aptId = Number(QR_APARTMENT_ID)
    const uniqueNote = `e2e-sv-nodelete-${Date.now()}`
    await createCleaning(c, aptId, uniqueNote)

    await login(page, SV_LOGIN, SV_PW)
    await expect(page).toHaveURL(/\/(admin|sv)/, { timeout: 15000 })

    await page.goto(`/qr.html#/qr/${QR_APARTMENT_ID}/history`)
    await expect(page.getByTestId('history-filters')).toBeVisible({ timeout: 15000 })

    const toggle = page.getByTestId('filters-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()

    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill(uniqueNote)
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card').first()).toBeVisible({ timeout: 10000 })

    const card = page.getByTestId('cleaning-card').first()
    await card.click()

    const detail = page.getByTestId('cleaning-detail')
    await expect(detail).toBeVisible({ timeout: 5000 })
    await expect(detail.getByTestId('cleaning-delete-btn')).toHaveCount(0)
  })
})
