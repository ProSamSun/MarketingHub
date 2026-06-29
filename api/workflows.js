/**
 * /api/workflows  (scoped to the active client via x-client-id)
 * GET    — list workflows
 * POST   — create workflow
 * PUT    — update workflow
 * DELETE — delete workflow
 *
 * POST /api/workflows?action=enroll  — enroll contact
 * POST /api/workflows?action=ai      — AI builds workflow from description
 * GET  /api/workflows?action=stats   — enrollment counts per workflow
 */
import { sql, migrate, activeClientId } from './_db.js'
import { enrollContact } from './_automation.js'
import Anthropic from '@anthropic-ai/sdk'

function auth(req) {
  const t = req.headers['x-dashboard-token'] || req.body?.token
  return t === process.env.DASHBOARD_PASSWORD
}

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function aiGenerateWorkflow(description) {
  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are a CRM automation expert. Generate a workflow JSON based on this description:

"${description}"

Return ONLY a valid JSON object with this exact structure — no markdown, no explanation:
{
  "name": "Workflow name",
  "description": "Brief description",
  "trigger": "manual",
  "steps": [
    { "type": "send_sms", "body": "Hey {{firstName}}, ..." },
    { "type": "wait", "days": 1 },
    { "type": "send_email", "subject": "Subject here", "body": "<p>HTML body with {{firstName}}</p>" },
    { "type": "wait", "days": 2 },
    { "type": "send_sms", "body": "Follow-up message..." },
    { "type": "add_tag", "tag": "nurture-complete" }
  ]
}

Step types available: send_sms, send_email, wait, add_tag, remove_tag.
For wait steps, use "days" (number) and optionally "hours" (number).
Use {{firstName}}, {{lastName}}, {{fullName}}, {{email}}, {{phone}}, {{business}}, {{repName}}, {{bookingLink}} for personalization.
Make the copy compelling and specific to the description provided.`
    }]
  })

  const text = msg.content[0]?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('AI returned invalid JSON')
  }
}

// ── AI command bar: classify a plain-English instruction into a routed action ──
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
      description:  { type: 'string', description: 'For create_workflow: a full description for an AI workflow generator.' },
      campaignType: { type: 'string', enum: ['sms', 'email', 'reactivation'] },
      businessName: { type: 'string' },
      offer:        { type: 'string' },
      tone:         { type: 'string', enum: ['friendly', 'professional', 'urgent', 'casual', 'bold'] },
      tag:          { type: 'string', description: 'Contact tag to target (campaign) or filter by (search_contacts).' },
      search:       { type: 'string', description: 'For search_contacts: free-text query.' },
      destination:  { type: 'string', enum: ['analytics', 'contacts', 'workflows', 'pipeline', 'campaigns', 'inbox'] },
      message:      { type: 'string', description: 'A short, friendly one-line confirmation shown to the user.' },
    },
    required: ['action', 'message'],
  },
}

const COMMAND_SYSTEM = `You are the command router for "Marketing Hub", an AI CRM.
Map the user's instruction to exactly one action using the route_command tool.
- "create / build a sequence, nurture, drip, follow-up, automation" → create_workflow (rich "description").
- "send / blast / text / email / reactivate / win back" a group → campaign (pick campaignType; reactivation for win-back; extract businessName/offer/tone/tag).
- "show / find / list / who / filter / search" contacts → search_contacts ("tag" for "tagged X", else "search").
- "go to / open / show me the <section>" → navigate.
- Anything unclear → unknown. Always include a concise, friendly "message".`

async function routeCommand(input) {
  const msg = await claude.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: COMMAND_SYSTEM,
    tools: [ROUTE_TOOL],
    tool_choice: { type: 'tool', name: 'route_command' },
    messages: [{ role: 'user', content: input }],
  })
  const toolUse = msg.content.find(b => b.type === 'tool_use')
  return toolUse?.input || { action: 'unknown', message: "Sorry, I couldn't understand that." }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token, x-client-id')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const db = sql()
  const cid = await activeClientId(req)

  let body = {}
  if (req.method !== 'GET') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  }

  const action = req.query.action

  try {
    // ── AI: generate workflow from description ────────────────────────────
    if (action === 'ai') {
      const { description } = body
      if (!description) return res.status(400).json({ error: 'description required' })
      const workflow = await aiGenerateWorkflow(description)
      return res.status(200).json({ workflow })
    }

    // ── AI command bar: classify a plain-English instruction ──────────────
    if (action === 'command') {
      const input = (body.input || '').trim()
      if (!input) return res.status(400).json({ error: 'input required' })
      const intent = await routeCommand(input)
      return res.status(200).json({ intent, message: intent.message })
    }

    // ── Enroll contact in workflow ────────────────────────────────────────
    if (action === 'enroll') {
      const { contactId, workflowId } = body
      if (!contactId || !workflowId) return res.status(400).json({ error: 'contactId and workflowId required' })
      // Ensure both belong to this client
      const [wf] = await db`SELECT id FROM workflows WHERE id = ${workflowId} AND client_id = ${cid}`
      const [ct] = await db`SELECT id FROM contacts WHERE id = ${contactId} AND client_id = ${cid}`
      if (!wf || !ct) return res.status(404).json({ error: 'Workflow or contact not found for this client' })
      const result = await enrollContact(contactId, workflowId, cid)
      return res.status(200).json(result)
    }

    // ── Enrollment stats per workflow ─────────────────────────────────────
    if (action === 'stats') {
      const stats = await db`
        SELECT w.id AS workflow_id,
               COUNT(e.id)::int AS total,
               COUNT(*) FILTER (WHERE e.status = 'active')::int    AS active,
               COUNT(*) FILTER (WHERE e.status = 'completed')::int AS completed,
               COUNT(*) FILTER (WHERE e.status = 'replied')::int   AS replied,
               COUNT(*) FILTER (WHERE e.status = 'error')::int     AS error
        FROM workflows w
        LEFT JOIN enrollments e ON e.workflow_id = w.id
        WHERE w.client_id = ${cid}
        GROUP BY w.id
      `
      return res.status(200).json({ stats })
    }

    if (req.method === 'GET') {
      const workflows = await db`SELECT * FROM workflows WHERE client_id = ${cid} ORDER BY created_at DESC`
      return res.status(200).json({ workflows })
    }

    if (req.method === 'POST') {
      const { name, description, trigger = 'manual', steps = [], active = true } = body
      if (!name) return res.status(400).json({ error: 'name required' })
      const [workflow] = await db`
        INSERT INTO workflows (client_id, name, description, trigger, steps, active)
        VALUES (${cid}, ${name}, ${description || ''}, ${trigger}, ${JSON.stringify(steps)}, ${active})
        RETURNING *
      `
      return res.status(201).json({ workflow })
    }

    if (req.method === 'PUT') {
      const { id, name, description, trigger, steps, active } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`
        UPDATE workflows SET
          name        = COALESCE(${name        ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          trigger     = COALESCE(${trigger     ?? null}, trigger),
          steps       = COALESCE(${steps ? JSON.stringify(steps) : null}::jsonb, steps),
          active      = COALESCE(${active      ?? null}, active)
        WHERE id = ${id} AND client_id = ${cid}
      `
      const [workflow] = await db`SELECT * FROM workflows WHERE id = ${id} AND client_id = ${cid}`
      return res.status(200).json({ workflow })
    }

    if (req.method === 'DELETE') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`DELETE FROM workflows WHERE id = ${id} AND client_id = ${cid}`
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[api/workflows]', err)
    return res.status(500).json({ error: err.message })
  }
}
