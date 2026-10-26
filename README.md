# Horizon Auto Insurance

Underwriting App: https://horizon-underwriting-7474647158801289.aws.databricksapps.com

Horizon Auto Insurance is an end-to-end Databricks prototype for proactive driving-risk prevention and human-approved renewal decisioning.

The solution ingests synthetic files from the fictional VectorDrive Telematics partner, governs policy and driving data in Unity Catalog, predicts claims risk, supports natural-language analysis through a Genie Agent, serves governed recommendations through an AI Gateway-backed underwriting agent, persists decisions in Lakebase, and surfaces the workflow in a Databricks App.

Visit the [Horizon Auto Insurance solution site](https://anhhchu.github.io/horizon-auto-insurance/) for the business story, modeled outcomes, architecture diagrams, technical design, and Databricks technology map.

See [HORIZON_USE_CASE_PLAN.md](HORIZON_USE_CASE_PLAN.md) for the business story, architecture, delivery contract, pipeline design, responsible-use controls, implementation sequence, and execution-evidence checklist.

## Core Journey

1. Lakeflow ingests full and incremental synthetic partner files.
2. Unity Catalog governs raw data, curated features, and model assets.
3. ML predicts expected claims risk and explains contributing factors.
4. Genie provides governed natural-language portfolio analytics.
5. Unity AI Gateway governs the Underwriting Copilot endpoint.
6. Lakebase stores review state, decisions, overrides, and audit history.
7. A Databricks App gives underwriters a human-controlled review workflow.

## Data flow architecture

One gold table, `policy_risk_decisions`, defines risk band, recommended action, and expected loss for every policy. The app, the metric view, and Genie all read it, so they show the same numbers. After each build the table syncs to Lakebase, so app pages read Postgres and never wait for a SQL warehouse.

[View the data flow architecture on the solution site](https://anhhchu.github.io/horizon-auto-insurance/#solution).

| Step | What runs | Output |
|---|---|---|
| Ingest | Lakeflow pipeline (`resources/horizon.pipeline.yml`) | Bronze, silver, `policy_driving_features`, `renewal_review_candidates` |
| Score | `score_policies` task, model `driving_claim_risk_model@prod` | `policy_risk_predictions` |
| Decide | `build_policy_risk_decisions` task (`src/gold/build_policy_risk_decisions.sql`) | `policy_risk_decisions` (MERGE, change data feed) and `governed_policy_risk_decisions` |
| Sync | `sync_lakebase` task (`src/lakebase/sync_policy_risk_decisions.py`), synced table in `serving/databricks.yml` | `horizon_auto.policy_risk_decisions_synced` in Lakebase, reconciled against Delta |
| Govern | `horizon-auto-apply-governance` job | Name masking and region row filter (ABAC) |
| Measure | `horizon-auto-create-metrics` job on `horizon-auto-warehouse` | `underwriting_metrics` metric view |
| Guide | `src/guidelines/pdf` uploaded to the `underwriting_guidelines` volume | Underwriting guidelines, VectorDrive program terms, West notice rules, attached to the Genie Agent |
| Act | Databricks App | Human decisions and audit events in Lakebase |

## Pipeline design

Lakeflow builds the features. Scoring and decisioning run after it in the same job, because the claim risk score does not exist while the pipeline runs.

[View the pipeline design on the solution site](https://anhhchu.github.io/horizon-auto-insurance/#pipeline).

- **Bronze:** Auto Loader streaming tables ingest each landing volume with source lineage.
- **Silver:** Auto CDC from snapshots keeps SCD2 history for policies, customers, and vehicles. Auto CDC with expectations keeps the latest trips, events, claims, and weather (SCD1). Integrity checks fail the update on orphaned keys.
- **Gold:** materialized views build `policy_driving_features` and `renewal_review_candidates`.
- **After the pipeline:** `score_policies` writes `policy_risk_predictions`, `build_policy_risk_decisions` merges everything into `policy_risk_decisions` and its governed view, and `sync_lakebase` refreshes the Lakebase synced table the app reads and checks it matches Delta.

## Runtime interaction

Genie answers from governed data and the underwriting guidelines, as the signed-in user, and cites its sources. Only the underwriter records a decision.

[View the runtime interaction on the solution site](https://anhhchu.github.io/horizon-auto-insurance/#runtime).

1. **Review** (steps 1–6): the app reads the West queue, KPIs, policy evidence, and decision history from Lakebase in milliseconds. Policies already decided drop out of the default queue.
2. **Investigate** (steps 7–14): the app sends the question, with the policy ID, to the Genie Agent in Agent mode as the signed-in user (`POST /api/2.0/genie/agents/{id}/responses`). Genie plans the answer, runs governed SQL on the warehouse, searches the `underwriting_guidelines` volume when the question needs policy rules, and streams back the answer with its SQL and citations. Each question is logged to `audit_events`.
3. **Decide** (steps 15–18): the underwriter approves the rule-based recommendation or overrides it with a reason. The app writes the decision and an audit event to Lakebase, then opens the next undecided policy. Genie never writes decisions.

## Data model

| Entity | Primary key | Key fields | Relationships |
|---|---|---|---|
| Customer | `customer_id` | `customer_display_name` (masked), `customer_segment`, `telematics_consent` | Holds policies |
| Policy | `policy_id` | `customer_id`, `vehicle_id`, `region`, `renewal_date`, `annual_premium`, `policy_status` | Insures one vehicle; has trips, driving events, and claims |
| Vehicle | `vehicle_id` | `policy_id` | Makes trips |
| Trip | `trip_id` | `policy_id`, `vehicle_id` | Contains driving events |
| Driving event | `event_id` | `trip_id`, `policy_id`, `event_type`, `severity` | — |
| Claim | `claim_id` | `policy_id`, `incurred_amount` | — |
| Policy driving features | `policy_id` | 90-day trips, miles, event counts, night and weather mileage, prior claims, `behavior_risk_score` | One per policy |
| Policy risk decision | `policy_id` | `claim_risk_probability`, `risk_band`, `recommended_action`, `expected_loss`, `requires_review` | One per scored policy |
| Policy risk decision (Lakebase synced) | `policy_id` | Same columns as the Delta table, in Postgres `horizon_auto.policy_risk_decisions_synced` | Read by the app |
| Region assignment | `principal`, `region` | `underwriter_region_assignments` in Unity Catalog, synced to Lakebase | Drives the UC row filter and the app's `horizon_app.my_*` views |
| Underwriting decision (Lakebase) | `decision_id` | `policy_id`, `decision`, `recommended_action`, `selected_action`, `override_reason`, `reviewer_email` | Many per policy |

### Key contract

| Parent | Primary key | Child foreign keys |
|---|---|---|
| Customer | `customer_id` | `policy.customer_id` |
| Policy | `policy_id` | `vehicle.policy_id`, `trip.policy_id`, `driving_event.policy_id`, `claim.policy_id` |
| Vehicle | `vehicle_id` | `policy.vehicle_id`, `trip.vehicle_id` |
| Trip | `trip_id` | `driving_event.trip_id` |

Backfill IDs share one numeric domain: customer `CUST-n`, policy `POL-n`, vehicle `VIN-n`. Customer display names come from a seeded Faker `en_US` generator, so they are reproducible, and incremental loads rebuild the same lookup so an existing `customer_id` keeps its name. Incremental policy-admin records reuse existing identifiers, and every incremental driving event takes its `trip_id` and `policy_id` from its parent trip.

The `referential_integrity_checks` materialized view checks every parent-child relationship after Silver deduplication. Its `no_orphaned_foreign_keys` expectation fails the pipeline when any relationship has an orphan, so invalid data never reaches Gold.

After scoring, `src/gold/build_policy_risk_decisions.sql` merges Silver policies, `policy_driving_features`, and `policy_risk_predictions` into `policy_risk_decisions`. It is the only place risk band, recommended action, expected loss, and review eligibility are defined. `underwriting_metrics` and Genie read it through the region-filtered `governed_policy_risk_decisions` view. The app reads the Lakebase synced copy as the signed-in user through `horizon_app.my_policy_risk_decisions`, a view that joins `underwriter_region_assignments_synced` on `current_user`. One entitlement table therefore scopes rows the same way in Unity Catalog and in Lakebase.
