# Horizon Auto Insurance — Proactive Risk Prevention and Renewal Decisioning

## Use case in plain words

Horizon Auto Insurance offers a voluntary telematics program. Its underwriters currently see driving-risk changes only during periodic portfolio reviews, after unsafe behavior may already have produced a claim. Horizon will build an underwriting application that detects worsening driving patterns, explains the risk factors, recommends a customer intervention and renewal action, and lets an underwriter approve or override the recommendation. Every decision is governed, explainable, and recorded for audit.

The application does not autonomously change premiums. It supports a human underwriter making a renewal decision under approved rating rules.

## Business story

| | |
|---|---|
| **Company** | Horizon Auto Insurance — regional personal-auto carrier |
| **Hero** | Maya Chen, Regional Underwriting Manager |
| **Problem** | Horizon reacts too late when enrolled drivers develop riskier driving habits, increasing preventable claims and weakening renewal pricing accuracy |
| **Investigation** | Maya asks, "Why is policy POL-004217 becoming riskier, and what should we do before renewal?" |
| **Root cause** | Nighttime mileage, speeding, hard-braking, and phone-distraction events rose materially during the last 30 days |
| **Recommended action** | Offer a 30-day safe-driving challenge, review the deductible, and flag the policy for an underwriter-approved renewal adjustment if behavior does not improve |
| **Business outcome** | Reduce claim frequency and severity, improve loss ratio, retain safe drivers, and shorten underwriting review time |

## Target users

- **Primary:** Personal-lines underwriters reviewing policy risk and renewal actions.
- **Executive sponsor:** VP of Personal Lines monitoring loss ratio and retention.
- **Domain owner:** Regional Underwriting Manager monitoring queues, overrides, and intervention outcomes.
- **Supporting users:** Actuarial, risk-prevention, and compliance teams validating performance, fairness, and auditability.

## Success metrics

Use synthetic baseline and target values in the prototype rather than presenting them as actual customer results.

| KPI | Prototype target |
|---|---:|
| Policies reviewed automatically | 100% of telematics-enrolled renewals |
| Manual review time | 40% reduction |
| High-risk policies receiving an intervention | 80% within one business day |
| Preventable claim frequency | 5% modeled reduction |
| Portfolio loss ratio | 2-point modeled improvement |
| Safe-driver retention | 3% modeled improvement |
| Decisions with explanation and audit record | 100% |

## End-to-end Databricks journey

### Source-system file-delivery contracts

Horizon receives two independent synthetic file feeds. The fictional **Horizon Policy Administration System** is authoritative for customers, policies, vehicles, and claims. The fictional opt-in partner **VectorDrive Telematics** supplies trips, driving events, and coarse weather context. This separation prevents the telemetry partner from becoming the system of record for customer identity or insurance contracts.

#### Delivery cadence

| Dataset | Incremental delivery | Full reconciliation |
|---|---|---|
| Horizon customers | Daily when changed | Weekly |
| Horizon policies | Daily | Weekly |
| Horizon vehicles | Daily when changed | Weekly |
| Horizon claims | Daily | Weekly |
| VectorDrive trips | Hourly | Weekly |
| VectorDrive driving events | Hourly | Weekly |
| VectorDrive weather | Hourly | Not required |

The initial load contains 90 days of trip and driving-event history, all active policies and vehicles, and recent claims. Subsequent deliveries contain new or changed records. Weekly snapshots reconcile missed, late, corrected, and deleted policy or vehicle records.

#### Landing layout

```text
/Volumes/<catalog>/<schema>/policy_admin_landing/
  customers/load_type=FULL/load_date=2026-10-01/
  policies/load_type=FULL/load_date=2026-10-01/
  vehicles/load_type=FULL/load_date=2026-10-01/
  claims/load_type=FULL/load_date=2026-10-01/
  manifests/

/Volumes/<catalog>/<schema>/vectordrive_landing/
  trips/load_type=FULL/load_date=2026-10-01/
  driving_events/load_type=FULL/load_date=2026-10-01/
  driving_events/load_type=INCREMENTAL/delivery_date=2026-10-02/hour=08/
  weather/load_type=FULL/load_date=2026-10-01/
  manifests/
```

Every delivery includes a manifest containing `source_system`, `batch_id`, `delivery_timestamp`, `load_type`, `schema_version`, file names, expected record counts, event-time range, and checksums. Each source record includes a stable business key, `source_updated_at`, and `batch_id`.

### 1. Lakeflow ingestion and transformation

