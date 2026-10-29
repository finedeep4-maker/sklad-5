import { create } from 'zustand'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'error' | 'success'
}

interface ToastStore {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

let counter = 0

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, kind = 'info') => {
    const id = ++counter
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function toast(message: string, kind?: Toast['kind']) {
  useToast.getState().show(message, kind)
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '')
}

export function edgeError(data: unknown, error: unknown): Error {
  const msg = (data as { error?: string } | null)?.error
    ?? (error instanceof Error ? error.message : String(error))
  return new Error(msg)
}

export function ToastContainer() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg max-w-sm w-full text-center ${
            t.kind === 'error'
              ? 'bg-bad text-white'
              : t.kind === 'success'
                ? 'bg-ok text-white'
                : 'bg-surface text-ink border border-line'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
