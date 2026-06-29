import { useEffect, useState } from 'react'
import { Save, Copy, Check, Mail, MessageSquare, Megaphone, ShieldCheck } from 'lucide-react'
import { Card, Section, Field, Button, Banner, Loading, inputCls, labelCls } from '../../lib/ui.jsx'

function toForm(c) {
  return {
    name: c?.name || '', industry: c?.industry || '', offer: c?.offer || '', outcome: c?.outcome || '',
    tone: c?.tone || 'friendly', repName: c?.rep_name || '', fromName: c?.from_name || '',
    fromEmail: c?.from_email || '', twilioNumber: c?.twilio_number || '', bookingLink: c?.booking_link || '',
    leadTag: c?.lead_tag || 'new-lead',
    metaPageIds: (c?.meta_page_ids || []).join(', '),
    metaFormIds: (c?.meta_form_ids || []).join(', '),
    metaPageToken: '', // write-only
  }
}

export default function Settings({ api, client, onSaved }) {
  const [form, setForm] = useState(() => toForm(client))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => { setForm(toForm(client)); setOk(false); setError('') }, [client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!client) return <Loading label="Loading client…" />

  async function save() {
    setError(''); setOk(false); setSaving(true)
    try {
      const payload = {
        id: client.id,
        name: form.name, industry: form.industry, offer: form.offer, outcome: form.outcome,
        tone: form.tone, repName: form.repName, fromName: form.fromName, fromEmail: form.fromEmail,
        twilioNumber: form.twilioNumber, bookingLink: form.bookingLink, leadTag: form.leadTag,
        metaPageIds: form.metaPageIds.split(',').map(s => s.trim()).filter(Boolean),
        metaFormIds: form.metaFormIds.split(',').map(s => s.trim()).filter(Boolean),
      }
      if (form.metaPageToken.trim()) payload.metaPageToken = form.metaPageToken.trim()
      await api.put('/api/clients', payload)
      setOk(true)
      onSaved?.()
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const base = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Settings</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{client.name} · integrations & sender identity</p>
        </div>
        <Button icon={Save} loading={saving} onClick={save}>Save</Button>
      </div>

      {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}
      {ok && <Banner type="success" onClose={() => setOk(false)}>Saved.</Banner>}

      {/* Business */}
      <Section title="Business">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Business name"><input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="Industry"><input className={inputCls} value={form.industry} onChange={e => set('industry', e.target.value)} /></Field>
        </div>
        <Field label="Offer / lead magnet"><textarea rows={2} className={`${inputCls} resize-none`} value={form.offer} onChange={e => set('offer', e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Desired outcome"><input className={inputCls} value={form.outcome} onChange={e => set('outcome', e.target.value)} /></Field>
          <Field label="Tone">
            <select className={inputCls} value={form.tone} onChange={e => set('tone', e.target.value)}>
              {['friendly', 'professional', 'urgent', 'casual', 'bold'].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      {/* Sender identity */}
      <Section title="Sender identity">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Rep name" hint="Who texts/emails come from."><input className={inputCls} value={form.repName} onChange={e => set('repName', e.target.value)} /></Field>
          <Field label="Booking link" hint="Used in appointment flows."><input className={inputCls} value={form.bookingLink} onChange={e => set('bookingLink', e.target.value)} placeholder="https://calendly.com/..." /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="From email" hint="Verified Resend domain."><input type="email" className={inputCls} value={form.fromEmail} onChange={e => set('fromEmail', e.target.value)} /></Field>
          <Field label="Twilio number" hint="Dedicated SMS number (optional)."><input className={inputCls} value={form.twilioNumber} onChange={e => set('twilioNumber', e.target.value)} placeholder="+1..." /></Field>
        </div>
      </Section>

      {/* Meta integration */}
      <Section title="Meta Lead Ads">
        <Card className="p-4 flex flex-col gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Lead tag" hint="New leads get this tag."><input className={inputCls} value={form.leadTag} onChange={e => set('leadTag', e.target.value)} /></Field>
            <Field label="Facebook Page ID(s)" hint="Comma-separated — routes leads here."><input className={inputCls} value={form.metaPageIds} onChange={e => set('metaPageIds', e.target.value)} placeholder="102938..." /></Field>
          </div>
          <Field label="Lead form ID(s)" hint="Optional, comma-separated."><input className={inputCls} value={form.metaFormIds} onChange={e => set('metaFormIds', e.target.value)} /></Field>
          <Field
            label="Page Access Token"
            hint={client.meta_page_token_set ? '✓ A token is configured. Leave blank to keep it, or paste a new one to replace.' : 'Required to fetch lead data from Meta. Long-lived Page token with leads_retrieval.'}
          >
            <input
              type="password"
              className={inputCls}
              value={form.metaPageToken}
              onChange={e => set('metaPageToken', e.target.value)}
              placeholder={client.meta_page_token_set ? '•••••••• (configured)' : 'EAAB...'}
            />
          </Field>
        </Card>
      </Section>

      {/* Connection endpoints */}
      <Section title="Connection URLs">
        <Card className="p-4 flex flex-col gap-3">
          <CopyRow icon={Megaphone} label="Meta webhook (Callback URL)" value={`${base}/api/webhook-meta`} />
          <CopyRow icon={MessageSquare} label="Twilio inbound SMS webhook" value={`${base}/api/webhook-twilio`} />
          <CopyRow icon={Mail} label="Unsubscribe link base" value={`${base}/api/unsubscribe`} />
          <CopyRow icon={ShieldCheck} label="Cron endpoint (for external scheduler)" value={`${base}/api/cron`} />
          <p className={labelCls}>Meta verify token = your <code>META_WEBHOOK_VERIFY_TOKEN</code> env var. Subscribe the <b>leadgen</b> field and your Page.</p>
        </Card>
      </Section>
    </div>
  )
}

function CopyRow({ icon: Icon, label, value }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* noop */ }
  }
  return (
    <div className="flex items-center gap-3">
      <Icon size={15} className="text-red-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-neutral-400">{label}</p>
        <p className="text-xs text-neutral-200 font-mono truncate">{value}</p>
      </div>
      <button onClick={copy} className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 shrink-0" aria-label="Copy">
        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
    </div>
  )
}
