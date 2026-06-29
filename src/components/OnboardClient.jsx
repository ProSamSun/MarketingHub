import { useState } from 'react'
import { Sparkles, Rocket, CheckCircle } from 'lucide-react'
import { Modal, Field, Button, Banner, Toggle, inputCls, labelCls } from '../lib/ui.jsx'

const EMPTY = {
  name: '', industry: '', offer: '', outcome: '', tone: 'friendly',
  repName: '', fromName: '', fromEmail: '', twilioNumber: '', bookingLink: '',
  leadTag: 'new-lead', metaPageIds: '', metaFormIds: '', metaPageToken: '', enrollExisting: false,
}

export default function OnboardClient({ api, open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function reset() {
    setForm(EMPTY); setError(''); setResult(null); setLoading(false)
  }

  async function submit() {
    if (!form.name.trim()) { setError('Business name is required.'); return }
    if (!form.offer.trim()) { setError('An offer / lead magnet is required — it drives all the copy.'); return }
    setError(''); setLoading(true); setResult(null)
    try {
      const payload = {
        ...form,
        metaPageIds: form.metaPageIds.split(',').map(s => s.trim()).filter(Boolean),
        metaFormIds: form.metaFormIds.split(',').map(s => s.trim()).filter(Boolean),
      }
      const data = await api.post('/api/clients?action=onboard', payload)
      setResult(data)
    } catch (e) {
      setError(e.message || 'Onboarding failed')
    } finally {
      setLoading(false)
    }
  }

  function finish() {
    const client = result?.client
    reset()
    onClose()
    if (client) onCreated?.(client)
  }

  // Success screen
  if (result) {
    return (
      <Modal open={open} onClose={finish} title="Client onboarded" footer={<Button icon={CheckCircle} onClick={finish}>Open {result.client?.name}</Button>}>
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="grid place-items-center w-12 h-12 rounded-full bg-violet-600/20 text-violet-300"><Rocket size={22} /></div>
          <h3 className="font-semibold">{result.client?.name} is live 🎉</h3>
          <p className="text-sm text-neutral-400">Their lead machine is ready:</p>
          <ul className="text-sm text-neutral-300 flex flex-col gap-1.5 mt-1 w-full">
            <li className="flex justify-between border-b border-neutral-800 pb-1.5"><span>Automations generated</span><span className="font-semibold">{result.workflows?.length || 0}</span></li>
            <li className="flex justify-between border-b border-neutral-800 pb-1.5"><span>Pipeline stages</span><span className="font-semibold">{result.stages || 0}</span></li>
            {result.enrolled > 0 && <li className="flex justify-between border-b border-neutral-800 pb-1.5"><span>Existing leads enrolled</span><span className="font-semibold">{result.enrolled}</span></li>}
          </ul>
          <div className="flex flex-wrap gap-1.5 justify-center mt-2">
            {(result.workflows || []).map(w => (
              <span key={w.id} className="text-[11px] bg-neutral-800 text-neutral-300 rounded-full px-2.5 py-1">{w.name}</span>
            ))}
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={loading ? undefined : () => { reset(); onClose() }}
      wide
      title="Onboard a client"
      footer={
        <>
          <Button variant="ghost" disabled={loading} onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button icon={Sparkles} loading={loading} onClick={submit}>
            {loading ? 'Building lead machine…' : 'Generate lead machine'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-neutral-500">
          Claude generates a full lead-gen system for this business — Speed-to-Lead, nurture, appointment
          reminders, no-show recovery, reactivation, and review/referral — plus a pipeline, all tailored to the
          details below.
        </p>

        {error && <Banner type="error" onClose={() => setError('')}>{error}</Banner>}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Business name" required>
            <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Apex Solar" />
          </Field>
          <Field label="Industry / niche">
            <input className={inputCls} value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Residential solar" />
          </Field>
        </div>

        <Field label="Primary offer / lead magnet" required hint="What the lead opted in for — drives every message.">
          <textarea rows={2} className={`${inputCls} resize-none`} value={form.offer} onChange={e => set('offer', e.target.value)} placeholder="Free energy savings audit + $0-down install quote" />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Desired outcome" hint="What you want leads to do.">
            <input className={inputCls} value={form.outcome} onChange={e => set('outcome', e.target.value)} placeholder="Book a free consultation" />
          </Field>
          <Field label="Tone">
            <select className={inputCls} value={form.tone} onChange={e => set('tone', e.target.value)}>
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="urgent">Urgent</option>
              <option value="casual">Casual</option>
              <option value="bold">Bold</option>
            </select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Rep name" hint="Who the texts/emails come from.">
            <input className={inputCls} value={form.repName} onChange={e => set('repName', e.target.value)} placeholder="John" />
          </Field>
          <Field label="Booking link" hint="Calendly / GHL / Cal.com — used in appointment flows.">
            <input className={inputCls} value={form.bookingLink} onChange={e => set('bookingLink', e.target.value)} placeholder="https://calendly.com/apex/intro" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="From email" hint="Sender for emails (needs a verified Resend domain).">
            <input type="email" className={inputCls} value={form.fromEmail} onChange={e => set('fromEmail', e.target.value)} placeholder="john@apexsolar.com" />
          </Field>
          <Field label="Twilio number (optional)" hint="Dedicated SMS number for this client.">
            <input className={inputCls} value={form.twilioNumber} onChange={e => set('twilioNumber', e.target.value)} placeholder="+1 555 010 1234" />
          </Field>
        </div>

        <details className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3">
          <summary className="text-xs font-medium text-neutral-400 cursor-pointer">Lead routing & advanced (optional)</summary>
          <div className="flex flex-col gap-4 mt-3">
            <Field label="Lead tag" hint="New leads for this client get this tag.">
              <input className={inputCls} value={form.leadTag} onChange={e => set('leadTag', e.target.value)} placeholder="new-lead" />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Meta Page ID(s)" hint="Comma-separated — routes Meta leads here.">
                <input className={inputCls} value={form.metaPageIds} onChange={e => set('metaPageIds', e.target.value)} placeholder="1029384756" />
              </Field>
              <Field label="Meta Form ID(s)" hint="Comma-separated.">
                <input className={inputCls} value={form.metaFormIds} onChange={e => set('metaFormIds', e.target.value)} placeholder="form_123, form_456" />
              </Field>
            </div>
            <Field label="Meta Page Access Token" hint="Long-lived Page token with leads_retrieval — required to pull lead data. You can also add this later in Settings.">
              <input type="password" className={inputCls} value={form.metaPageToken} onChange={e => set('metaPageToken', e.target.value)} placeholder="EAAB..." />
            </Field>
          </div>
        </details>

        <div className="flex items-center justify-between gap-3 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm text-neutral-200">Enroll existing leads</p>
            <p className={labelCls}>Drop current leads tagged “{form.leadTag || 'new-lead'}” into the nurture sequence.</p>
          </div>
          <Toggle checked={form.enrollExisting} onChange={v => set('enrollExisting', v)} label="Enroll existing leads" />
        </div>

        {loading && (
          <p className="text-xs text-neutral-500 text-center">Generating tailored copy across 6 automations — this can take up to a minute.</p>
        )}
      </div>
    </Modal>
  )
}
