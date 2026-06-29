import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, MessageSquare, Mail, ChevronRight } from 'lucide-react'
import {
  Card, IconButton, Loading, EmptyState, Banner, SlideOver, Spinner,
} from '../../lib/ui.jsx'
import { fullName, initials, relativeTime, dateTime } from '../../lib/format.js'

/** Strip HTML to readable plain text WITHOUT injecting markup into the DOM. */
function stripHtml(html) {
  if (!html) return ''
  if (typeof window !== 'undefined' && window.DOMParser) {
    try {
      const doc = new DOMParser().parseFromString(String(html), 'text/html')
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
    } catch {
      /* fall through to regex */
    }
  }
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Best-effort preview line for a message (subject/stripped body for email). */
function previewText(m) {
  if (!m) return ''
  if (m.type === 'email') {
    return (m.subject && m.subject.trim()) || stripHtml(m.body) || '(no content)'
  }
  return (m.body || '').trim() || '(no content)'
}

function timeOf(m) {
  return m?.sent_at ? new Date(m.sent_at).getTime() : 0
}

export default function Inbox({ api }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null) // contact_id of the open thread

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError('')
    try {
      const data = await api.get('/api/inbox', { limit: 100 })
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
    } catch (e) {
      setError(e.message || 'Failed to load inbox')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Group messages by contact, compute preview/latest/count, sort by recency.
  const groups = useMemo(() => {
    const map = new Map()
    for (const m of messages) {
      const key = m.contact_id ?? `none-${m.id}`
      if (!map.has(key)) {
        map.set(key, {
          contactId: m.contact_id ?? null,
          key,
          contact: { first_name: m.first_name, last_name: m.last_name },
          items: [],
        })
      }
      map.get(key).items.push(m)
    }
    const list = []
    for (const g of map.values()) {
      g.items.sort((a, b) => timeOf(a) - timeOf(b)) // oldest -> newest
      const latest = g.items[g.items.length - 1]
      list.push({ ...g, latest, count: g.items.length })
    }
    list.sort((a, b) => timeOf(b.latest) - timeOf(a.latest))
    return list
  }, [messages])

  const openGroup = useMemo(
    () => groups.find(g => g.key === openId) || null,
    [groups, openId],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">Inbox</h2>
        <IconButton
          icon={refreshing ? Spinner : RefreshCw}
          label="Refresh"
          onClick={() => load(true)}
          disabled={refreshing}
        />
      </div>

      {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}

      {loading ? (
        <Loading label="Loading messages…" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No messages yet"
          hint="SMS and email conversations with your contacts will appear here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(g => {
            const last = g.latest
            const isEmail = last?.type === 'email'
            return (
              <Card
                key={g.key}
                className="p-3 sm:p-4 flex items-center gap-3 cursor-pointer hover:border-neutral-700 transition-colors"
                onClick={() => setOpenId(g.key)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(g.key) } }}
              >
                <span className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-red-700/20 text-red-400 text-sm font-semibold">
                  {initials(g.contact)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-neutral-100 truncate">
                      {fullName(g.contact)}
                    </p>
                    {isEmail
                      ? <Mail size={13} className="shrink-0 text-sky-400" />
                      : <MessageSquare size={13} className="shrink-0 text-emerald-400" />}
                  </div>
                  <p className="text-xs text-neutral-400 truncate mt-0.5">
                    {last?.direction === 'outbound' && (
                      <span className="text-neutral-500">You: </span>
                    )}
                    {previewText(last)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                    {relativeTime(last?.sent_at)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-neutral-300 bg-neutral-800 rounded-full px-2 py-0.5">
                      {g.count}
                    </span>
                    <ChevronRight size={15} className="text-neutral-600" />
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <SlideOver
        open={!!openGroup}
        onClose={() => setOpenId(null)}
        title={openGroup ? fullName(openGroup.contact) : 'Thread'}
        subtitle={openGroup ? `${openGroup.count} message${openGroup.count === 1 ? '' : 's'}` : undefined}
      >
        {openGroup && (
          <div className="flex flex-col gap-3">
            {openGroup.items.map(m => {
              const outbound = m.direction === 'outbound'
              const isEmail = m.type === 'email'
              const TypeIcon = isEmail ? Mail : MessageSquare
              const text = isEmail ? stripHtml(m.body) : (m.body || '')
              return (
                <div key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 ${
                      outbound
                        ? 'bg-red-700/15 border-red-800/50'
                        : 'bg-neutral-800/60 border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <TypeIcon size={12} className={isEmail ? 'text-sky-400' : 'text-emerald-400'} />
                      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                        {isEmail ? 'Email' : 'SMS'}
                      </span>
                      <span
                        className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${
                          outbound
                            ? 'bg-red-700/30 text-red-300'
                            : 'bg-neutral-700 text-neutral-300'
                        }`}
                      >
                        {outbound ? 'Sent' : 'Received'}
                      </span>
                    </div>

                    {isEmail && m.subject && (
                      <p className="text-sm font-semibold text-neutral-100 mb-0.5 break-words">
                        {m.subject}
                      </p>
                    )}

                    <p className="text-sm text-neutral-200 whitespace-pre-wrap break-words">
                      {text || '(no content)'}
                    </p>

                    <p className="text-[10px] text-neutral-500 mt-1.5 text-right">
                      {dateTime(m.sent_at)}
                      {m.status ? ` · ${m.status}` : ''}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SlideOver>
    </div>
  )
}
