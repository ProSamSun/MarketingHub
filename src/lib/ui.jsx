/**
 * Shared UI primitives + design tokens. Dark theme: neutral-900 surfaces,
 * red-700 accent, rounded-xl. Import these everywhere for a consistent look.
 */
import { useEffect } from 'react'
import { X, Loader2, Inbox as InboxIcon } from 'lucide-react'

// ── Class tokens (use directly on inputs/buttons) ─────────────────────────────
export const inputCls =
  'w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-red-600 transition-colors placeholder:text-neutral-600'

export const labelCls = 'text-xs font-medium text-neutral-400'

// ── Primitives ────────────────────────────────────────────────────────────────

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`bg-neutral-900 border border-neutral-800 rounded-xl ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function Section({ title, action, children, className = '' }) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, required, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className={labelCls}>
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      )}
      {children}
      {hint && <span className="text-[11px] text-neutral-600">{hint}</span>}
    </label>
  )
}

export function Button({ variant = 'primary', loading = false, icon: Icon, children, className = '', disabled, ...rest }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap'
  const variants = {
    primary: 'bg-red-700 hover:bg-red-800 text-white',
    ghost:   'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium',
    subtle:  'bg-transparent hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 font-medium',
    danger:  'bg-red-600/90 hover:bg-red-600 text-white',
  }
  return (
    <button className={`${base} ${variants[variant] || variants.primary} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={15} className="animate-spin" /> : (Icon && <Icon size={15} />)}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, className = '', ...rest }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-neutral-100 transition-colors ${className}`}
      {...rest}
    >
      <Icon size={16} />
    </button>
  )
}

export function Tag({ children, onRemove, color }) {
  return (
    <span
      className="inline-flex items-center gap-1 bg-neutral-800 text-neutral-300 text-xs px-2 py-0.5 rounded-full"
      style={color ? { backgroundColor: `${color}22`, color } : undefined}
    >
      {children}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-white -mr-0.5" aria-label="Remove">
          <X size={11} />
        </button>
      )}
    </span>
  )
}

export function Spinner({ size = 16, className = '' }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 text-neutral-500 py-16 text-sm">
      <Spinner /> {label}
    </div>
  )
}

export function EmptyState({ icon: Icon = InboxIcon, title, hint, action }) {
  return (
    <div className="text-center text-neutral-500 py-16 flex flex-col items-center gap-3">
      <Icon size={32} className="opacity-30" />
      <div>
        <p className="text-sm text-neutral-400">{title}</p>
        {hint && <p className="text-xs text-neutral-600 mt-1 max-w-xs mx-auto">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function Banner({ type = 'error', children, onClose }) {
  const styles = {
    error:   'bg-red-950/60 border-red-900 text-red-300',
    success: 'bg-emerald-950/60 border-emerald-900 text-emerald-300',
    info:    'bg-neutral-900 border-neutral-800 text-neutral-300',
  }
  if (!children) return null
  return (
    <div className={`flex items-start justify-between gap-2 border rounded-xl px-4 py-3 text-sm ${styles[type] || styles.info}`}>
      <div className="min-w-0">{children}</div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100 shrink-0"><X size={15} /></button>}
    </div>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-red-700' : 'bg-neutral-700'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return
    const h = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

/** Centered modal dialog. Pass `footer` for action buttons. */
export function Modal({ open, onClose, title, children, footer, wide = false }) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-neutral-900 border border-neutral-800 w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col`}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 shrink-0">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 transition-colors"><X size={18} /></button>
        </header>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <footer className="px-5 py-4 border-t border-neutral-800 shrink-0 flex gap-2 justify-end">{footer}</footer>}
      </div>
    </div>
  )
}

/** Right-side slide-over panel (wider, full height). */
export function SlideOver({ open, onClose, title, subtitle, children, footer }) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-neutral-900 border-l border-neutral-800 w-full max-w-md h-full shadow-2xl flex flex-col animate-[slideIn_.18s_ease-out]">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-800 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-sm truncate">{title}</h2>
            {subtitle && <p className="text-xs text-neutral-500 truncate mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 transition-colors shrink-0"><X size={18} /></button>
        </header>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <footer className="px-5 py-4 border-t border-neutral-800 shrink-0 flex gap-2">{footer}</footer>}
      </div>
    </div>
  )
}

/** Stat card for the analytics home. */
export function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">{label}</span>
        {Icon && <Icon size={16} className="text-red-500" />}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </Card>
  )
}
