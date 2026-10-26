# Horizon Auto Insurance

## Catch driving risk before it becomes a claim

Horizon Auto Insurance is a Databricks prototype for proactive driving-risk prevention and human-approved renewal decisioning. It detects worsening driving behavior, explains the contributing factors, recommends an approved intervention, and gives an underwriter the evidence needed to make and record the final decision.

The application does **not** autonomously change premiums. Machine learning predicts risk, deterministic business rules recommend an action, and a human underwriter approves or overrides that recommendation.

> **Prototype note:** Business outcomes on this page are modeled targets based on synthetic data, not realized customer results.

## Business problem

Horizon offers a voluntary telematics program, but its underwriters typically see changes in driving risk during periodic portfolio reviews. By that point, unsafe behavior may already have increased claim exposure.

The current workflow creates three gaps:

1. **Signals arrive too late.** Night driving, speeding, hard braking, and distraction can worsen between reviews.
2. **Evidence is fragmented.** Policy data, telemetry, claims, guidelines, and prior decisions live in different workflows.
3. **Decisions are difficult to defend.** Manual recommendations do not consistently preserve the evidence, explanation, reviewer, and override reason.

### The business question

> Why is policy `POL-004217` becoming riskier, and what should we do before renewal?

For the demonstration policy, recent nighttime mileage, speeding, hard-braking, and phone-distraction events have increased. Horizon needs to detect that change early, explain it, recommend an approved response, and keep a human accountable for the renewal decision.

## Business outcome

The solution changes the underwriting workflow from periodic review to continuous, governed prioritization:

| Step | What changes |
|---|---|
| **Detect** | Hourly telemetry updates reveal worsening driving patterns before renewal. |
| **Explain** | Interpretable model outputs and Genie expose the contributing factors and governed evidence. |
| **Recommend** | Deterministic rules translate risk into an intervention and renewal recommendation. |
| **Decide** | The underwriter approves the recommendation or overrides it with a required reason. |
| **Audit** | Questions, evidence, recommendations, decisions, and reviewer identity are recorded. |

### Modeled prototype targets

| KPI | Target |
|---|---:|
| Telematics-enrolled renewals scored | 100% |
| Manual review time | 40% reduction |
| High-risk policies receiving an intervention | 80% within one business day |
| Preventable claim frequency | 5% modeled reduction |
| Portfolio loss ratio | 2-point modeled improvement |
| Safe-driver retention | 3% modeled improvement |
| Decisions with explanation and audit record | 100% |

## Solution overview

One governed decision contract connects the analytical and operational workflow. The Delta table `policy_risk_decisions` defines the risk band, expected loss, recommended action, and review eligibility for every scored policy. The metric view, Genie, and the Databricks App resolve against that same contract.

After each decision build, the table syncs to Lakebase for low-latency application reads. The application writes only underwriter decisions, overrides, review state, and audit events.

![Horizon Auto Insurance data flow architecture](diagrams/horizon-data-flow.svg)

### End-to-end flow

1. **Ingest:** Lakeflow processes full and incremental policy-administration and VectorDrive files.
2. **Govern:** Unity Catalog controls raw data, curated features, metrics, and model assets.
3. **Predict:** MLflow-managed models produce claim-risk probability and contributing factors.
4. **Recommend:** Deterministic rules assign the risk band, expected loss, and approved action.
5. **Serve:** Lakebase sync provides low-latency policy queues and evidence to the application.
6. **Investigate:** Genie answers questions from governed data and underwriting guidelines with citations.
7. **Decide:** The underwriter approves or overrides the recommendation.
8. **Audit:** Lakebase records the decision and supporting audit events.

## Data engineering design

Lakeflow builds the feature layer. Model scoring and decision construction run after the pipeline because the claim-risk probability does not exist while the feature pipeline is executing.

![Horizon Auto Insurance pipeline design](diagrams/horizon-pipeline-design.svg)

### Bronze

- Auto Loader incrementally ingests policy, vehicle, customer, claim, trip, driving-event, and weather files.
- Each record retains its source system, batch, event time, ingestion time, and rescued data.
- Manifests provide expected counts, checksums, schema version, and delivery metadata.

### Silver

- Auto CDC from snapshots preserves SCD Type 2 history for customers, policies, and vehicles.
- Auto CDC applies keyed corrections to trips, driving events, claims, and weather.
- Expectations reject malformed records and fail the update when parent-child relationships contain orphaned keys.

### Gold

