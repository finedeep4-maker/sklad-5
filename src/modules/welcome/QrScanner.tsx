import { useEffect, useRef, useState } from 'react'
import type JsQR from 'jsqr'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n'

type DetectedCode = { rawValue: string }
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedCode[]> }
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

const SCAN_INTERVAL_MS = 180
const REPEAT_BLOCK_MS = 2500
const NOTICE_MS = 2000
const MAX_SIDE = 640

interface Props {
  /** Return true when the code was accepted (the caller navigates away), false to keep scanning. */
  onResult: (text: string) => boolean
  onClose: () => void
  /** Fallback when scanning is not possible: search the apartment by its code instead. */
  onManual: () => void
}

export function QrScanner({ onResult, onClose, onManual }: Props) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const onResultRef = useRef(onResult)
  const tRef = useRef(t)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    onResultRef.current = onResult
    tRef.current = t
  })

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let scanTimer: ReturnType<typeof setInterval> | null = null
    let noticeTimer: ReturnType<typeof setTimeout> | null = null
    let lastText = ''
    let lastAt = 0
    let busy = false

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(tRef.current.welcome.cameraUnsupported)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch {
        if (!stopped) setError(tRef.current.welcome.cameraDenied)
        return
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => {})

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      let detector: BarcodeDetectorLike | null = null
      if (Detector) {
        try {
          detector = new Detector({ formats: ['qr_code'] })
        } catch {
          detector = null
        }
      }
      let jsQR: typeof JsQR | null = null
      if (!detector) {
        try {
          jsQR = (await import('jsqr')).default
        } catch {
          if (!stopped) setError(tRef.current.welcome.cameraUnsupported)
          return
        }
      }
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      const readFrame = async (): Promise<string | null> => {
        if (video.readyState < 2 || !video.videoWidth) return null
        if (detector) {
          const codes = await detector.detect(video)
          return codes[0]?.rawValue ?? null
        }
        if (!jsQR || !ctx) return null
        const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
        const w = Math.max(1, Math.round(video.videoWidth * scale))
        const h = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.width = w
        canvas.height = h
        ctx.drawImage(video, 0, 0, w, h)
        const image = ctx.getImageData(0, 0, w, h)
        return jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
      }

      if (stopped) return
      scanTimer = setInterval(async () => {
        if (busy || stopped) return
        busy = true
        try {
          const text = await readFrame()
          if (!text || stopped) return
          const now = Date.now()
          if (text === lastText && now - lastAt < REPEAT_BLOCK_MS) return
          lastText = text
          lastAt = now
          if (!onResultRef.current(text)) {
            setNotice(tRef.current.welcome.scanUnknown)
            if (noticeTimer) clearTimeout(noticeTimer)
            noticeTimer = setTimeout(() => setNotice(null), NOTICE_MS)
          }
        } catch {
          // a single failed frame is ignored; the next tick tries again
        } finally {
          busy = false
        }
      }, SCAN_INTERVAL_MS)
    }

    void start()

    return () => {
      stopped = true
      if (scanTimer) clearInterval(scanTimer)
      if (noticeTimer) clearTimeout(noticeTimer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[90] bg-black text-white">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 max-w-[70vw] max-h-[70vw] rounded-3xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
      </div>
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3">
        <span className="text-base font-semibold">{t.welcome.scannerTitle}</span>
        <button
          onClick={onClose}
          aria-label={t.welcome.close}
          className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 px-6 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] text-center">
        {error ? (
          <p className="text-sm bg-black/70 rounded-xl px-4 py-3">{error}</p>
        ) : notice ? (
          <p className="text-sm bg-warn text-white rounded-xl px-4 py-3">{notice}</p>
        ) : (
          <p className="text-sm text-white/90">{t.welcome.scanHint}</p>
        )}
        <button onClick={onManual} className="mt-3 text-sm text-white underline underline-offset-2">
          {t.welcome.manual}
        </button>
      </div>
    </div>
  )
}
