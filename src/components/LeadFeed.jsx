import { useEffect, useState } from 'react'
import { Users, RefreshCw, Phone, Mail, Tag } from 'lucide-react'

export default function LeadFeed({ token }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/contacts', {
        headers: { 'x-dashboard-token': token },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setContacts(data.contacts || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase()
    return (
      (c.firstName + ' ' + c.lastName).toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.includes(q)
    )
  })

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total Leads" value={contacts.length} />
        <Stat label="With Email" value={contacts.filter(c => c.email).length} />
        <Stat label="With Phone" value={contacts.filter(c => c.phone).length} />
      </div>

      {/* Search + refresh */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search leads…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-violet-500 transition-colors"
        />
        <button
          onClick={load}
          className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin text-violet-400' : 'text-neutral-400'} />
        </button>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="text-center text-neutral-500 py-12 text-sm">Loading leads…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center text-neutral-500 py-12">
          <Users size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search ? 'No matches' : 'No leads yet. They'll appear here when Meta forms are submitted.'}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map(contact => (
          <ContactCard key={contact.id} contact={contact} />
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  )
}

function ContactCard({ contact }) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown'
  const tags = contact.tags || []
  const source = contact.source || ''

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{name}</p>
          {source && <p className="text-xs text-neutral-500 mt-0.5">{source}</p>}
        </div>
        <span className="text-xs text-neutral-600 shrink-0">
          {contact.dateAdded ? new Date(contact.dateAdded).toLocaleDateString() : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-neutral-400">
        {contact.email && (
          <span className="flex items-center gap-1">
            <Mail size={12} /> {contact.email}
          </span>
        )}
        {contact.phone && (
          <span className="flex items-center gap-1">
            <Phone size={12} /> {contact.phone}
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {tags.slice(0, 5).map(tag => (
            <span key={tag} className="bg-neutral-800 text-neutral-400 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
              <Tag size={10} /> {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
