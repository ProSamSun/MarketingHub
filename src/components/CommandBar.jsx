import { useEffect, useRef, useState } from 'react'
import { Sparkles, ArrowRight } from 'lucide-react'
import { Spinner, Banner } from '../lib/ui.jsx'

const SUGGESTIONS = [
  'Create a 5-day solar lead nurture sequence',
  'Show me all contacts tagged meta-lead',
  'Send a reactivation SMS to cold leads',
  'Open the pipeline',
]

export default function CommandBar({ api, open, onClose, onRoute }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const inputRef = useRef(null)

  // Autofocus + reset transient state whenever the bar opens.
  useEffect(() => {
    if (!open) return
    setError('')
    setInfo('')
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return
    const h = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  async function run(text) {
    const value = (text ?? input).trim()
    if (!value || loading) return
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const result = await api.post('/api/workflows?action=command', { input: value })
      const intent = result?.intent
      if (intent?.action === 'unknown') {
        setInfo(result?.message || intent?.message || "Sorry, I didn't understand that. Try rephrasing.")
        return
      }
      onRoute?.(intent)
      setInput('')
    } catch (e) {
      setError(e?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  function onSuggestion(text) {
    setInput(text)
    run(text)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-w-xl mx-auto mt-[12vh] bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-neutral-800">
          {loading
            ? <Spinner size={18} className="text-violet-400 shrink-0" />
            : <Sparkles size={18} className="text-violet-400 shrink-0" />}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
            placeholder="Ask anything… e.g. 'Create a 5-day solar nurture sequence'"
            className="flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600 disabled:opacity-60"
          />
          <kbd className="hidden sm:inline-block text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5 shrink-0">esc</kbd>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Spinner size={15} /> Thinking…
            </div>
          )}

          {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}
          {info && <Banner type="info" onClose={() => setInfo('')}>{info}</Banner>}

          {!loading && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-neutral-600 uppercase tracking-widest px-0.5">
                Try
              </span>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSuggestion(s)}
                  className="group flex items-center justify-between gap-3 text-left text-sm text-neutral-300 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-xl px-3.5 py-2.5 transition-colors"
                >
                  <span className="min-w-0 truncate">{s}</span>
                  <ArrowRight size={15} className="text-neutral-600 group-hover:text-violet-400 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
