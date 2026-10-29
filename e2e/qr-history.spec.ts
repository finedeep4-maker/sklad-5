import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ALLOWED = process.env.E2E_ALLOW === '1'
const SUPA_URL = process.env.E2E_SUPABASE_URL!
const SUPA_ANON = process.env.E2E_SUPABASE_ANON_KEY!
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN!
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD!
const QR_APARTMENT_ID = process.env.E2E_QR_APARTMENT_ID!

// The history page is switched off by QR_HISTORY_ENABLED; without the page these tests cannot pass.
const HISTORY_ON = /QR_HISTORY_ENABLED\s*=\s*true/.test(
  readFileSync(resolve(process.cwd(), 'src/modules/qr/flags.ts'), 'utf8'),
)

test.skip(!ALLOWED, 'E2E_ALLOW=1 required')
test.skip(!HISTORY_ON, 'QR_HISTORY_ENABLED is false')

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

async function createCleaning(c: Awaited<ReturnType<typeof adminClient>>, apartmentId: number, note: string) {
  const { data: staff, error: staffErr } = await c.from('staff').select('id').eq('active', true).limit(1)
  if (staffErr) throw staffErr
  if (!staff || staff.length === 0) {
    test.skip(true, 'No active staff — complete_cleaning needs at least one staff member')
    return { clientOpId: '', eventId: '' }
  }
  const staffId = staff[0].id
  const clientOpId = randomUUID()
  const { data, error } = await c.rpc('complete_cleaning', {
    p_apartment_id: apartmentId,
    p_cleaned_at: new Date().toISOString(),
    p_client_op_id: clientOpId,
    p_staff_ids: [staffId],
    p_lead_staff_id: staffId,
    p_note: note,
  })
  if (error) throw error
  const eventId = (data as { event_id?: string }).event_id ?? ''
  return { clientOpId, eventId }
}

async function waitForListLoaded(page: Page) {
  await expect(page.getByTestId('list-loading')).toBeHidden({ timeout: 15000 })
}

test.describe('QR History', () => {
  test('history page: cleaning search, date filter, detail, no delete', async ({ page }) => {
    const c = await adminClient()
    const aptId = Number(QR_APARTMENT_ID)
    const uniqueNote = `e2e-qrhist-${Date.now()}`
    await createCleaning(c, aptId, uniqueNote)

    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await expect(page).toHaveURL(/\/(admin|sv)/, { timeout: 15000 })

    await page.goto(`/qr.html#/qr/${QR_APARTMENT_ID}/history`)
    await expect(page.getByTestId('history-filters')).toBeVisible({ timeout: 15000 })

    // Search with no match
    const toggle = page.getByTestId('filters-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()

    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill('zzz-no-match-xyz')
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card')).toHaveCount(0, { timeout: 8000 })
    await expect(page.getByTestId('list-empty')).toBeVisible({ timeout: 5000 })

    // Clear search — cards should appear
    await searchInput.fill('')
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card').first()).toBeVisible({ timeout: 8000 })

    // Date filter with future date — no results
    const dateFrom = page.getByTestId('date-from')
    await expect(dateFrom).toBeVisible()
    await dateFrom.fill('2099-01-01')
    await waitForListLoaded(page)
    await expect(page.getByTestId('cleaning-card')).toHaveCount(0, { timeout: 8000 })
    await expect(page.getByTestId('list-empty')).toBeVisible({ timeout: 5000 })
    await dateFrom.fill('')

    // Reset filters
    await expect(page.getByTestId('filters-reset')).toBeVisible()
    await page.getByTestId('filters-reset').click()

    await waitForListLoaded(page)
    const firstCard = page.getByTestId('cleaning-card').first()
    await expect(firstCard).toBeVisible({ timeout: 8000 })
    await firstCard.click()

    const detail = page.getByTestId('cleaning-detail')
    await expect(detail).toBeVisible({ timeout: 5000 })
    await expect(detail.getByTestId('cleaning-delete-btn')).not.toBeVisible()

    await page.keyboard.press('Escape')
    await expect(detail).not.toBeVisible({ timeout: 5000 })
  })

  test('incident tab shows incidents and detail without delete', async ({ page }) => {
    const c = await adminClient()
    const aptId = Number(QR_APARTMENT_ID)

    // Check if there are any incidents for this apartment
    const { count } = await c
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .eq('apartment_id', aptId)

    if (!count || count === 0) {
      test.skip(true, 'No incidents for this apartment — skipping incident tab test')
      return
    }

    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await expect(page).toHaveURL(/\/(admin|sv)/, { timeout: 15000 })

    await page.goto(`/qr.html#/qr/${QR_APARTMENT_ID}/history`)
    await expect(page.getByTestId('history-filters')).toBeVisible({ timeout: 15000 })

    const incidentTab = page.getByTestId('tab-incidents')
    await expect(incidentTab).toBeVisible()
    await incidentTab.click()

    await waitForListLoaded(page)
    await expect(page.getByTestId('incident-card').first()).toBeVisible({ timeout: 8000 })

    const firstIncident = page.getByTestId('incident-card').first()
    await firstIncident.click()
    const incidentDetail = page.getByTestId('incident-detail')
    await expect(incidentDetail).toBeVisible({ timeout: 5000 })
    await expect(incidentDetail.getByTestId('incident-delete-btn')).not.toBeVisible()
  })
})
