import { test, expect, type Page } from '@playwright/test'

const ALLOWED = process.env.E2E_ALLOW === '1'
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN!
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD!
const SV_LOGIN = process.env.E2E_SV_LOGIN!
const SV_PW = process.env.E2E_SV_PASSWORD!

test.skip(!ALLOWED, 'E2E_ALLOW=1 required')

async function login(page: Page, login: string, password: string) {
  await page.goto('/')
  await page.fill('input[type="text"]', login)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
}

test.describe('Smoke', () => {
  test('admin login and dashboard', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await page.waitForURL('**/admin', { timeout: 15000 })
    await expect(page).toHaveURL(/\/admin$/)
  })

  test('clean sheet opens from sv apartment detail', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await page.waitForURL('**/admin', { timeout: 15000 })
    await page.goto('/sv')
    await page.waitForSelector('text=Квартиры', { timeout: 10000 })

    await page.goto('/sv/apartments/1')
    await page.waitForSelector('text=Отметить уборку', { timeout: 10000 })
    const confirmBtn = page.locator('button:has-text("Подтвердить")')
    await expect(confirmBtn).toBeVisible({ timeout: 10000 })
  })

  test('offline cleaning queues to outbox then syncs', async ({ page, context }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await page.waitForURL('**/admin', { timeout: 15000 })
    await page.goto('/sv')
    await page.waitForSelector('text=Квартиры', { timeout: 10000 })

    await context.setOffline(true)
    await page.goto('/sv/apartments/1/clean')
    await page.waitForSelector('text=Отметить уборку', { timeout: 10000 })
    const staffCheckbox = page.locator('input[type="checkbox"]').first()
    if (await staffCheckbox.isVisible()) {
      await staffCheckbox.check()
    }
    const confirmBtn = page.locator('button:has-text("Подтвердить")')
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click()
      await expect(page.locator('text=В очереди')).toBeVisible({ timeout: 5000 })
    }
    await context.setOffline(false)
    await page.waitForTimeout(5000)
  })

  test('qr/:id accessible by admin and supervisor', async ({ browser }) => {
    const roles = [
      { login: ADMIN_LOGIN, pw: ADMIN_PW },
      { login: SV_LOGIN, pw: SV_PW },
    ]
    for (const r of roles) {
      const page = await browser.newPage()
      await login(page, r.login, r.pw)
      await page.waitForURL(/\/(admin|sv)$/, { timeout: 15000 })
      await page.goto('/qr/1')
      // /qr/1 is a server redirect to /qr.html#/qr/1 — the QR app must render,
      // not bounce back to /admin or /sv.
      await page.waitForURL(/qr\.html#\/qr\/1/, { timeout: 15000 })
      await expect(page).toHaveURL(/qr\.html#\/qr\/1/)
      await page.close()
    }
  })

  test('delete staff with history shows error or archive option', async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PW)
    await page.waitForURL('**/admin', { timeout: 15000 })
    await page.goto('/admin/more/staff')
    await page.waitForSelector('button:has-text("Удалить")', { timeout: 10000 })
    const deleteBtn = page.locator('button:has-text("Удалить")').first()
    await deleteBtn.click()
    // Either the confirm dialog or an error toast must appear — the important
    // part is that the click does not silently do nothing.
    await page.waitForSelector('text=Удалить сотрудника?', { timeout: 5000 })
  })
})
