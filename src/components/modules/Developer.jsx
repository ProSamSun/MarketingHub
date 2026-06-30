import { useEffect, useState, useCallback } from 'react'
import { MessageSquare, Mail, Zap, Edit2, Save, X, RefreshCw, Search, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

const TABS = [
  { key: 'logs',      label: 'Message Log',  icon: MessageSquare },
  { key: 'templates', label: 'Templates',    icon: Edit2 },
  { key: 'webhooks',  label: 'Webhook Events', icon: Zap },
]

const CHANNEL_COLORS = {
  sms:           { bg: 'rgba(204,0,0,0.15)', text: '#ff6666', label: 'SMS' },
  email:         { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', label: 'Email' },
  email_subject: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', label: 'Email Subject' },
  inbound:       { bg: 'rgba(34,197,94,0.15)', text: '#4ade80', label: 'Inbound' },
}

function Badge({ channel }) {
  const c = CHANNEL_COLORS[channel] || { bg: 'rgba(100,100,100,0.2)', text: '#aaa', label: channel }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
          style={{ background: c.bg, color: c.text }}>
      {c.label}
    </span>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button onClick={copy} className="p-1 rounded text-neutral-500 hover:text-neutral-200 transition-colors" title="Copy">
      {copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
    </button>
  )
}

function ts(raw) {
  if (!raw) return '—'
  const d = new Date(raw)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

// ── Message Log ───────────────────────────────────────────────────────────────
function LogRow({ log }) {
  const [open, setOpen] = useState(false)
  const name = [log.first_name, log.last_name].filter(Boolean).join(' ') || log.phone || log.email || 'Unknown'
  const preview = log.body?.replace(/<[^>]+>/g, ' ').trim().slice(0, 100) || '—'

  return (
    <div className="border border-neutral-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors text-left"
      >
        <Badge channel={log.channel} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-neutral-100 truncate">{name}</span>
            <span className="text-xs text-neutral-500 shrink-0">{log.phone || log.email || ''}</span>
          </div>
          <p className="text-xs text-neutral-500 truncate mt-0.5">{preview}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-neutral-500">{ts(log.sent_at)}</div>
          <div className={`text-[10px] mt-0.5 ${log.status === 'sent' ? 'text-green-500' : 'text-yellow-500'}`}>
            {log.status}
          </div>
        </div>
        {open ? <ChevronUp size={14} className="text-neutral-600 shrink-0" /> : <ChevronDown size={14} className="text-neutral-600 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
          {log.subject && (
            <div className="mb-2">
              <span className="text-[10px] uppercase tracking-widest text-neutral-600">Subject</span>
              <p className="text-sm text-neutral-200 mt-0.5">{log.subject}</p>
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <span className="text-[10px] uppercase tracking-widest text-neutral-600">Message Body</span>
              {log.channel === 'email' ? (
                <div className="mt-1 text-xs text-neutral-400 bg-neutral-900 rounded-lg p-3 max-h-48 overflow-y-auto"
                     dangerouslySetInnerHTML={{ __html: log.body }} />
              ) : (
                <p className="mt-1 text-sm text-neutral-200 whitespace-pre-wrap">{log.body}</p>
              )}
            </div>
            <CopyButton text={log.body?.replace(/<[^>]+>/g, ' ').trim()} />
          </div>
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <details className="mt-3">
              <summary className="text-[10px] uppercase tracking-widest text-neutral-600 cursor-pointer">Raw metadata</summary>
              <pre className="mt-1 text-[11px] text-neutral-500 bg-neutral-900 rounded-lg p-2 overflow-x-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function MessageLog({ api }) {
  const [logs, setLogs]     = useState([])
  const [total, setTotal]   = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ action: 'logs', limit: '100' })
      if (search)  params.set('search', search)
      if (channel) params.set('channel', channel)
      const data = await api.get(`/api/developer?${params}`)
      setLogs(data.logs || [])
      setTotal(data.total || 0)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [api, search, channel])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-lg">Message Log</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{total} total messages sent across all campaigns &amp; workflows</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, or message…"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl pl-8 pr-3 py-2 text-sm outline-none focus:border-red-600 transition-colors"
          />
        </div>
        <select
          value={channel}
          onChange={e => setChannel(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-red-600 transition-colors"
        >
          <option value="">All channels</option>
          <option value="sms">SMS only</option>
          <option value="email">Email only</option>
        </select>
      </div>

      {loading && <p className="text-sm text-neutral-500 text-center py-8">Loading…</p>}
      {!loading && logs.length === 0 && (
        <div className="text-center text-neutral-600 py-12 text-sm">
          No messages sent yet. They'll appear here as campaigns and workflows run.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {logs.map(log => <LogRow key={log.id} log={log} />)}
      </div>
    </div>
  )
}

// ── Templates ─────────────────────────────────────────────────────────────────
function TemplateCard({ tpl, onSave }) {
  const [editing, setEditing]   = useState(false)
  const [body, setBody]         = useState(tpl.body)
  const [saving, setSaving]     = useState(false)

  async function save() {
    setSaving(true)
    await onSave({ key: tpl.key, label: tpl.label, channel: tpl.channel, templateBody: body })
    setSaving(false)
    setEditing(false)
  }

  const VARS = ['{{first_name}}', '{{last_name}}', '{{rep_name}}', '{{business_name}}', '{{offer}}', '{{booking_link}}']

  return (
    <div className="border border-neutral-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-950">
        <div className="flex items-center gap-2.5">
          <Badge channel={tpl.channel} />
          <span className="font-medium text-sm">{tpl.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={save} disabled={saving}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                      style={{ background: '#cc0000', color: '#fff', opacity: saving ? 0.6 : 1 }}>
                <Save size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setBody(tpl.body) }}
                      className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 transition-colors">
                <X size={14} />
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
                    className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100 transition-colors px-2 py-1">
              <Edit2 size={12} /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 bg-neutral-900/50">
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={tpl.channel === 'sms' || tpl.channel === 'email_subject' ? 3 : 8}
              className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-red-600 transition-colors resize-y"
            />
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-neutral-600 uppercase tracking-widest self-center">Variables:</span>
              {VARS.map(v => (
                <button key={v} onClick={() => setBody(b => b + v)}
                        className="text-[11px] bg-neutral-800 hover:bg-neutral-700 rounded px-1.5 py-0.5 text-neutral-300 font-mono transition-colors">
                  {v}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            {tpl.channel === 'email' ? (
              <div className="text-xs text-neutral-400 bg-neutral-900 rounded-lg p-3 max-h-40 overflow-y-auto flex-1"
                   dangerouslySetInnerHTML={{ __html: body }} />
            ) : (
              <p className="text-sm text-neutral-300 whitespace-pre-wrap flex-1">{body}</p>
            )}
            <CopyButton text={body.replace(/<[^>]+>/g, ' ').trim()} />
          </div>
        )}
        <p className="text-[10px] text-neutral-600 mt-2">
          Last updated: {ts(tpl.updated_at)}
        </p>
      </div>
    </div>
  )
}

function Templates({ api }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]     = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = await api.get('/api/developer?action=templates')
      setTemplates(data.templates || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function onSave(payload) {
    await api.post('/api/developer', { action: 'save-template', ...payload })
    await load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-bold text-lg">Message Templates</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          These are the exact messages sent to your clients' leads. Edit them to match each client's voice.
          Variables like <code className="text-red-400 text-[11px]">{'{{first_name}}'}</code> are filled in automatically.
        </p>
      </div>

      {loading && <p className="text-sm text-neutral-500 text-center py-8">Loading templates…</p>}
      <div className="flex flex-col gap-3">
        {templates.map(t => <TemplateCard key={t.key} tpl={t} onSave={onSave} />)}
      </div>
    </div>
  )
}

// ── Webhook Events ────────────────────────────────────────────────────────────
function WebhookEvents({ api }) {
  const [events, setEvents]   = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(null)

  async function load() {
    setLoading(true)
    try {
      const data = await api.get('/api/developer?action=webhooks')
      setEvents(data.events || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Webhook Events</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Every inbound event from Meta Lead Ads and Twilio SMS replies</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-neutral-500 text-center py-8">Loading…</p>}
      {!loading && events.length === 0 && (
        <div className="text-center text-neutral-600 py-12 text-sm">
          No webhook events yet. They'll appear here once Meta Lead Ads or Twilio SMS replies come in.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {events.map(ev => (
          <div key={ev.id} className="border border-neutral-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpen(o => o === ev.id ? null : ev.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors text-left"
            >
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                    style={{ background: ev.source === 'meta' ? 'rgba(59,130,246,0.15)' : 'rgba(204,0,0,0.15)',
                             color:      ev.source === 'meta' ? '#60a5fa' : '#ff6666' }}>
                {ev.source}
              </span>
              <span className="flex-1 text-sm text-neutral-300">{ev.event_type || 'unknown'}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${ev.processed ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'}`}>
                {ev.processed ? 'Processed' : 'Pending'}
              </span>
              <span className="text-xs text-neutral-500 shrink-0">{ts(ev.received_at)}</span>
              {open === ev.id ? <ChevronUp size={13} className="text-neutral-600" /> : <ChevronDown size={13} className="text-neutral-600" />}
            </button>
            {open === ev.id && (
              <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <pre className="text-[11px] text-neutral-400 overflow-x-auto flex-1">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                  <CopyButton text={JSON.stringify(ev.payload, null, 2)} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Developer module ─────────────────────────────────────────────────────
export default function Developer({ api }) {
  const [tab, setTab] = useState('logs')

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-1 border-b border-neutral-800">
        <div>
          <h1 className="font-bold text-xl">Developer Console</h1>
          <p className="text-xs text-neutral-500 mt-0.5">Full audit trail of every message sent and received</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={tab === key ? { background: '#cc0000', color: '#fff' } : { color: '#737373' }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'logs'      && <MessageLog api={api} />}
      {tab === 'templates' && <Templates  api={api} />}
      {tab === 'webhooks'  && <WebhookEvents api={api} />}
    </div>
  )
}
