import { useState } from 'react'

export default function Login({ onLogin }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  async function attempt(e) {
    e.preventDefault()
    const res = await fetch('/api/contacts', {
      headers: { 'x-dashboard-token': pw },
    }).catch(() => null)

    if (res?.ok) {
      onLogin(pw)
    } else {
      setErr('Incorrect password.')
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Marketing Hub</h1>
        <p className="text-sm text-neutral-500 mb-8">GHL + Meta + Claude</p>

        <form onSubmit={attempt} className="flex flex-col gap-4">
          <input
            type="password"
            placeholder="Dashboard password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr('') }}
            className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500 transition-colors"
            autoFocus
          />
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button
            type="submit"
            className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}
