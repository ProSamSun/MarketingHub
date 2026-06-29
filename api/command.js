/**
 * POST /api/command  — AI command bar
 *
 * Takes a plain-English instruction and classifies it into a structured action
 * the frontend can route to an existing capability (workflow builder, campaign
 * sender, contact search, navigation). Uses forced tool-use so the model always
 * returns a valid, parseable intent.
 *
 * Body: { input: string }
 * Returns: { intent: {...}, message: string }
 */
import Anthropic from '@anthropic-ai/sdk'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function auth(req) {
  const t = req.headers['x-dashboard-token'] || req.body?.token
  return t === process.env.DASHBOARD_PASSWORD
}

const ROUTE_TOOL = {
  name: 'route_command',
  description: 'Route a natural-language CRM command to the correct action with extracted parameters.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create_workflow', 'campaign', 'search_contacts', 'navigate', 'unknown'],
        description:
          'create_workflow: build a multi-step automation/nurture sequence. ' +
          'campaign: send a one-off SMS, email, or reactivation blast. ' +
          'search_contacts: find/filter contacts by text or tag. ' +
          'navigate: just open a section of the app. ' +
          'unknown: the request does not map to any capability.',
      },
      description: {
        type: 'string',
        description:
          'For create_workflow only. A complete, self-contained description of the automation to build, ' +
          'phrased for an AI workflow generator (e.g. "5-day solar lead nurture sequence: welcome SMS, ' +
          'then a value email each day, ending with a booking push").',
      },
      campaignType: { type: 'string', enum: ['sms', 'email', 'reactivation'], description: 'For campaign only.' },
      businessName: { type: 'string', description: 'For campaign: the business name if stated.' },
      offer:        { type: 'string', description: 'For campaign: the offer/hook if stated.' },
      tone:         { type: 'string', enum: ['friendly', 'professional', 'urgent', 'casual', 'bold'], description: 'For campaign: tone if implied.' },
      tag:          { type: 'string', description: 'Contact tag to target (campaign) or filter by (search_contacts), e.g. "meta-lead", "cold".' },
      search:       { type: 'string', description: 'For search_contacts: free-text query (name/email/phone).' },
      destination: {
        type: 'string',
        enum: ['analytics', 'contacts', 'workflows', 'pipeline', 'campaigns', 'inbox'],
        description: 'For navigate: which section to open.',
      },
      message: {
        type: 'string',
        description: 'A short, friendly one-line confirmation of what you are doing, shown to the user.',
      },
    },
    required: ['action', 'message'],
  },
}

const SYSTEM = `You are the command router for "Marketing Hub", an AI CRM.
Map the user's instruction to exactly one action using the route_command tool.

Guidance:
- "create / build / set up a sequence, nurture, drip, follow-up, automation, workflow" → create_workflow. Put a rich, specific description in "description".
- "send / blast / text / email / reactivate / win back" a group of contacts → campaign. Pick campaignType (sms, email, or reactivation — use reactivation for win-back/cold/dormant). Extract businessName, offer, tone, and target tag when present.
- "show / find / list / who / filter / search" contacts → search_contacts. Use "tag" for "tagged X" phrasing, otherwise "search".
- "go to / open / show me the <section>" with no other intent → navigate.
- Anything unclear or unsupported → unknown.
Always include a concise, friendly "message".`

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  let body = {}
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  const input = (body.input || '').trim()
  if (!input) return res.status(400).json({ error: 'input required' })

  try {
    const msg = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: SYSTEM,
      tools: [ROUTE_TOOL],
      tool_choice: { type: 'tool', name: 'route_command' },
      messages: [{ role: 'user', content: input }],
    })

    const toolUse = msg.content.find(b => b.type === 'tool_use')
    const intent = toolUse?.input || { action: 'unknown', message: "Sorry, I couldn't understand that." }
    return res.status(200).json({ intent, message: intent.message })
  } catch (err) {
    console.error('[api/command]', err)
    return res.status(500).json({ error: err.message })
  }
}
