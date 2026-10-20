CREATE OR REPLACE VIEW serverless_stable_dvmvgw_catalog.horizon_auto.underwriting_metrics
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: serverless_stable_dvmvgw_catalog.horizon_auto.governed_policy_risk_decisions
comment: Governed underwriting, driving-risk, expected-loss, renewal, and intervention metrics for Horizon Auto Insurance. Risk band, recommended action, and expected loss come from policy_risk_decisions, the same table the underwriting app reads.
dimensions:
  - name: Policy ID
    expr: policy_id
    comment: Stable Horizon policy identifier used for exact lookup.
  - name: Customer ID
    expr: customer_id
    comment: Stable Horizon customer identifier used for exact lookup.
  - name: Customer Segment
    expr: customer_segment
    comment: Horizon service segment, not a protected-class or rating variable.
  - name: Telematics Consent
    expr: telematics_consent
    comment: Whether the customer has affirmatively enrolled in the telematics program.
  - name: Region
    expr: region
    comment: Horizon underwriting region.
  - name: Risk Band
    expr: risk_band
    comment: Claim-risk band from the ML probability. Critical >= 0.45, High >= 0.42, Moderate >= 0.39, otherwise Low.
  - name: Recommended Action
    expr: recommended_action
    comment: Rule-based recommended intervention (NO_ACTION, SAFE_DRIVING_COACHING, HUMAN_RENEWAL_REVIEW). An underwriter approves or overrides it in the app.
  - name: Requires Review
    expr: requires_review
    comment: Whether an active policy's claim risk probability is at or above the 0.42 review threshold.
  - name: Model Alias
    expr: model_alias
    comment: Unity Catalog model alias that produced the score.
  - name: Policy Status
    expr: policy_status
    comment: Current policy workflow status.
  - name: Renewal Month
    expr: DATE_TRUNC('MONTH', renewal_date)
    comment: Calendar month in which the policy renews.
  - name: Renewal Urgency
    expr: CASE WHEN renewal_date < DATE '2026-10-12' THEN 'Past Due' WHEN renewal_date <= DATE '2026-10-12' + INTERVAL 30 DAYS THEN 'Next 30 Days' ELSE 'Later' END
    comment: Renewal timing relative to the fixed demo as-of date of October 12, 2026.
  - name: Claim History
    expr: CASE WHEN prior_claim_count > 0 THEN 'Prior Claim' ELSE 'No Prior Claim' END
    comment: Whether a policy has at least one historical claim.
measures:
  - name: Policy Count
    expr: COUNT(DISTINCT policy_id)
    comment: Distinct policies in the selected portfolio slice.
  - name: Active Policy Count
    expr: COUNT(DISTINCT CASE WHEN policy_status = 'ACTIVE' THEN policy_id END)
    comment: Distinct active policies.
  - name: Policies Requiring Review
    expr: COUNT(DISTINCT CASE WHEN requires_review THEN policy_id END)
    comment: Active policies at or above the 0.42 review threshold. Matches the app's review queue count.
  - name: High Risk Policy Count
    expr: COUNT(DISTINCT CASE WHEN risk_band IN ('High', 'Critical') THEN policy_id END)
    comment: Policies in the High or Critical band.
  - name: Critical Risk Policy Count
    expr: COUNT(DISTINCT CASE WHEN risk_band = 'Critical' THEN policy_id END)
    comment: Policies in the Critical band.
  - name: Policies Renewing Next 30 Days
    expr: COUNT(DISTINCT CASE WHEN renewal_date BETWEEN DATE '2026-10-12' AND DATE '2026-11-11' THEN policy_id END)
    comment: Policies renewing within 30 days of the fixed demo as-of date.
  - name: Total Written Premium
    expr: SUM(annual_premium)
    comment: Annual premium represented by the selected policies.
  - name: Expected Loss
    expr: SUM(expected_loss)
    comment: Annual premium multiplied by claim risk probability.
  - name: Expected Loss Ratio
    expr: SUM(expected_loss) / NULLIF(SUM(annual_premium), 0)
    comment: Expected loss divided by annual premium.
  - name: Average Claim Risk Probability
    expr: AVG(claim_risk_probability)
    comment: Mean ML-predicted probability of a claim in the next term.
  - name: Average Behavior Risk Score
    expr: AVG(behavior_risk_score)
    comment: Mean heuristic behavior score from zero to one. Explanatory feature only; not used for bands or recommendations.
  - name: Prior Claim Count
    expr: SUM(prior_claim_count)
    comment: Number of historical claims across selected policies.
  - name: Prior Incurred Amount
    expr: SUM(prior_incurred_amount)
    comment: Historical incurred claim amount across selected policies.
  - name: Human Renewal Review Count
    expr: COUNT(DISTINCT CASE WHEN recommended_action = 'HUMAN_RENEWAL_REVIEW' THEN policy_id END)
    comment: Policies recommended for human renewal review.
  - name: Safe Driving Coaching Count
    expr: COUNT(DISTINCT CASE WHEN recommended_action = 'SAFE_DRIVING_COACHING' THEN policy_id END)
    comment: Policies recommended for safe-driving coaching.
$$;
