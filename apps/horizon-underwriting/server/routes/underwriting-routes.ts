import { randomUUID } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import { z } from 'zod';
import { GenieAskBody, streamGenieAnswer } from './genie-agent';
import {
  DECISION_BY_ID_SQL, DECISIONS_SQL, DISTRIBUTION_SQL, INSERT_AUDIT_SQL, INSERT_DECISION_SQL, NEXT_POLICY_SQL, POLICY_SQL, PORTFOLIO_SQL, QUEUE_SQL, USER_VIEWS_SQL,
} from './policy-queries';

interface LakebaseQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

interface AppKitRuntime {
  // query runs as the app service principal; asUser(req) routes to the caller's own Postgres
  // role (AppKit's per-user pool), so views scoped by current_user filter to that user.
  lakebase: LakebaseQuery & { asUser(req: Request): LakebaseQuery };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const ACTION_CODES = ['NO_ACTION', 'SAFE_DRIVING_COACHING', 'DEDUCTIBLE_REVIEW', 'HUMAN_RENEWAL_REVIEW'] as const;

const DecisionBody = z.object({
  policyId: z.string().min(1),
  decision: z.enum(['APPROVED', 'OVERRIDDEN', 'INTERVENTION_ASSIGNED']),
  recommendedAction: z.enum(ACTION_CODES),
  selectedAction: z.enum(ACTION_CODES),
  overrideReason: z.string().optional(),
  notes: z.string().max(4000).optional(),
  modelVersion: z.string().optional(),
});


// Lakebase errors become JSON so the client can show them in its error states.
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (cause) {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(500).json({ error: cause instanceof Error ? cause.message : 'Request failed' });
    }
  };
}

function userEmail(req: Request) {
  return req.header('x-forwarded-email') ?? req.header('x-forwarded-user') ?? 'local-demo-user';
}

// Region-scoped views over the synced tables, owned by the service principal (which holds SELECT
// on the synced schema). Needs the serving bundle's synced tables; until they exist the app
// starts without them and data routes return an error.
async function ensureUserViews(appkit: AppKitRuntime) {
  const synced = await appkit.lakebase.query(
    `SELECT COUNT(*)::int AS count FROM pg_catalog.pg_tables
     WHERE schemaname = 'horizon_auto'
       AND tablename IN ('policy_risk_decisions_synced', 'underwriter_region_assignments_synced')`,
  );
  if (Number(synced.rows[0]?.count) !== 2) {
    console.warn('[horizon] Lakebase synced tables missing; deploy serving/ before using the app.');
    return;
  }
  try {
    await appkit.lakebase.query(USER_VIEWS_SQL);
  } catch (cause) {
    // Non-owners (local dev) cannot replace the service principal's views; existing ones still work.
    console.warn(`[horizon] Could not refresh user views: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function ensureSchema(appkit: AppKitRuntime) {
  // Tables are owned by whichever identity created them (the app service principal when deployed).
  // CREATE INDEX checks ownership even with IF NOT EXISTS, so skip DDL when the tables already exist;
  // otherwise a non-owner identity (e.g. local `npm run dev`) fails at startup.
  const existing = await appkit.lakebase.query(
    `SELECT COUNT(*)::int AS count FROM pg_catalog.pg_tables
     WHERE schemaname = 'horizon_app' AND tablename IN ('underwriting_decisions', 'audit_events')`,
  );
  if (Number(existing.rows[0]?.count) === 2) return;

  await appkit.lakebase.query(`
    CREATE SCHEMA IF NOT EXISTS horizon_app;

    CREATE TABLE IF NOT EXISTS horizon_app.underwriting_decisions (
      decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id TEXT NOT NULL,
      reviewer_email TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'OVERRIDDEN', 'INTERVENTION_ASSIGNED')),
      recommended_action TEXT NOT NULL,
      selected_action TEXT NOT NULL,
      override_reason TEXT,
      notes TEXT,
      model_version TEXT,
      decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS horizon_app.audit_events (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id TEXT,
      actor_email TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_underwriting_decisions_policy
      ON horizon_app.underwriting_decisions(policy_id, decided_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_policy
      ON horizon_app.audit_events(policy_id, occurred_at DESC);
  `);
}

export async function setupUnderwritingRoutes(appkit: AppKitRuntime) {
  await ensureSchema(appkit);
  await ensureUserViews(appkit);

  appkit.server.extend((app) => {
    app.get('/api/whoami', (req, res) => {
      res.json({ email: userEmail(req), executionIdentity: 'on-behalf-of-user' });
    });

    app.get('/api/queue', handle(async (req, res) => {
      const status = req.query.status === 'decided' || req.query.status === 'all' ? req.query.status : 'open';
      const result = await appkit.lakebase.asUser(req).query(QUEUE_SQL, [status]);
      res.json(result.rows);
    }));

    app.get('/api/portfolio', handle(async (req, res) => {
      const db = appkit.lakebase.asUser(req);
      const [summary, distribution] = await Promise.all([db.query(PORTFOLIO_SQL), db.query(DISTRIBUTION_SQL)]);
      res.json({ ...summary.rows[0], distribution: distribution.rows });
    }));

    app.get('/api/policies/:policyId', handle(async (req, res) => {
      const policyId = String(req.params.policyId);
      const db = appkit.lakebase.asUser(req);
      const [policy, next] = await Promise.all([db.query(POLICY_SQL, [policyId]), db.query(NEXT_POLICY_SQL, [policyId])]);
      if (!policy.rows[0]) {
        res.status(404).json({ error: `${policyId} is not a policy in your regions.` });
        return;
      }
      res.json({ ...policy.rows[0], next_policy_id: next.rows[0]?.policy_id ?? null });
    }));

    app.get('/api/decisions', handle(async (req, res) => {
      const policyId = typeof req.query.policyId === 'string' ? req.query.policyId : null;
      const result = await appkit.lakebase.asUser(req).query(DECISIONS_SQL, [policyId]);
      res.json(result.rows);
    }));

    app.post('/api/decisions', handle(async (req, res) => {
      const parsed = DecisionBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const input = parsed.data;
      if (input.decision === 'OVERRIDDEN' && !input.overrideReason?.trim()) {
        res.status(400).json({ error: 'overrideReason is required for overrides' });
        return;
      }
      // Written as the caller: reviewer_email is the database identity, and the insert only
      // succeeds for a policy the caller is entitled to see.
      const db = appkit.lakebase.asUser(req);
      const decisionId = randomUUID();
      const inserted = await db.query(INSERT_DECISION_SQL, [
        decisionId, input.policyId, input.decision, input.recommendedAction, input.selectedAction,
        input.overrideReason ?? null, input.notes ?? null, input.modelVersion ?? null,
      ]);
      if (!inserted.rowCount) {
        res.status(403).json({ error: `${input.policyId} is not a policy in your regions.` });
        return;
      }
      await db.query(INSERT_AUDIT_SQL, [input.policyId, 'UNDERWRITING_DECISION', JSON.stringify({ decisionId, ...input })]);
      const recorded = await db.query(DECISION_BY_ID_SQL, [decisionId]);
      res.status(201).json(recorded.rows[0]);
    }));

    app.post('/api/genie/ask', handle(async (req, res) => {
      const parsed = GenieAskBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await appkit.lakebase.asUser(req).query(INSERT_AUDIT_SQL, [
        parsed.data.policyId ?? null, 'GENIE_QUESTION', JSON.stringify({ conversationId: parsed.data.conversationId ?? null, question: parsed.data.question }),
      ]);
      await streamGenieAnswer(req, res, parsed.data);
    }));
  });
}
