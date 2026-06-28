import { useState } from 'react'
import { Sparkles, Send, CheckCircle, AlertCircle } from 'lucide-react'

const MODE_CONFIG = {
  sms: {
    label: 'SMS Campaign',
    description: 'Send a text message to all contacts with a specific tag.',
    copyType: 'sms',
    sendAction: 'send-sms',
    charLimit: 160,
  },
  email: {
    label: 'Email Campaign',
    description: 'Send an email to all contacts with a specific tag.',
    copyType: 'email_subject',
    sendAction: 'send-email',
  },
  reactivation: {
    label: 'Reactivation Campaign',
    description: 'Win back cold leads — Claude writes an SMS + email, both sent automatically.',
    sendAction: 'reactivation',
    isCombo: true,
  },
}

export default function CampaignBuilder({ token, mode }) {
  const config = MODE_CONFIG[mode]

  const [businessName, setBusinessName] = useState('')
  const [offer, setOffer] = useState('')
  const [tone, setTone] = useState('friendly')
  const [tag, setTag] = useState('meta-lead')
  const [smsCopy, setSmsCopy] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function api(body) {
    const res = await fetch('/api/campaign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dashboard-token': token,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }

  async function generateCopy() {
    if (!businessName || !offer) { setError('Business name and offer are required.'); return }
    setError('')
    setGenerating(true)
    try {
      if (mode === 'sms') {
        const { copy } = await api({ action: 'generate-copy', type: 'sms', businessName, offer, tone })
        setSmsCopy(copy)
      } else if (mode === 'email') {
        const [subjRes, bodyRes] = await Promise.all([
          api({ action: 'generate-copy', type: 'email_subject', businessName, offer, tone }),
          api({ action: 'generate-copy', type: 'email_body', businessName, offer, tone }),
        ])
        // Parse subject options
        try {
          const arr = JSON.parse(subjRes.copy)
          setEmailSubject(Array.isArray(arr) ? arr[0] : subjRes.copy)
        } catch { setEmailSubject(subjRes.copy) }
        setEmailBody(bodyRes.copy)
      } else if (mode === 'reactivation') {
        const [smsRes, subjRes, bodyRes] = await Promise.all([
          api({ action: 'generate-copy', type: 'reactivation_sms', businessName, offer, tone }),
          api({ action: 'generate-copy', type: 'email_subject', businessName, offer, tone }),
          api({ action: 'generate-copy', type: 'reactivation_email', businessName, offer, tone }),
        ])
        setSmsCopy(smsRes.copy)
        try {
          const arr = JSON.parse(subjRes.copy)
          setEmailSubject(Array.isArray(arr) ? arr[0] : subjRes.copy)
        } catch { setEmailSubject(subjRes.copy) }
        setEmailBody(bodyRes.copy)
      }
    } catch (err) {
      setError(err.message)
    }
    setGenerating(false)
  }

  async function send() {
    setError('')
    setSending(true)
    setResult(null)
    try {
      let data
      if (mode === 'sms') {
        if (!smsCopy) throw new Error('Generate or write SMS copy first.')
        data = await api({ action: 'send-sms', tag, message: smsCopy })
      } else if (mode === 'email') {
        if (!emailSubject || !emailBody) throw new Error('Generate or write email copy first.')
        data = await api({ action: 'send-email', tag, subject: emailSubject, html: emailBody, fromName, fromEmail })
      } else if (mode === 'reactivation') {
        data = await api({ action: 'reactivation', businessName, offer, tag, fromName, fromEmail })
        setSmsCopy(data.sms?.copy || smsCopy)
        setEmailSubject(data.email?.subject || emailSubject)
      }
      setResult(data)
    } catch (err) {
      setError(err.message)
    }
    setSending(false)
  }

  const canSend = mode === 'reactivation'
    ? businessName && offer
    : (mode === 'sms' ? smsCopy : (emailSubject && emailBody))

  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <p className="text-xs text-neutral-500">{config.description}</p>
      </div>

      {/* Basic inputs */}
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
        {(mode === 'email' || mode === 'reactivation') && (
          <>
            <Field label="From name">
              <input type="text" placeholder="John at Apex Solar" value={fromName} onChange={e => setFromName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="From email">
              <input type="email" placeholder="john@apexsolar.com" value={fromEmail} onChange={e => setFromEmail(e.target.value)} className={inputCls} />
            </Field>
          </>
        )}
      </Section>

      {/* Generate button */}
      <button
        onClick={generateCopy}
        disabled={generating || !businessName || !offer}
        className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 rounded-xl py-3 text-sm font-medium transition-colors"
      >
        <Sparkles size={15} className={generating ? 'animate-pulse text-violet-400' : 'text-violet-400'} />
        {generating ? 'Claude is writing…' : 'Generate copy with Claude AI'}
      </button>

      {/* SMS copy */}
      {(mode === 'sms' || mode === 'reactivation') && (
        <Section title="SMS Message">
          <textarea
            placeholder="SMS copy will appear here, or write your own…"
            value={smsCopy}
            onChange={e => setSmsCopy(e.target.value)}
            rows={4}
            maxLength={160}
            className={inputCls + ' resize-none font-mono text-xs'}
          />
          <p className={`text-right text-xs mt-1 ${smsCopy.length > 140 ? 'text-amber-400' : 'text-neutral-600'}`}>
            {smsCopy.length}/160 chars
          </p>
        </Section>
      )}

      {/* Email copy */}
      {(mode === 'email' || mode === 'reactivation') && (
        <Section title="Email">
          <Field label="Subject line">
            <input
              type="text"
              placeholder="Subject will appear here…"
              value={emailSubject}
              onChange={e => setEmailSubject(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Email body (HTML)">
            <textarea
              placeholder="HTML email body will appear here…"
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              rows={8}
              className={inputCls + ' resize-y font-mono text-xs'}
            />
          </Field>
        </Section>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-xl px-4 py-3 text-sm flex flex-col gap-1">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle size={15} /> Campaign sent
          </div>
          {result.sms && <p>SMS: {result.sms.sent} sent of {result.sms.total} contacts</p>}
          {result.email && <p>Email: {result.email.sent} sent of {result.email.total} contacts</p>}
          {result.sent !== undefined && <p>{result.sent} sent of {result.total} contacts</p>}
        </div>
      )}

      <button
        onClick={send}
        disabled={sending || !canSend}
        className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl py-3.5 text-sm font-semibold transition-colors"
      >
        <Send size={15} />
        {sending ? 'Sending…' : `Send ${config.label}`}
      </button>
    </div>
  )
}

const inputCls = 'w-full bg-neutral-950 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-violet-500 transition-colors'

function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-neutral-400">
        {label}{required && <span className="text-violet-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