The canonical entity relationships and primary/foreign-key contract are documented in [README.md](README.md#data-model). The pipeline materializes `referential_integrity_checks` and fails before Gold publication when customer, policy, vehicle, trip, event, or claim relationships contain orphan records.

Generate synthetic source data for:

- Customers and policies
- Vehicles and coverage
- Trips and daily driving summaries
- Telematics events: speeding, hard braking, rapid acceleration, distraction, and nighttime driving
- Claims and claim severity
- Weather and road conditions
- Renewal dates and prior underwriting actions

Use a Lakeflow pipeline to create:

- **Bronze:** Raw customer, policy, vehicle, claim, trip, event, and weather records with source lineage
- **Silver:** Validated trips, normalized events, joined policy context, and data-quality expectations
- **Gold:** Policy-level 7-, 30-, and 90-day features; portfolio KPIs; renewal-review candidates; intervention outcomes

#### Recommended pipeline design

Implement one serverless Lakeflow Spark Declarative Pipeline in Python. Python supports both streaming ingestion and periodic snapshot CDC while keeping the solution in one governed dependency graph.

![Recommended pipeline design](docs/diagrams/horizon-pipeline-design.svg)

The pipeline produces features; scoring and decisioning run after it as tasks in `horizon-auto-operational`, because the ML probability does not exist while the pipeline runs. `policy_risk_decisions` is the only place risk band, recommended action, and expected loss are defined.

#### Dataset types and processing rules

| Layer | Dataset | Lakeflow pattern | Key behavior |
|---|---|---|---|
| Bronze | `bronze_customers` | Streaming table + Auto Loader | Ingest the governed customer directory from Horizon's policy system |
| Bronze | `bronze_policies` | Streaming table + Auto Loader | Ingest insurance contracts from Horizon's policy system |
| Bronze | `bronze_trips` | Streaming table + Auto Loader | Append full-history and incremental VectorDrive files; preserve source metadata and rescued data |
| Bronze | `bronze_driving_events` | Streaming table + Auto Loader | Append new files exactly once; retain event time and ingestion time |
| Bronze | `bronze_claims` | Streaming table + Auto Loader | Capture new and corrected claim records |
| Bronze | `bronze_weather` | Streaming table + Auto Loader | Append hourly coarse-region conditions |
| Bronze | Policy and vehicle snapshots | Temporary views over ordered snapshots | Expose each complete snapshot to snapshot CDC processing |
| Silver | `silver_policies` | Auto CDC from snapshot, SCD Type 2 | Preserve policy history and detect inserts, updates, and removals between snapshots |
| Silver | `silver_customers` | Auto CDC from snapshot, SCD Type 2 | Preserve customer identity and consent changes without exposing direct contact data |
| Silver | `silver_vehicles` | Auto CDC from snapshot, SCD Type 2 | Preserve vehicle history and current ownership association |
| Silver | `silver_trips` | Auto CDC, SCD Type 1 | Keep the latest valid record per `trip_id` using `source_updated_at`; apply weekly corrections |
| Silver | `silver_driving_events` | Auto CDC, SCD Type 1 | Keep the latest record per `event_id`; reject impossible or orphan events before CDC |
| Silver | `silver_claims` | Auto CDC, SCD Type 1 | Keep the latest record per `claim_id` and apply corrected severity values |
| Gold | `policy_driving_features` | Materialized view | Produce 7-, 30-, and 90-day policy features for training and scoring |
| Gold | `renewal_review_candidates` | Materialized view | Join current policies, customers, and features for analyst lookup (masked names) |
| Gold | `policy_risk_decisions` | Delta table, MERGE after scoring | One row per scored policy: risk band, recommended action, expected loss, review eligibility; change data feed for Lakebase sync |

Use streaming tables only for continuously arriving raw files. Use Auto CDC for keyed corrections and current-state Silver tables. Use materialized views for joins and aggregations over already-deduplicated Silver tables. Use Auto CDC from snapshots for policy and vehicle history rather than treating weekly snapshots as append-only facts.

#### Full and incremental behavior

1. **Initial full load:** Auto Loader discovers the 90-day telemetry history and the customer, policy, vehicle, and claim snapshots that establish current governed state.
2. **Hourly increment:** New trip, event, and weather files are appended to bronze. Downstream materialized views refresh affected policy features.
3. **Daily increment:** Customer, policy, vehicle, and claim changes are processed using stable keys and `source_updated_at` sequencing.
4. **Weekly reconciliation:** Complete customer, policy, and vehicle snapshots drive snapshot CDC. A reconciliation step compares full trip, event, and claim snapshots with Silver state and emits only changed or missing keyed records into the same Auto CDC input contract.
5. **Late data:** Calculations use `event_timestamp`, not file-arrival time. Retain `ingested_at` to measure lateness and audit deliveries.
6. **Idempotency:** Auto Loader tracks processed files; stable record keys and latest-record logic protect against duplicate contents under new file names.
7. **Schema evolution:** Additive fields are rescued and reviewed before promotion to the curated schema. Breaking changes quarantine the batch.

#### Source simulation jobs

- `horizon-auto-generate-backfill` is unscheduled and generates the initial full policy-admin snapshot plus 90 days of telemetry history. Run it only for environment initialization or an intentional replay into a clean checkpoint.
- `horizon-auto-generate-incremental-files` runs daily at 1:00 AM Pacific, writes uniquely keyed incremental policy-admin and VectorDrive batches, and completes before the 2:00 AM operational pipeline.
- The operational job never generates source data. It only incrementally processes files already delivered to the landing volumes and then scores changed portfolio state.
- Backfills and increments use the same schemas, stable business keys, `source_updated_at`, `batch_id`, and manifests so Auto Loader and latest-record processing remain idempotent.

#### Data-quality expectations

- Fail a delivery when required identifiers, `batch_id`, or schema version are missing.
- Quarantine records with malformed timestamps, negative mileage, or impossible speeds.
- Drop duplicate records after retaining the greatest `source_updated_at` and ingestion sequence.
- Validate that trip end time follows start time and that each event falls within its trip window.
- Validate that claim amounts are nonnegative and policy effective dates precede expiration dates.
- Track orphan events, late-arrival percentage, expected-versus-actual manifest counts, and rescued columns.
- Publish batch-level audit results containing input count, accepted count, rejected count, duplicate count, and processing status.

#### Orchestration and refresh cadence

- Run the pipeline hourly to process trip, event, and weather arrivals.
- Let the same hourly run pick up daily policy, vehicle, and claim deliveries when present.
- Run model scoring after the daily delivery completes.
- Run the weekly reconciliation through the same pipeline; do not perform a destructive pipeline full refresh.
- Alert when an expected delivery is late, a manifest count does not match, or quarantine rate exceeds the agreed threshold.

#### Ensuring incremental materialized-view refresh

Design incremental refresh into the Gold layer rather than assuming every materialized view will qualify:

1. Run the pipeline on **serverless** compute; incremental MV refresh requires serverless execution.
2. Enable Delta row tracking on every Silver source used by a Gold MV with `delta.enableRowTracking = true`.
3. Keep keyed deduplication and correction handling in Auto CDC. Avoid `ROW_NUMBER`-based whole-table deduplication inside Gold MVs.
4. Keep Gold queries deterministic: no random values, current-time-dependent business logic, Python UDFs, or unsupported external calls.
5. Prefer equi-joins on stable keys and standard filters, projections, and grouped aggregates.
6. Separate complex calculations into stages. If one MV cannot be incrementally maintained, materialize a simpler intermediate table rather than forcing one large query.
7. Preserve event dates and business dimensions needed for selective recomputation and application filters.
8. Use Liquid Clustering or `CLUSTER BY AUTO` for query performance; clustering does not itself guarantee incremental refresh.
9. Inspect each pipeline update's refresh metrics and execution plan. Commit evidence showing whether each MV used incremental or complete recomputation.
10. Treat incremental refresh as an eligibility decision made by the optimizer. If a query falls back to complete recomputation, simplify the query or move that transformation into an incremental streaming or Auto CDC stage.

The Gold MVs should therefore remain intentionally simple:

- `policy_driving_features`: grouped rolling feature aggregates from deduplicated Silver trips and events
- `renewal_review_candidates`: stable-key joins across current policies, customers, and features

Portfolio aggregates come from the `underwriting_metrics` metric view over `governed_policy_risk_decisions`, not from a pipeline MV.

#### Prototype delivery sequence

Demonstrate six batches:

1. Initial 90-day full load
2. Three hourly telemetry increments
3. One daily policy and claims increment
4. One weekly reconciliation containing a corrected trip, a late event, a policy update, and a removed vehicle association

Commit the batch manifests and audit output so the evaluator can verify both full and incremental behavior as text.

### 2. Unity Catalog governance

- Store all lakehouse assets in a dedicated catalog and schema.
- Classify customer identifiers and coarse location attributes.
- Mask or omit direct PII from analyst and app-facing tables.
- Do not expose exact GPS coordinates; retain derived features such as nighttime-mile percentage.
- Separate raw telemetry access from curated underwriting features.
- Apply the built-in governed tag `class.name` to customer display-name columns and enforce the schema-scoped `horizon_mask_customer_names` ABAC policy. All analysts, including the demo underwriter, receive masked customer names. A dedicated Horizon tag can replace `class.name` when account governed-tag capacity is available.
- Tag the analyst-facing `renewal_review_candidates.region` column with `class.location` and enforce the schema-scoped `horizon_filter_underwriter_regions` ABAC policy. Assign the demo underwriter `anhhoang.chu@databricks.com` to `West`; unassigned users receive no analyst-facing renewal rows. Do not tag pipeline source columns, preventing regional policies from filtering materialized-view refresh inputs.
- Create account-level regional underwriter groups before production rollout and replace the named demo-user mapping with group-based assignments. Keep pipeline run-as identities outside analyst-facing row-filter targets.
- Keep Customer ID available for exact analyst lookup while classifying it as a customer identifier. Do not add email, phone, address, or precise GPS data to Genie-facing tables.
- Record table lineage from raw events through features and recommendations.
- Register the model and its versions in Unity Catalog.

### 3. ML intelligence

Train an interpretable model that predicts expected claim risk over the next policy period.

Suggested features:

- Annualized mileage and recent mileage trend
- Speeding-event rate
- Hard-braking and rapid-acceleration rates
- Phone-distraction-event rate
- Nighttime and severe-weather mileage percentages
- Recent changes relative to the driver's own baseline
- Prior claims count and severity

Model outputs:

- Claim probability and expected claim cost
- Risk band: low, moderate, high, or critical
- Top contributing risk factors
- Trend direction and confidence
- Recommended intervention category

Apply deterministic, synthetic rating rules after prediction to create a renewal recommendation. Keep the model score, intervention recommendation, and pricing logic as separate, auditable outputs.

### 4. Governed metric view

Create `serverless_stable_dvmvgw_catalog.horizon_auto.underwriting_metrics` as a Unity Catalog metric view over `renewal_review_candidates`. Treat it as the authoritative semantic layer shared by Genie, the Databricks App, SQL analysis, and future dashboards.

Governed dimensions:

- Region
- Risk Band
- Recommended Intervention
- Policy Status
- Renewal Month
- Renewal Urgency
- Claim History

Governed measures:

- Policy Count and Active Policy Count
- High Risk Policy Count and Critical Risk Policy Count
- Policies Renewing Next 30 Days
- Total Written Premium
- Expected Loss and Expected Loss Ratio
- Average Behavior Risk Score
- Prior Claim Count and Prior Incurred Amount
- Underwriter Review Count
- Safe Driving Challenge Count

The metric view definition is deployed as code from `src/metrics/create_underwriting_metrics.sql` through the DAB-managed `horizon-auto-create-metrics` job. Validate portfolio-level and regional queries with `MEASURE()` before making the view available to Genie or the App.

### 5. Genie Agent

Create a curated Genie Agent with `underwriting_metrics` as the primary source for every portfolio KPI, count, premium, expected-loss, loss-ratio, renewal, claims, and intervention question. Retain `renewal_review_candidates` for individual policy records and `policy_driving_features` for detailed telematics explanations.

Example questions:

- "Which policies have moved into high risk in the last 30 days?"
- "Why did POL-004217's risk increase?"
- "Which intervention is recommended for this policy?"
- "How much expected claim cost is associated with critical policies renewing next month?"
- "Which regions have the highest override rate?"
- "How are model outcomes distributed across approved comparison groups?"

The Genie Agent is Horizon's governed natural-language analytics layer. It queries the governed metric view and curated policy-detail tables through a SQL warehouse and returns generated SQL and sources. It does not approve renewals, write to Lakebase, or directly change a premium.

### 6. Underwriting Agent and Unity AI Gateway

> **Superseded.** Supervisor Agents and Knowledge Assistants are now legacy Databricks offerings. The app uses the Genie Agent in Agent mode for policy and portfolio questions over governed data and the `underwriting_guidelines` volume, with citations. The original design is kept below for reference.

Add a separate **Underwriting Copilot Agent** for policy-level investigation and recommendation explanation. Serve it through a Databricks Model Serving endpoint configured with Unity AI Gateway.

#### Agent responsibilities

- Accept the selected `policy_id` and the underwriter's question.
- Retrieve governed policy features, model outputs, approved rating guidance, and current intervention options.
- Call the curated Genie Agent for portfolio or analytical questions when SQL exploration is required.
- Explain the model's top factors in underwriting language.
- Compare approved scenarios such as no action, coaching intervention, deductible review, or renewal review.
- Return a structured recommendation containing evidence, caveats, model version, and cited sources.
- Draft an underwriter note or customer-safe coaching message.

The agent must not bind coverage, calculate an unapproved rate, approve its own recommendation, or write directly to the decision tables. The App performs write-back only after the authenticated underwriter confirms the action.

#### Unity AI Gateway controls

Configure AI Gateway on the agent's serving endpoint to provide:

- Per-user or per-endpoint rate limits
- Usage and token tracking
- Endpoint inference logging and operational monitoring
- Workspace permissions so only the Horizon app and approved reviewers can query the endpoint
- Tags or usage attribution for the personal-lines business unit
- A bounded foundation-model route selected from models available in the target workspace

#### 50/50 model-routing experiment

Configure the Copilot demonstration with two workspace-available foundation models: the highest suitable Claude Sonnet model and a cost-efficient GPT model. Route 50% of eligible Copilot requests to each model to illustrate Unity AI Gateway governance and comparative observability.

- Resolve the exact Claude and GPT endpoint names at deployment time rather than hard-coding models that might not exist in the workspace.
- Use a stable hash of `conversation_id` for sticky 50/50 assignment so every turn in one underwriting investigation stays on the same model.
- Keep the same system instructions, tools, temperature, response schema, and token limits across both routes so the comparison measures model behavior rather than configuration differences.
- Send SQL and portfolio questions to Genie regardless of model assignment; the 50/50 split applies only to Copilot synthesis and explanation requests.
- Capture model name, route assignment, latency, input/output tokens, estimated cost, tool calls, user feedback, and underwriter override outcome through AI Gateway inference logging and application audit records.
- Do not automatically promote a winner from the demonstration. Compare benchmark accuracy, groundedness, latency, and cost per completed review before selecting the production route.

Store only the minimum policy context needed by the agent. Do not place direct PII, precise GPS traces, or prohibited rating variables in prompts or traces.

#### Runtime interaction

![Runtime interaction](docs/diagrams/horizon-runtime-interaction.svg)

This separation gives each component a clear role: Genie performs governed data Q&A, the Gateway-backed agent synthesizes policy context and explanations, and the human-controlled App owns the operational decision.

#### Implemented Copilot resources

- Supervisor Agent: `Horizon Underwriting Copilot` (`supervisor-agents/dc157dce-605f-49ee-bd7e-3d4aef2f853f`).
- Serving endpoint: `mas-dc157dce-endpoint`.
- Governed analytics tool: Genie Agent `Horizon Underwriting Intelligence` (`01f1c6c7119c15fb980d25cd32ec7bd2`).
- MLflow trace experiment: `1417983980065322`.
- The Copilot invokes Genie through the App service principal `82488809-bd0c-4366-8775-4af4290fca11`. That principal requires `USE CATALOG`, `USE SCHEMA`, and `SELECT` on every Genie source it may query, including `renewal_review_candidates`; omitting that grant caused an `INSUFFICIENT_PERMISSIONS` SQL execution error. Treat these grants as deployment prerequisites and verify them after adding or replacing a Genie source.
- The managed Supervisor endpoint currently rejects AI Gateway configuration and the workspace exposes no standalone Foundation Model API endpoints, so the planned 50/50 Claude/GPT route remains a documented follow-on rather than a fabricated deployment.

### 7. Lakebase operational serving

Use Lakebase Postgres Autoscaling for operational application state:

- Underwriter review queue
- Current recommendation and status
- Approved or overridden action
- Override reason and reviewer notes
- Intervention enrollment and completion
- Decision and audit history

Analytics remain in Unity Catalog and are queried through a SQL warehouse. Lakebase handles low-latency workflow state and write-back; it is not the system for training or portfolio analytics.

Implemented on Lakebase project `projects/horizon-auto`, branch `production`, database `databricks-postgres`. The App creates `horizon_app.underwriting_decisions` and `horizon_app.audit_events` as its service principal during startup.

### 8. Databricks App

Build an AppKit/React underwriting application with analytics, Genie, and Lakebase resources.

Implemented App: `horizon-underwriting` at `https://horizon-underwriting-7474647158801289.aws.databricksapps.com`.

#### Portfolio overview

- KPI cards: policies requiring review, expected claims cost at risk, upcoming renewals, intervention completion, and override rate
- Risk distribution by band
- Risk-versus-premium or expected-loss scatter plot
- Trend of policies entering and leaving high-risk bands
- Ranked renewal-review queue

#### Policy detail

- Policy and vehicle summary with minimized customer information
- 90-day driving-risk trend
- Breakdown of driving features and changes from baseline
- Model score, version, confidence, and top contributing factors
- Recommended intervention and renewal action
- Expected-loss and retention what-if comparison

#### Decision workflow

- Approve the recommendation
- Override with a required reason
- Assign a safe-driving intervention
- Add an underwriter note
- Write the decision to Lakebase and refresh queue status

#### Genie panel

- Embedded natural-language questions grounded in governed data
- Generated SQL and source tables visible for trust
- Suggested questions tied to the selected policy
- Clear loading, empty, error, and freshness states

## Demo arc

1. **See the portfolio:** Maya opens the app and sees a growing cluster of high-risk policies renewing within 30 days.
2. **Select the hero policy:** She opens `POL-004217`, whose score moved from moderate to high risk.
3. **Ask why:** Genie identifies increases in distraction, nighttime mileage, speeding, and hard braking.
4. **Review the recommendation:** The model recommends a safe-driving challenge now and an underwriter review at renewal.
5. **Run a what-if:** Maya compares expected loss and retention under no action, intervention, and renewal-adjustment scenarios.
6. **Act:** She approves the intervention; the application writes the decision and rationale to Lakebase.
7. **Verify:** The queue and KPIs refresh, and the audit history shows the user, timestamp, model version, and decision.

## Responsible-use guardrails

- Use synthetic data only.
- Require affirmative customer consent for telematics enrollment.
- Exclude protected characteristics and prohibited rating variables.
- Test permitted comparison groups for materially different error rates or outcomes.
- Use coarse derived location features rather than exact trip paths.
- Never let the model autonomously bind coverage or change a premium.
- Require an underwriter and a documented reason for overrides.
- Display model version, factors, confidence, data freshness, and decision history.
- Describe financial impact as modeled unless validated against real results.

## Proposed repository structure

```text
databricks.yml
dab/
  data_generation/
    generate_data.py
  transformation/
    pipeline.sql
  ml/
    train_model.py
    score_policies.py
  setup/
    lakebase_setup.sql
  resources/
    pipeline.yml
    jobs.yml
    app.yml
app/
  client/
  server/
  config/queries/
evidence/
  data_generation.log
  pipeline_run.md
  data_quality_results.md
  model_results.md
  sample_predictions.md
  genie_questions.md
  lakebase_writeback.md
  app_validation.md
presentation/
  horizon_auto_insurance.md
README.md
```

## Build sequence for a 4–8 hour prototype

| Phase | Scope | Timebox |
|---|---|---:|
| 1 | Generate synthetic data and define the hero policy | 45 minutes |
| 2 | Build Lakeflow bronze, silver, and gold tables | 75 minutes |
| 3 | Train, log, register, and score the risk model | 60 minutes |
| 4 | Create curated Genie Agent instructions and test questions | 45 minutes |
| 5 | Configure Lakebase schema and write-back workflow | 45 minutes |
| 6 | Build the AppKit portfolio and policy-review experience | 90 minutes |
| 7 | Validate the complete demo and capture textual evidence | 45 minutes |
| 8 | Create the business presentation | 30 minutes |

## Required execution evidence

Commit readable text showing that each component ran:

- Synthetic row counts and sample records
- Lakeflow pipeline status and data-quality results
- Unity Catalog table and model identifiers
- Model metrics, feature importance, and sample predictions
- Genie questions with returned answers and SQL
- Lakebase table contents before and after an approval
- App validation or smoke-test output
- End-to-end demo result for `POL-004217`

Screenshots may supplement this evidence but cannot replace it.

## Definition of done

- Raw synthetic data flows through Lakeflow into governed bronze, silver, and gold tables.
- Unity Catalog permissions and masking prevent broad access to sensitive fields.
- A registered model produces explainable policy-level risk predictions.
- A governed metric view standardizes underwriting KPIs and is validated with executable metric queries.
- Genie answers the defined portfolio and policy questions accurately.
- The app displays portfolio analytics and a complete policy review.
- An approved or overridden decision persists to Lakebase and appears in audit history.
- The repository contains readable execution evidence for every stage.
- The presentation leads with loss ratio, claim prevention, retention, and underwriting productivity.