- `policy_driving_features` produces policy-level 7-, 30-, and 90-day behavior features.
- `renewal_review_candidates` joins current policy context with governed customer and risk evidence.
- ML scoring writes `policy_risk_predictions`.
- `build_policy_risk_decisions.sql` merges policy state, features, and predictions into the canonical decision table.

### Operational sync

`sync_policy_risk_decisions.py` refreshes the Lakebase synced table and reconciles it against Delta. The application therefore receives low-latency reads without introducing a separate ETL-maintained copy of underwriting logic.

## Runtime interaction

Genie investigates; the underwriter decides. The signed-in user's identity is preserved across the Databricks App, Lakebase, Genie, the SQL warehouse, and Unity Catalog.

![Horizon Auto Insurance runtime interaction](diagrams/horizon-runtime-interaction.svg)

### Review

The application reads the user's regional review queue, portfolio KPIs, policy evidence, and prior decision history from Lakebase. Policies already decided drop out of the default queue.

### Investigate

The application sends the question and policy context to the Genie Agent. Genie:

- plans the investigation;
- queries governed tables and the `underwriting_metrics` metric view;
- searches approved underwriting guidelines when policy rules are relevant;
- returns generated SQL, evidence, and citations; and
- emits an audit event for the question.

Genie cannot approve a renewal or write an underwriting decision.

### Decide

The underwriter approves the rule-based recommendation or selects a different action and provides an override reason. The application writes the decision and audit event to Lakebase, then advances to the next undecided policy.

## Databricks technology map

| Technology | Role in the solution |
|---|---|
| **Lakeflow Spark Declarative Pipelines** | Incremental file ingestion, CDC, data-quality expectations, and governed feature engineering |
| **Delta Lake** | Analytical system of record for raw data, curated features, predictions, and policy-risk decisions |
| **Unity Catalog** | Permissions, ABAC masking and row filtering, lineage, volumes, model governance, and auditability |
| **MLflow** | Experiment tracking, model registration, production aliases, and scoring lifecycle |
| **Metric views** | Shared definitions for policy count, expected loss, loss ratio, renewal urgency, and interventions |
| **Genie** | Governed natural-language analysis over metric views, policy evidence, and underwriting guidelines |
| **Lakebase** | Low-latency application reads plus operational decision, override, and audit writes |
| **Databricks Apps** | Identity-aware underwriter workflow for review, investigation, and decisioning |
| **Unity AI Gateway** | Governed access and observability for the underwriting copilot endpoint |
| **Declarative Automation Bundles** | Deployment of pipelines, jobs, warehouses, volumes, application resources, and permissions as code |

## Governance and responsible use

- **Human control:** The model scores risk and rules recommend an action; only an underwriter records the final decision.
- **Data minimization:** Analyst and application surfaces omit direct contact data and exact GPS coordinates.
- **Identity-aware access:** One regional assignment contract scopes rows in Unity Catalog and Lakebase.
- **Explainability:** Model drivers, generated SQL, guideline citations, selected action, and override reason remain available for review.
- **Quality enforcement:** Referential-integrity expectations prevent invalid policy relationships from reaching Gold.
- **Auditability:** Questions, model outputs, recommendations, decisions, timestamps, and reviewer identity are recorded.
- **Fairness monitoring:** Direct PII is excluded from model features, and outcomes can be evaluated across approved comparison groups.

## Repository map

| Area | Location |
|---|---|
| Databricks App | [`apps/horizon-underwriting`](../apps/horizon-underwriting) |
| Lakeflow pipeline | [`src/pipeline/horizon_pipeline.py`](../src/pipeline/horizon_pipeline.py) |
| Model training and scoring | [`src/ml`](../src/ml) |
| Canonical decision build | [`src/gold/build_policy_risk_decisions.sql`](../src/gold/build_policy_risk_decisions.sql) |
| Metric view | [`src/metrics/create_underwriting_metrics.sql`](../src/metrics/create_underwriting_metrics.sql) |
| Lakebase synchronization | [`src/lakebase/sync_policy_risk_decisions.py`](../src/lakebase/sync_policy_risk_decisions.py) |
| Genie configuration | [`src/genie/horizon_genie.json`](../src/genie/horizon_genie.json) |
| Governance policies | [`src/governance/apply_customer_abac.sql`](../src/governance/apply_customer_abac.sql) |
| Deployment resources | [`resources`](../resources) and [`databricks.yml`](../databricks.yml) |
| Detailed delivery plan | [`HORIZON_USE_CASE_PLAN.md`](../HORIZON_USE_CASE_PLAN.md) |

## Try the application

[Open the Horizon underwriting application](https://horizon-underwriting-7474647158801289.aws.databricksapps.com)

