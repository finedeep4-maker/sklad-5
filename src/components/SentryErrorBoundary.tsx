import { Component, type ReactNode, type ErrorInfo } from 'react'
import { RefreshCw } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { currentDict } from '@/i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class SentryErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { extra: { ...info } })
  }

  render() {
    if (this.state.hasError) {
      const d = currentDict()
      return (
        <div className="min-h-screen bg-app flex flex-col items-center justify-center px-6 text-center">
          <h1 className="text-lg font-semibold text-ink mb-2">{d.errorBoundaryTitle}</h1>
          <p className="text-sm text-muted mb-6">{d.errorBoundaryMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            {d.errorBoundaryReload}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
