import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

export const sentryInitialized = !!dsn

export function initSentry() {
  if (!dsn) return
  Sentry.init({
    dsn,
    release: (import.meta.env.VITE_COMMIT_SHA as string | undefined) || undefined,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) {
        event.request.cookies = undefined as unknown as Record<string, string>
        event.request.headers = undefined as unknown as Record<string, string>
        event.request.data = undefined as unknown as string
      }
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.type === 'http' || breadcrumb.type === 'fetch') {
        if (breadcrumb.data) {
          breadcrumb.data.url = breadcrumb.data.url?.split('?')[0]
          delete breadcrumb.data.body
          delete breadcrumb.data.request_body
        }
      }
      return breadcrumb
    },
  })
}

export function setSentryUser(userId: string | null) {
  if (!sentryInitialized) return
  if (userId) {
    Sentry.setUser({ id: userId })
  } else {
    Sentry.setUser(null)
  }
}

export { Sentry }
