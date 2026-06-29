/** Formatting helpers shared across modules. Contacts use snake_case DB fields. */

export function fullName(c) {
  const n = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
  return n || c?.email || c?.phone || 'Unknown'
}

export function initials(c) {
  const f = (c?.first_name || '').trim()
  const l = (c?.last_name || '').trim()
  if (f || l) return ((f[0] || '') + (l[0] || '')).toUpperCase()
  const e = (c?.email || '').trim()
  return (e[0] || '?').toUpperCase()
}

export function currency(n) {
  const v = Number(n || 0)
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: v % 1 === 0 ? 0 : 2,
  })
}

export function compactNumber(n) {
  const v = Number(n || 0)
  return v.toLocaleString('en-US', { notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 })
}

export function shortDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dateTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function relativeTime(d) {
  if (!d) return ''
  const then = new Date(d).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return shortDate(d)
}
