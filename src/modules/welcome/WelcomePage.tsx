import { useState } from 'react'
import { LogIn, ScanLine } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAuth } from '@/modules/core/store'
import { QrScanner } from './QrScanner'
import { parseApartmentId } from './parseQr'
import { markWelcomeSeen } from './welcomeState'

interface Props {
  /** Continue to the main app (administrator sign-in / admin panel). */
  onContinue: () => void
}

export function WelcomePage({ onContinue }: Props) {
  const { t } = useI18n()
  const [imageOk, setImageOk] = useState(true)
  const [scanRequested, setScanRequested] = useState(false)
  const [autoDismissed, setAutoDismissed] = useState(false)
  const authState = useAuth((s) => s.state)
  const role = useAuth((s) => s.profile?.role)
  // The main app is for administrators only; hide the entry for a signed-in manager or supervisor.
  const canEnterApp = authState !== 'loading' && (!role || role === 'admin')
  // A signed-in manager or supervisor goes straight to the scanner; closing it shows this screen.
  const isFieldRole = authState !== 'loading' && !!role && role !== 'admin'
  const scanOpen = scanRequested || (isFieldRole && !autoDismissed)

  const closeScanner = () => {
    setScanRequested(false)
    setAutoDismissed(true)
  }

  const handleManual = () => {
    markWelcomeSeen()
    window.location.assign('/qr.html#/qr')
  }

  const handleScan = (text: string): boolean => {
    const id = parseApartmentId(text)
    if (id == null) return false
    markWelcomeSeen()
    window.location.assign(`/qr.html#/qr/${id}`)
    return true
  }

  const handleContinue = () => {
    markWelcomeSeen()
    onContinue()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900 text-white overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(160deg, #0e7c86 0%, #0f172a 100%)' }}
      />
      {imageOk && (
        <img
          src="/welcome-banner.jpg"
          alt=""
          onError={() => setImageOk(false)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />

      <div className="relative h-full max-w-lg mx-auto w-full flex flex-col justify-end px-5 pt-[env(safe-area-inset-top,0px)] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h1 className="text-3xl font-semibold mb-1">{t.app.name}</h1>
        <p className="text-sm text-white/80 mb-6">{t.welcome.subtitle}</p>

        <div className="space-y-3">
          {canEnterApp && (
            <button
              onClick={handleContinue}
              className="w-full min-h-[56px] bg-accent text-white rounded-2xl px-4 py-3 text-base font-medium flex items-center justify-center gap-2.5 transition-opacity active:opacity-90"
            >
              <LogIn className="w-5 h-5 shrink-0" />
              <span>{t.welcome.enterApp}</span>
            </button>
          )}
          <button
            onClick={() => setScanRequested(true)}
            className="w-full min-h-[56px] bg-white/15 backdrop-blur border border-white/30 text-white rounded-2xl px-4 py-3 text-base font-medium flex items-center justify-center gap-2.5 transition-colors active:bg-white/25"
          >
            <ScanLine className="w-5 h-5 shrink-0" />
            <span>{t.welcome.scanner}</span>
          </button>
        </div>
      </div>

      {scanOpen && <QrScanner onResult={handleScan} onClose={closeScanner} onManual={handleManual} />}
    </div>
  )
}
