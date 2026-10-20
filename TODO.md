# TODO — roll out the production data path

All items are implemented in code. What remains is deploying in order and verifying. Architecture: [README.md](README.md#data-flow-architecture).

## What changed

| Area | Change |
|---|---|
| Single source of truth | `src/gold/build_policy_risk_decisions.sql` merges into `policy_risk_decisions` (change data feed on) and creates `governed_policy_risk_decisions`. Bands, recommended action, expected loss, and `requires_review` are defined only there. |
| Pipeline | `behavior_risk_score` moved to `policy_driving_features`; bands, `recommended_intervention`, `expected_loss` removed from `renewal_review_candidates`; `portfolio_risk_kpis` removed. |
| Metrics and Genie | `underwriting_metrics` and `src/genie/horizon_genie.json` read `governed_policy_risk_decisions`. |
| Lakebase serving | `serving/databricks.yml`: synced table `horizon_auto.policy_risk_decisions_synced` (triggered) in the standard catalog, so no `CREATE CATALOG` is needed. Postgres table: `horizon_auto.policy_risk_decisions_synced` in `databricks_postgres`. |
| Sync | Task `sync_lakebase` after `build_policy_risk_decisions` in both scoring jobs: triggers the sync, waits, and fails if Postgres and Delta disagree on policies, review count, or expected loss. Skips cleanly until the serving bundle exists. |
| Warehouse | `resources/horizon_warehouse.yml`: dedicated serverless X-Small `horizon-auto-warehouse` (auto-stop 10 min) for SQL tasks and Genie. |
| App reads | `/api/queue`, `/api/policies/:id`, `/api/portfolio` read the synced table in Postgres and join `underwriting_decisions`. The queue hides decided policies by default; KPIs show decided count; "Next policy" goes to the next undecided one. Warehouse query files removed. |
| Chat | The legacy Supervisor copilot is retired. `POST /api/genie/ask` proxies Genie Agent mode as the user and streams steps, SQL, results, and cited answers to a Genie panel on the policy page (policy-scoped starters) and queue page (portfolio). The Ask Genie page and the `serving` plugin are removed. |
| Guidelines | `src/guidelines/`: three synthetic PDFs (underwriting guidelines UW-PA-2026, VectorDrive program terms VD-SDP-2026, West notice rules NTC-WEST-2026), eval questions, and the `underwriting_guidelines` volume in the root bundle. |

### Decided, not changed

- **No Knowledge Assistant or Supervisor.** Both are legacy offerings; Genie Agents now cover documents and data. The Agent Bricks CLI (code-first agents) is the follow-on for automated work such as an overnight pre-review agent.
- **Lakebase DDL stays at app startup.** The app service principal must create and own `horizon_app`; `ensureSchema` skips DDL when the tables exist, so non-owners (local dev) start cleanly.
- **Lakebase compute is already warm.** `primary` runs at 1 CU with a 24-hour suspend timeout, and the nightly sync wakes it.

## Rollout (profile `DEFAULT`, run from the paths shown)

Done on 2026-10-19: root deploy, governance, first operational run (gold table built), metrics, serving deploy (synced table online and reconciled: 2,000 policies, $1,226,014.44 expected loss in both Delta and Postgres).

Remaining, in order:

1. Redeploy the root bundle (region entitlements, guidelines volume, active-only `requires_review`):
   `cd ~/Documents/fe-bar && databricks bundle deploy --profile DEFAULT`
2. Apply governance. Creates `underwriter_region_assignments` and switches `filter_underwriter_region` to read it:
   `databricks bundle run horizon_governance --profile DEFAULT`
3. Upload the guideline PDFs:
   `databricks fs cp -r --overwrite src/guidelines/pdf dbfs:/Volumes/serverless_stable_dvmvgw_catalog/horizon_auto/underwriting_guidelines/ --profile DEFAULT`
4. Rebuild, then refresh the metric view:
   `databricks bundle run horizon_operational --profile DEFAULT` then `databricks bundle run horizon_metrics --profile DEFAULT`
   (`sync_lakebase` reports `SKIPPED` until step 5 adds the entitlement synced table.)
5. Redeploy the serving bundle. Adds `underwriter_region_assignments_synced`:
   `cd ~/Documents/fe-bar/serving && databricks bundle deploy --profile DEFAULT`
6. Let the app service principal read the synced tables (it owns the per-user views built on them):
   ```bash
   databricks psql --project horizon-auto --profile DEFAULT -- -d databricks_postgres -c \
     'GRANT USAGE ON SCHEMA horizon_auto TO "82488809-bd0c-4366-8775-4af4290fca11";
      GRANT SELECT ON ALL TABLES IN SCHEMA horizon_auto TO "82488809-bd0c-4366-8775-4af4290fca11";
      ALTER DEFAULT PRIVILEGES IN SCHEMA horizon_auto GRANT SELECT ON TABLES TO "82488809-bd0c-4366-8775-4af4290fca11";'
   ```
   Do not grant `horizon_auto` to users. They read only `horizon_app.my_*` views, which filter by `current_user`.
7. Point Genie at `horizon-auto-warehouse` and apply the config:
   `databricks genie update-space 01f1c6c7119c15fb980d25cd32ec7bd2 --warehouse-id e0d8b485c7066e4e --serialized-space "$(cat src/genie/horizon_genie.json)" --profile DEFAULT`
8. Attach the guidelines to Genie (UI): an admin enables **Analyze Files in Volumes with Genie Agents**; then *Horizon Underwriting Intelligence* → **Sources** → add volume `serverless_stable_dvmvgw_catalog.horizon_auto.underwriting_guidelines`. After step 7, which replaces the config.
9. Unity Catalog grants:
   - `SELECT` on `governed_policy_risk_decisions` to Genie users and the app service principal; `READ VOLUME` on `underwriting_guidelines` to Genie users.
   - Lock down the unfiltered tables: `SELECT` on `policy_risk_decisions`, `policy_risk_decisions_synced`, and `underwriter_region_assignments_synced` only for the job owner. Check with `databricks grants get table <name>` and revoke schema-level grants that expose them.
10. Deploy the app (`postgres` user scope added; the service principal creates the `horizon_app.my_*` views at startup):
    `cd ~/Documents/fe-bar/apps/horizon-underwriting && databricks bundle deploy --profile DEFAULT && databricks bundle run app --profile DEFAULT`
11. Each additional underwriter needs a Lakebase role and a region assignment:
    - `databricks psql --project horizon-auto --profile DEFAULT -- -d databricks_postgres -c "SELECT databricks_create_role('user@example.com', 'USER');"`
    - Add `('user@example.com', '<Region>')` to the `MERGE` in `src/governance/apply_customer_abac.sql`, rerun governance, then the operational job (syncs entitlements).

Optional cleanup: the legacy Supervisor Agent `Horizon Underwriting Copilot` (`mas-dc157dce-endpoint`) and `src/agents/*.json` are no longer used by the app.

## Verify

- [ ] The app logs `Plugin.asUser is deprecated` (expected) and decisions show your email as reviewer, taken from the database identity.
- [ ] A user with no row in `underwriter_region_assignments` sees an empty queue, and Genie returns no rows for them.

- [ ] `sync_lakebase` on the next `horizon-auto-operational` run reports `SYNCED` with matching counts.
- [ ] Signed in as you, the app shows only West: 189 active policies requiring review (32 Critical, 157 High as of the 2026-10-20 check) and loads without a warehouse warm-up.
- [ ] Recording a decision removes the policy from "To review" and increments the decided KPI.
- [ ] Genie answers a policy starter with SQL steps and citations, and "Can POL-… move to a deductible review?" cites UW-PA-2026 §4.2 and NTC-WEST-2026 once the volume is attached.
- [ ] ``MEASURE(`Policies Requiring Review`)`` for West in `underwriting_metrics` equals the app KPI.

## Production considerations (not needed for the demo)

Lakebase reads run per user (`lakebase.asUser`), so Postgres enforces region scoping through `current_user`. At production scale:

- Every underwriter needs a Lakebase role (`databricks_create_role`) before they can connect.
- Each active user gets a connection pool; size the Lakebase compute and pool limits for concurrent users.
- Group-based assignments need `is_account_group_member()` in Unity Catalog and `pg_has_role()` in Postgres.
- Per-user Lakebase routing relies on AppKit's deprecated plugin-level `asUser`.

Alternative for many users: one service-principal pool, `SET LOCAL horizon.user` from the Apps proxy identity per request, and views filtering on `current_setting('horizon.user')`. Same entitlement table; the database trusts the app-supplied identity instead of a per-user login.
