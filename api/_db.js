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

export async function migrate() {
  const db = sql()

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

  return { ok: true }
}
