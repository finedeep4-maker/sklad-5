const KEY = 'sv_welcome_seen'

/** The welcome screen is shown once per browser session, only on the root path. */
export function shouldShowWelcome(): boolean {
  if (window.location.pathname !== '/') return false
  try {
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return true
  }
}

export function markWelcomeSeen(): void {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // storage unavailable: the welcome screen may show again on the next load
  }
}
