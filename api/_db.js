/**
 * Database client — Neon serverless Postgres
 * Every table is created here if it doesn't exist (auto-migration on first call).
 */

import { neon } from '@neondatabase/serverless'

let _sql = null

export function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
    _sql = neon(process.env.DATABASE_URL)
  }
  return _sql
}

let _migrated = false

export async function migrate() {
  // Schema is idempotent; skip re-running within a warm serverless instance.
  if (_migrated) return { ok: true }
  const db = sql()

  // ── Tenancy: a "client" is an agency client business that owns its own data ──
  await db`
    CREATE TABLE IF NOT EXISTS clients (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL,
      slug          TEXT UNIQUE,
      industry      TEXT,
      offer         TEXT,
      outcome       TEXT,
      tone          TEXT DEFAULT 'friendly',
      rep_name      TEXT,
      from_name     TEXT,
      from_email    TEXT,
      twilio_number TEXT,
      booking_link  TEXT,
      lead_tag      TEXT DEFAULT 'new-lead',
      meta_page_ids TEXT[] DEFAULT '{}',
      meta_form_ids TEXT[] DEFAULT '{}',
      meta_page_token TEXT,
      meta_ad_account_id TEXT,
      meta_ads_token TEXT,
      meta_last_sync TIMESTAMPTZ,
      metadata      JSONB DEFAULT '{}',
      active        BOOLEAN DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `

  // A "Default" client owns all data that predates multi-tenancy.
  await db`
    INSERT INTO clients (name, slug)
    SELECT 'Default', 'default'
    WHERE NOT EXISTS (SELECT 1 FROM clients WHERE slug = 'default')
  `

  await db`
    CREATE TABLE IF NOT EXISTS contacts (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name  TEXT,
      last_name   TEXT,
      email       TEXT,
      phone       TEXT,
      tags        TEXT[]  DEFAULT '{}',
      source      TEXT,
      notes       TEXT,
      metadata    JSONB   DEFAULT '{}',
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `

  await db`
    CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email)
  `

  await db`
    CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts(phone)
  `

  await db`
    CREATE TABLE IF NOT EXISTS workflows (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      description TEXT,
      trigger     TEXT NOT NULL DEFAULT 'manual',
      steps       JSONB NOT NULL DEFAULT '[]',
      active      BOOLEAN DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `

  await db`
    CREATE TABLE IF NOT EXISTS enrollments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
      workflow_id   UUID REFERENCES workflows(id) ON DELETE CASCADE,
      current_step  INT DEFAULT 0,
      status        TEXT DEFAULT 'active',
      next_run_at   TIMESTAMPTZ DEFAULT now(),
      started_at    TIMESTAMPTZ DEFAULT now(),
      completed_at  TIMESTAMPTZ,
      UNIQUE(contact_id, workflow_id)
    )
  `

  await db`
    CREATE INDEX IF NOT EXISTS enrollments_next_run_idx ON enrollments(next_run_at)
      WHERE status = 'active'
  `

  await db`
    CREATE TABLE IF NOT EXISTS messages (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id  UUID REFERENCES contacts(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      direction   TEXT NOT NULL DEFAULT 'outbound',
      subject     TEXT,
      body        TEXT NOT NULL,
      status      TEXT DEFAULT 'sent',
      metadata    JSONB DEFAULT '{}',
      sent_at     TIMESTAMPTZ DEFAULT now()
    )
  `

  await db`
    CREATE INDEX IF NOT EXISTS messages_contact_idx ON messages(contact_id)
  `

  await db`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      color      TEXT DEFAULT '#7c3aed',
      position   INT  NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `

  await db`
    INSERT INTO pipeline_stages (name, color, position)
    SELECT * FROM (VALUES
      ('New Lead',      '#6366f1', 0),
      ('Contacted',     '#8b5cf6', 1),
      ('Qualified',     '#a855f7', 2),
      ('Proposal Sent', '#ec4899', 3),
      ('Closed Won',    '#22c55e', 4),
      ('Closed Lost',   '#ef4444', 5)
    ) AS v(name, color, position)
    WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages)
  `

  await db`
    CREATE TABLE IF NOT EXISTS deals (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id  UUID REFERENCES contacts(id) ON DELETE CASCADE,
      stage_id    UUID REFERENCES pipeline_stages(id),
      title       TEXT NOT NULL,
      value       NUMERIC(12,2) DEFAULT 0,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `

  await db`
    CREATE TABLE IF NOT EXISTS campaigns (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      subject     TEXT,
      body        TEXT NOT NULL,
      tags_filter TEXT[],
      status      TEXT DEFAULT 'draft',
      stats       JSONB DEFAULT '{"sent":0,"delivered":0,"opened":0,"clicked":0}',
      sent_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `

  // ── Multi-tenant retrofit: add client_id to existing tables + backfill ────────
  await db`ALTER TABLE contacts        ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE workflows       ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE deals           ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE messages        ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE enrollments     ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE campaigns       ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE`
  await db`ALTER TABLE clients         ADD COLUMN IF NOT EXISTS meta_page_token TEXT`
  await db`ALTER TABLE clients         ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT`
  await db`ALTER TABLE clients         ADD COLUMN IF NOT EXISTS meta_ads_token TEXT`
  await db`ALTER TABLE clients         ADD COLUMN IF NOT EXISTS meta_last_sync TIMESTAMPTZ`

  await db`UPDATE contacts        SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`
  await db`UPDATE workflows       SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`
  await db`UPDATE pipeline_stages SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`
  await db`UPDATE deals           SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`
  await db`UPDATE messages        SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`
  await db`UPDATE enrollments     SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`
  await db`UPDATE campaigns       SET client_id = (SELECT id FROM clients WHERE slug='default') WHERE client_id IS NULL`

  // Non-unique (existing data may legitimately repeat an email); app-level dedupe is client-scoped.
  await db`CREATE INDEX IF NOT EXISTS contacts_client_email_idx ON contacts(client_id, email)`
  await db`CREATE INDEX IF NOT EXISTS contacts_client_idx        ON contacts(client_id)`
  await db`CREATE INDEX IF NOT EXISTS workflows_client_idx       ON workflows(client_id)`
  await db`CREATE INDEX IF NOT EXISTS pipeline_stages_client_idx ON pipeline_stages(client_id)`
  await db`CREATE INDEX IF NOT EXISTS deals_client_idx           ON deals(client_id)`
  await db`CREATE INDEX IF NOT EXISTS messages_client_idx        ON messages(client_id)`
  await db`CREATE INDEX IF NOT EXISTS enrollments_client_idx     ON enrollments(client_id)`

  _migrated = true
  return { ok: true }
}

// ── Tenant resolution ─────────────────────────────────────────────────────────
let _defaultClientId = null

export async function defaultClientId() {
  if (_defaultClientId) return _defaultClientId
  const [c] = await sql()`SELECT id FROM clients WHERE slug = 'default' LIMIT 1`
  _defaultClientId = c?.id || null
  return _defaultClientId
}

/**
 * The client the current request is scoped to. The dashboard sends x-client-id;
 * everything falls back to the Default client. This is organizational scoping for
 * the single agency owner (shared DASHBOARD_PASSWORD), not a security boundary.
 */
export async function activeClientId(req) {
  const h = req.headers['x-client-id']
  if (h) return h
  return defaultClientId()
}
