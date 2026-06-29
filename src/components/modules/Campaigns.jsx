import { useEffect, useState } from 'react'
import { Sparkles, Send, MessageSquare, Mail, RefreshCw } from 'lucide-react'
import {
  Card, Section, Field, Button, Banner, inputCls,
} from '../../lib/ui.jsx'

const TABS = [
  { key: 'sms',          label: 'SMS',          icon: MessageSquare, sendLabel: 'SMS Campaign' },
  { key: 'email',        label: 'Email',        icon: Mail,          sendLabel: 'Email Campaign' },
  { key: 'reactivation', label: 'Reactivation', icon: RefreshCw,     sendLabel: 'Reactivation Campaign' },
]

const DESCRIPTIONS = {
  sms: 'Send a text message to every contact with a specific tag.',
  email: 'Send an email to every contact with a specific tag.',
  reactivation: 'Win back cold leads — Claude writes an SMS + email, both sent automatically.',
}

export default function Campaigns({ api, pending, onPendingConsumed }) {
  const [mode, setMode] = useState('sms')

  const [businessName, setBusinessName] = useState('')
  const [offer, setOffer] = useState('')
  const [tone, setTone] = useState('friendly')
  const [tag, setTag] = useState('meta-lead')
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')

  const [smsCopy, setSmsCopy] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // ── Apply routed payload from the AI command bar ───────────────────────────
  useEffect(() => {
    if (!pending) return
    if (pending.campaignType && TABS.some(t => t.key === pending.campaignType)) {
      setMode(pending.campaignType)
    }
    if (pending.businessName) setBusinessName(pending.businessName)
    if (pending.offer) setOffer(pending.offer)
    if (pending.tone) setTone(pending.tone)
    if (pending.tag) setTag(pending.tag)
    setResult(null)
    setError('')
    onPendingConsumed?.()
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickSubject(raw) {
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr[0] : raw
    } catch {
      return raw
    }
  }

  async function generateCopy() {
    if (!businessName || !offer) { setError('Business name and offer are required.'); return }
    setError('')
    setResult(null)
    setGenerating(true)
    try {
      if (mode === 'sms') {
        const { copy } = await api.post('/api/campaign', { action: 'generate-copy', type: 'sms', businessName, offer, tone })
        setSmsCopy(copy)
      } else if (mode === 'email') {
        const [subjRes, bodyRes] = await Promise.all([
          api.post('/api/campaign', { action: 'generate-copy', type: 'email_subject', businessName, offer, tone }),
          api.post('/api/campaign', { action: 'generate-copy', type: 'email_body', businessName, offer, tone }),
        ])
        setSubject(pickSubject(subjRes.copy))
        setBody(bodyRes.copy)
      } else if (mode === 'reactivation') {
        const [smsRes, subjRes, bodyRes] = await Promise.all([
          api.post('/api/campaign', { action: 'generate-copy', type: 'reactivation_sms', businessName, offer, tone }),
          api.post('/api/campaign', { action: 'generate-copy', type: 'email_subject', businessName, offer, tone }),
          api.post('/api/campaign', { action: 'generate-copy', type: 'reactivation_email', businessName, offer, tone }),
        ])
        setSmsCopy(smsRes.copy)
        setSubject(pickSubject(subjRes.copy))
        setBody(bodyRes.copy)
      }
    } catch (err) {
      setError(err.message)
    }
    setGenerating(false)
  }

  async function send() {
    setError('')
    setResult(null)
    setSending(true)
    try {
      let data
      if (mode === 'sms') {
        if (!smsCopy) throw new Error('Generate or write SMS copy first.')
        data = await api.post('/api/campaign', { action: 'send-sms', tag, message: smsCopy })
      } else if (mode === 'email') {
        if (!subject || !body) throw new Error('Generate or write email copy first.')
        data = await api.post('/api/campaign', { action: 'send-email', tag, subject, html: body, fromName, fromEmail })
      } else if (mode === 'reactivation') {
        data = await api.post('/api/campaign', { action: 'reactivation', businessName, offer, tag, fromName, fromEmail })
        if (data.sms?.copy) setSmsCopy(data.sms.copy)
        if (data.email?.subject) setSubject(data.email.subject)
      }
      setResult(data)
    } catch (err) {
      setError(err.message)
    }
    setSending(false)
  }

  const canSend = mode === 'reactivation'
    ? Boolean(businessName && offer)
    : (mode === 'sms' ? Boolean(smsCopy) : Boolean(subject && body))

  const active = TABS.find(t => t.key === mode)
  const showSms = mode === 'sms' || mode === 'reactivation'
  const showEmail = mode === 'email' || mode === 'reactivation'

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">Campaigns</h2>
        <p className="text-sm text-neutral-500">Generate copy with Claude and blast it to a tagged segment.</p>
      </div>

      {/* ── Segmented tab control ───────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-1 bg-neutral-900 border border-neutral-800 rounded-xl p-1">
        {TABS.map(t => {
          const Icon = t.icon
          const on = mode === t.key
          return (
            <button
              key={t.key}
              onClick={() => { setMode(t.key); setResult(null); setError('') }}
              className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                on ? 'bg-red-700 text-white' : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800'
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>

      <Card className="p-4">
        <p className="text-xs text-neutral-500">{DESCRIPTIONS[mode]}</p>
      </Card>

      {/* ── Shared inputs ───────────────────────────────────────────────── */}
      <Section title="Your Business">
        <Field label="Business name" required>
          <input
            type="text"
            placeholder="e.g. Apex Solar"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="What's the offer or hook?" required>
          <textarea
            placeholder="e.g. Free energy audit — limited spots this month"
            value={offer}
            onChange={e => setOffer(e.target.value)}
            rows={2}
            className={inputCls + ' resize-none'}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tone">
            <select value={tone} onChange={e => setTone(e.target.value)} className={inputCls}>
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="urgent">Urgent</option>
              <option value="casual">Casual</option>
              <option value="bold">Bold</option>
            </select>
          </Field>
          <Field label="Send to contacts tagged with">
            <input
              type="text"
              placeholder="meta-lead"
              value={tag}
              onChange={e => setTag(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        {showEmail && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From name">
              <input type="text" placeholder="John at Apex Solar" value={fromName} onChange={e => setFromName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="From email">
              <input type="email" placeholder="john@apexsolar.com" value={fromEmail} onChange={e => setFromEmail(e.target.value)} className={inputCls} />
            </Field>
          </div>
        )}
      </Section>

      {/* ── Generate ────────────────────────────────────────────────────── */}
      <Button
        variant="ghost"
        icon={Sparkles}
        loading={generating}
        onClick={generateCopy}
        disabled={generating || !businessName || !offer}
        className="w-full"
      >
        {generating ? 'Claude is writing…' : 'Generate with Claude'}
      </Button>

      {/* ── SMS copy ────────────────────────────────────────────────────── */}
      {showSms && (
        <Section title="SMS Message">
          <textarea
            placeholder="SMS copy will appear here, or write your own…"
            value={smsCopy}
            onChange={e => setSmsCopy(e.target.value)}
            rows={4}
            maxLength={160}
            className={inputCls + ' resize-none font-mono text-xs'}
          />
          <p className={`text-right text-xs -mt-1 ${smsCopy.length > 140 ? 'text-amber-400' : 'text-neutral-600'}`}>
            {smsCopy.length}/160 chars
          </p>
        </Section>
      )}

      {/* ── Email copy ──────────────────────────────────────────────────── */}
      {showEmail && (
        <Section title="Email">
          <Field label="Subject line">
            <input
              type="text"
              placeholder="Subject will appear here…"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Email body (HTML)">
            <textarea
              placeholder="HTML email body will appear here…"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              className={inputCls + ' resize-y font-mono text-xs'}
            />
          </Field>
        </Section>
      )}

      {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}

      {result && (
        <Banner type="success" onClose={() => setResult(null)}>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">Campaign sent</span>
            {result.sms && <span>SMS: {result.sms.sent} of {result.sms.total}</span>}
            {result.email && <span>Email: {result.email.sent} of {result.email.total}</span>}
            {result.sent !== undefined && <span>{result.sent} of {result.total} contacts</span>}
          </div>
        </Banner>
      )}

      {/* ── Send ────────────────────────────────────────────────────────── */}
      <Button
        icon={Send}
        loading={sending}
        onClick={send}
        disabled={sending || !canSend}
        className="w-full"
      >
        {sending ? 'Sending…' : `Send ${active?.sendLabel || 'Campaign'}`}
      </Button>
    </div>
  )
}
