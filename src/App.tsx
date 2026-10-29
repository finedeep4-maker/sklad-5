import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth, homePathForRole, setupAuthListener } from '@/modules/core/store'
import { BootstrapScreen, LoginScreen } from '@/modules/core/AuthScreens'
import { SvRoutes, AdminRoutes } from '@/modules/registry'
import { useI18n, useDocumentDir } from '@/i18n'
import { Package, RefreshCw } from 'lucide-react'
import { ToastContainer } from '@/lib/toast'
import { WelcomePage } from '@/modules/welcome/WelcomePage'
import { AdminOnlyScreen } from '@/modules/welcome/AdminOnlyScreen'
import { shouldShowWelcome } from '@/modules/welcome/welcomeState'

function QrRedirect() {
  const location = useLocation()
  const path = location.pathname
  const match = path.match(/^\/qr(?:\/(\d+))?(?:\/(clean|incident|history))?$/)
  const id = match?.[1]
  const action = match?.[2]
  const hash = id
    ? action
      ? `#/qr/${id}/${action}`
      : `#/qr/${id}`
    : '#/qr'

  useEffect(() => {
    window.location.replace(`/qr.html${hash}`)
  }, [hash])

  return null
}

function App() {
  const { t } = useI18n()
  useDocumentDir()
  const state = useAuth((s) => s.state)
  const init = useAuth((s) => s.init)
  const retryInit = useAuth((s) => s.retryInit)
  const profile = useAuth((s) => s.profile)
  const [showWelcome, setShowWelcome] = useState(shouldShowWelcome)

  useEffect(() => {
    setupAuthListener()
    init()
  }, [init])

  if (showWelcome) {
    return (
      <>
        <WelcomePage onContinue={() => setShowWelcome(false)} />
        <ToastContainer />
      </>
    )
  }

  let content: React.ReactNode
  if (state === 'loading') {
    content = (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center" data-theme="dark">
        <div className="w-14 h-14 bg-accent rounded-2xl flex items-center justify-center mb-4 animate-pulse">
          <Package className="w-7 h-7 text-white" />
        </div>
        <p className="text-sm text-muted">{t.app.loading}</p>
      </div>
    )
  } else if (state === 'no-connection') {
    content = (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center px-6" data-theme="dark">
        <div className="w-14 h-14 bg-warn-soft rounded-2xl flex items-center justify-center mb-4">
          <Package className="w-7 h-7 text-warn" />
        </div>
        <p className="text-sm text-muted mb-4">{t.offline}</p>
        <button onClick={retryInit} className="flex items-center gap-2 bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium">
          <RefreshCw className="w-4 h-4" />
          {t.retry}
        </button>
      </div>
    )
  } else if (state === 'bootstrap') {
    content = <BootstrapScreen />
  } else if (state === 'login' || !profile) {
    content = <LoginScreen />
  } else {
    const home = homePathForRole(profile.role)
    if (profile.role !== 'admin') {
      // Managers and supervisors work only through apartment QR codes; old /qr links still redirect.
      content = (
        <BrowserRouter>
          <Routes>
            <Route path="/qr/*" element={<QrRedirect />} />
            <Route path="*" element={<AdminOnlyScreen onScanner={() => setShowWelcome(true)} />} />
          </Routes>
        </BrowserRouter>
      )
    } else {
      content = (
        <BrowserRouter>
          <Routes>
            <Route path="/qr/*" element={<QrRedirect />} />
            <Route path="/sv/*" element={<SvRoutes />} />
            <Route path="/admin/*" element={<AdminRoutes />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </BrowserRouter>
      )
    }
  }

  return (
    <>
      {content}
      <ToastContainer />
    </>
  )
}

export default App
