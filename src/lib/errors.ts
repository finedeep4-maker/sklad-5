import { currentDict } from '@/i18n'

const NETWORK_PATTERNS = /failed to fetch|network|load failed|timeout/i
const NETWORK_STATUSES = new Set([0, 408, 502, 503, 504])
const AUTH_CODES = new Set(['PGRST301'])
const AUTH_PATTERNS = /jwt expired/i

export class ApiError extends Error {
  code: string | null
  status: number | null
  isNetwork: boolean
  isAuth: boolean

  constructor(
    message: string,
    code: string | null = null,
    status: number | null = null,
    isNetwork = false,
    isAuth = false,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.isNetwork = isNetwork
    this.isAuth = isAuth
  }
}

interface PostgrestLikeError {
  message?: string
  code?: string
  status?: number
}

export function toApiError(error: unknown, statusOverride?: number): ApiError {
  if (error instanceof ApiError) return error

  const raw = error as PostgrestLikeError
  const message = raw.message ?? (error instanceof Error ? error.message : String(error))
  const code = raw.code ?? null
  const status = statusOverride ?? raw.status ?? null

  const isNetwork =
    (!code && NETWORK_PATTERNS.test(message)) ||
    (status != null && NETWORK_STATUSES.has(status))
  const isAuth =
    (code != null && AUTH_CODES.has(code)) ||
    AUTH_PATTERNS.test(message) ||
    status === 401

  return new ApiError(message, code, status, isNetwork, isAuth)
}

const FRIENDLY_CODES: Record<string, () => string> = {}

function initFriendlyCodes() {
  const d = currentDict()
  FRIENDLY_CODES['23503'] = () => d.errors.fkViolation
  FRIENDLY_CODES['23505'] = () => d.errors.uniqueViolation
  FRIENDLY_CODES['42501'] = () => d.errors.noPrivilege
  FRIENDLY_CODES['23514'] = () => d.errors.checkViolation
}

export function friendlyMessage(error: unknown): string {
  initFriendlyCodes()
  const apiError = toApiError(error)
  if (apiError.isNetwork) return currentDict().errors.network
  if (apiError.isAuth) return currentDict().errors.auth
  if (apiError.code && FRIENDLY_CODES[apiError.code]) {
    return FRIENDLY_CODES[apiError.code]()
  }
  return apiError.message
}
