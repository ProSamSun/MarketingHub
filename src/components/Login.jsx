import { useState } from 'react'

export default function Login({ onLogin }) {
  const [pw, setPw]   = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function attempt(e) {
    e.preventDefault()
    setErr('')
    setLoading(true)

    const res = await fetch('/api/auth-check', {
      headers: { 'x-dashboard-token': pw },
    }).catch(() => null)

    setLoading(false)

    if (!res) { setErr('Network error — check your connection.'); return }

    if (res.ok) {
      onLogin(pw)
    } else if (res.status === 500) {
      const data = await res.json().catch(() => ({}))
      setErr(data.error || 'Server error — check Vercel environment variables.')
    } else {
      setErr('Incorrect password.')
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6"
         style={{ background: 'radial-gradient(ellipse at top, #1a0000 0%, #0a0a0a 60%)' }}>

      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo-full.png"
            alt="Scale or Die"
            className="w-64 object-contain"
            onError={e => { e.target.style.display = 'none' }}
          />
          <p className="text-xs tracking-widest uppercase text-neutral-500">
            CRM · Automation · AI
          </p>
        </div>

        {/* Card */}
        <form onSubmit={attempt}
              className="w-full flex flex-col gap-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
          <p className="text-sm text-neutral-400 text-center">Enter your dashboard password</p>

          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr('') }}
            className="bg-neutral-950 border border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-red-600 transition-colors"
            autoFocus
          />

          {err && <p className="text-red-400 text-sm text-center">{err}</p>}

          <button
            type="submit"
            disabled={loading || !pw}
            className="py-3 rounded-xl text-sm font-bold tracking-wide transition-colors disabled:opacity-40"
            style={{ background: loading ? '#7a0000' : '#cc0000', color: '#fff' }}
          >
            {loading ? 'Verifying…' : 'Enter'}
          </button>
        </form>

        <p className="text-xs text-neutral-700">Marketing That Kills Competition</p>
      </div>
    </div>
  )
}
