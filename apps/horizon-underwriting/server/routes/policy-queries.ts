// Lakebase reads run as the signed-in user (lakebase.asUser) against views scoped by
// current_user. The views are owned by the app service principal; users get SELECT on the
// views only, never on the synced tables, so Postgres enforces the same region entitlements
// as the Unity Catalog row filter (underwriter_region_assignments, synced from UC).
// Casts: Postgres BIGINT arrives as a string in node-postgres and DATE as a local Date, so
// counts are cast to int and dates to ISO text.

export const USER_VIEWS_SQL = `
  CREATE OR REPLACE VIEW horizon_app.my_policy_risk_decisions WITH (security_barrier) AS
  SELECT d.*
  FROM horizon_auto.policy_risk_decisions_synced AS d
  JOIN horizon_auto.underwriter_region_assignments_synced AS a
    ON a.region = d.region AND a.principal = current_user;

  CREATE OR REPLACE VIEW horizon_app.my_underwriting_decisions WITH (security_barrier) AS
  SELECT u.*
  FROM horizon_app.underwriting_decisions AS u
  WHERE EXISTS (SELECT 1 FROM horizon_app.my_policy_risk_decisions AS p WHERE p.policy_id = u.policy_id);

  GRANT USAGE ON SCHEMA horizon_app TO PUBLIC;
  GRANT SELECT ON horizon_app.my_policy_risk_decisions, horizon_app.my_underwriting_decisions TO PUBLIC;
  GRANT INSERT ON horizon_app.underwriting_decisions, horizon_app.audit_events TO PUBLIC;`;

const SOURCE = 'horizon_app.my_policy_risk_decisions';

// Latest human decision per policy, joined onto the queue and the policy record.
const LATEST_DECISION = `
  LEFT JOIN LATERAL (
    SELECT decision, selected_action, decided_at
    FROM horizon_app.my_underwriting_decisions AS u
    WHERE u.policy_id = d.policy_id
    ORDER BY decided_at DESC
    LIMIT 1
  ) AS latest ON TRUE`;

export const QUEUE_SQL = `
  SELECT
    d.policy_id, d.customer_id, d.region,
    d.renewal_date::text AS renewal_date,
    d.annual_premium, d.claim_risk_probability, d.risk_band, d.recommended_action, d.model_alias,
    d.speeding_events_90d::int AS speeding_events_90d,
    d.hard_brake_events_90d::int AS hard_brake_events_90d,
    d.distraction_events_90d::int AS distraction_events_90d,
    latest.decision AS latest_decision,
    latest.decided_at AS latest_decided_at
  FROM ${SOURCE} AS d
  ${LATEST_DECISION}
  WHERE d.policy_status = 'ACTIVE'
    AND d.requires_review
    AND ($1::text = 'all' OR ($1::text = 'open') = (latest.decision IS NULL))
  ORDER BY d.claim_risk_probability DESC, d.renewal_date, d.policy_id
  LIMIT $2 OFFSET $3`;

export const QUEUE_COUNT_SQL = `
  SELECT COUNT(*)::int AS total
  FROM ${SOURCE} AS d
  ${LATEST_DECISION}
  WHERE d.policy_status = 'ACTIVE'
    AND d.requires_review
    AND ($1::text = 'all' OR ($1::text = 'open') = (latest.decision IS NULL))`;

export const POLICY_SQL = `
  SELECT
    d.policy_id, d.customer_id, d.region,
    d.renewal_date::text AS renewal_date,
    d.annual_premium, d.claim_risk_probability, d.risk_band, d.recommended_action, d.expected_loss,
    d.requires_review, d.model_alias, d.scored_at,
    d.trip_count_90d::int AS trip_count_90d,
    d.miles_90d, d.nighttime_miles_pct, d.severe_weather_miles_pct,
    d.speeding_events_90d::int AS speeding_events_90d,
    d.hard_brake_events_90d::int AS hard_brake_events_90d,
    d.distraction_events_90d::int AS distraction_events_90d,
    d.prior_claim_count::int AS prior_claim_count,
    d.prior_incurred_amount,
    latest.decision AS latest_decision,
    latest.decided_at AS latest_decided_at
  FROM ${SOURCE} AS d
  ${LATEST_DECISION}
  WHERE d.policy_id = $1`;

// Next undecided policy in queue order after the given one.
export const NEXT_POLICY_SQL = `
  WITH queue AS (
    SELECT d.policy_id, ROW_NUMBER() OVER (ORDER BY d.claim_risk_probability DESC, d.renewal_date, d.policy_id) AS position,
           EXISTS (SELECT 1 FROM horizon_app.my_underwriting_decisions u WHERE u.policy_id = d.policy_id) AS decided
    FROM ${SOURCE} AS d
    WHERE d.policy_status = 'ACTIVE' AND d.requires_review
  )
  SELECT policy_id FROM queue
  WHERE NOT decided AND policy_id <> $1
    AND position > COALESCE((SELECT position FROM queue WHERE policy_id = $1), 0)
  ORDER BY position
  LIMIT 1`;

export const PORTFOLIO_SQL = `
  SELECT
    COUNT(*)::int AS policies_in_region,
    COUNT(*) FILTER (WHERE d.requires_review)::int AS policies_requiring_review,
    COUNT(*) FILTER (WHERE d.requires_review AND EXISTS (
      SELECT 1 FROM horizon_app.my_underwriting_decisions u WHERE u.policy_id = d.policy_id
    ))::int AS policies_decided,
    COALESCE(ROUND(SUM(d.expected_loss)::numeric, 2)::float8, 0) AS expected_loss_at_risk,
    COUNT(*) FILTER (WHERE d.renewal_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS renewals_next_30d,
    MAX(d.scored_at) AS data_freshness,
    COALESCE(array_agg(DISTINCT d.region ORDER BY d.region) FILTER (WHERE d.region IS NOT NULL), '{}') AS regions
  FROM ${SOURCE} AS d
  WHERE d.policy_status = 'ACTIVE'`;

export const DISTRIBUTION_SQL = `
  SELECT d.risk_band, COUNT(*)::int AS policy_count
  FROM ${SOURCE} AS d
  WHERE d.policy_status = 'ACTIVE'
  GROUP BY d.risk_band`;

export const DECISIONS_SQL = `
  SELECT decision_id, policy_id, reviewer_email, decision, recommended_action,
         selected_action, override_reason, notes, model_version, decided_at
  FROM horizon_app.my_underwriting_decisions
  WHERE ($1::text IS NULL OR policy_id = $1)
  ORDER BY decided_at DESC
  LIMIT 100`;

export const DECISION_BY_ID_SQL = `
  SELECT decision_id, policy_id, reviewer_email, decision, recommended_action,
         selected_action, override_reason, notes, model_version, decided_at
  FROM horizon_app.my_underwriting_decisions
  WHERE decision_id = $1::uuid`;

// Inserts only when the caller can see the policy; reviewer is the database identity.
export const INSERT_DECISION_SQL = `
  INSERT INTO horizon_app.underwriting_decisions
    (decision_id, policy_id, reviewer_email, decision, recommended_action, selected_action,
     override_reason, notes, model_version)
  SELECT $1::uuid, $2, current_user, $3, $4, $5, $6, $7, $8
  WHERE EXISTS (SELECT 1 FROM horizon_app.my_policy_risk_decisions WHERE policy_id = $2)`;

export const INSERT_AUDIT_SQL = `
  INSERT INTO horizon_app.audit_events (policy_id, actor_email, event_type, event_payload)
  VALUES ($1, current_user, $2, $3::jsonb)`;
