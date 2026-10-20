-- policy_risk_decisions: the single definition of risk band, recommended action,
-- expected loss, and review eligibility per policy. Built after scoring because the
-- ML probability does not exist when the Lakeflow pipeline runs.
--
-- Consumers: underwriting_metrics, Genie, and the Horizon app (through the governed view
-- at the end of this file), and next the Lakebase synced table. Change data feed is on so the sync can be incremental;
-- the table is upserted with MERGE rather than replaced to preserve that history.
--
-- Governance: the table is internal and deliberately untagged, so the region row filter
-- never applies to this job's MERGE (a filtered writer would miss rows, insert duplicates,
-- and skip deletes) or to the Lakebase sync. Analysts, Genie, and the app read the
-- governed view below, which applies the same filter_underwriter_region function.
-- Grant SELECT on the table only to the job owner and the sync identity.
-- No customer names: they stay in the masked silver_customers / renewal_review_candidates.

CREATE OR REPLACE TEMPORARY VIEW scored_policies AS
WITH scored AS (
  SELECT
    policy.policy_id,
    policy.customer_id,
    customer.customer_segment,
    customer.telematics_consent,
    policy.region,
    policy.policy_status,
    policy.renewal_date,
    policy.annual_premium,
    features.trip_count_90d,
    features.miles_90d,
    features.nighttime_miles_pct,
    features.severe_weather_miles_pct,
    features.event_count_90d,
    features.speeding_events_90d,
    features.hard_brake_events_90d,
    features.distraction_events_90d,
    features.avg_event_severity,
    features.prior_claim_count,
    features.prior_incurred_amount,
    features.behavior_risk_score,
    prediction.claim_risk_probability,
    prediction.model_alias,
    prediction.scored_at
  FROM serverless_stable_dvmvgw_catalog.horizon_auto.silver_policies AS policy
  JOIN serverless_stable_dvmvgw_catalog.horizon_auto.silver_customers AS customer USING (customer_id)
  JOIN serverless_stable_dvmvgw_catalog.horizon_auto.policy_driving_features AS features USING (policy_id)
  JOIN serverless_stable_dvmvgw_catalog.horizon_auto.policy_risk_predictions AS prediction USING (policy_id)
),
banded AS (
  SELECT
    *,
    -- Risk bands: the only place these thresholds are defined.
    CASE
      WHEN claim_risk_probability >= 0.45 THEN 'Critical'
      WHEN claim_risk_probability >= 0.42 THEN 'High'
      WHEN claim_risk_probability >= 0.39 THEN 'Moderate'
      ELSE 'Low'
    END AS risk_band
  FROM scored
)
SELECT
  *,
  -- Approved actions: NO_ACTION, SAFE_DRIVING_COACHING, DEDUCTIBLE_REVIEW, HUMAN_RENEWAL_REVIEW.
  -- DEDUCTIBLE_REVIEW is underwriter-selected only and never recommended by rule.
  CASE risk_band
    WHEN 'Critical' THEN 'HUMAN_RENEWAL_REVIEW'
    WHEN 'High' THEN 'SAFE_DRIVING_COACHING'
    WHEN 'Moderate' THEN 'SAFE_DRIVING_COACHING'
    ELSE 'NO_ACTION'
  END AS recommended_action,
  ROUND(annual_premium * claim_risk_probability, 2) AS expected_loss,
  -- Only active policies enter the review queue; inactive ones keep their band for analysis.
  policy_status = 'ACTIVE' AND claim_risk_probability >= 0.42 AS requires_review,
  current_timestamp() AS updated_at
FROM banded;

CREATE TABLE IF NOT EXISTS serverless_stable_dvmvgw_catalog.horizon_auto.policy_risk_decisions
COMMENT 'One row per scored policy: risk band, rule-based recommended action, expected loss, and review eligibility. Single source for the app, metric view, Genie, and Lakebase sync.'
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'quality' = 'gold')
AS SELECT * FROM scored_policies WHERE FALSE;

ALTER TABLE serverless_stable_dvmvgw_catalog.horizon_auto.policy_risk_decisions
  ALTER COLUMN policy_id SET NOT NULL;

MERGE INTO serverless_stable_dvmvgw_catalog.horizon_auto.policy_risk_decisions AS target
USING scored_policies AS source
ON target.policy_id = source.policy_id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
WHEN NOT MATCHED BY SOURCE THEN DELETE;

-- Analyst-, Genie-, and app-facing view: same rows, region-scoped per reader.
CREATE OR REPLACE VIEW serverless_stable_dvmvgw_catalog.horizon_auto.governed_policy_risk_decisions
COMMENT 'Region-scoped view of policy_risk_decisions. Applies filter_underwriter_region to the reader. Source for underwriting_metrics, Genie, and the underwriting app.'
AS SELECT *
FROM serverless_stable_dvmvgw_catalog.horizon_auto.policy_risk_decisions
WHERE serverless_stable_dvmvgw_catalog.horizon_auto.filter_underwriter_region(region);
