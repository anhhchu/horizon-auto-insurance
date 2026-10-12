# Horizon Auto Insurance

Horizon Auto Insurance is an end-to-end Databricks prototype for proactive driving-risk prevention and human-approved renewal decisioning.

The solution ingests synthetic files from the fictional VectorDrive Telematics partner, governs policy and driving data in Unity Catalog, predicts claims risk, supports natural-language analysis through a Genie Agent, serves governed recommendations through an AI Gateway-backed underwriting agent, persists decisions in Lakebase, and surfaces the workflow in a Databricks App.

See [HORIZON_USE_CASE_PLAN.md](HORIZON_USE_CASE_PLAN.md) for the business story, architecture, delivery contract, pipeline design, responsible-use controls, implementation sequence, and execution-evidence checklist.

## Core Journey

1. Lakeflow ingests full and incremental synthetic partner files.
2. Unity Catalog governs raw data, curated features, and model assets.
3. ML predicts expected claims risk and explains contributing factors.
4. Genie provides governed natural-language portfolio analytics.
5. Unity AI Gateway governs the Underwriting Copilot endpoint.
6. Lakebase stores review state, decisions, overrides, and audit history.
7. A Databricks App gives underwriters a human-controlled review workflow.

## Status

Planning complete; implementation pending.
