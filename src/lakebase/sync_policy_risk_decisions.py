# Databricks notebook source
# Triggers the Lakebase synced tables (risk decisions and region entitlements) after each gold
# build, waits for their sync pipelines, then reconciles risk decisions in Postgres against Delta.
# The synced tables are defined in serving/databricks.yml. Until that bundle is deployed this
# task exits cleanly so the operational job still succeeds.
import json
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound

dbutils.widgets.text("catalog", "serverless_stable_dvmvgw_catalog")
dbutils.widgets.text("schema", "horizon_auto")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
synced_table = f"{catalog}.{schema}.policy_risk_decisions_synced"
source_table = f"{catalog}.{schema}.policy_risk_decisions"
# Entitlements first so new region assignments are in place before new rows land.
synced_tables = [f"{catalog}.{schema}.underwriter_region_assignments_synced", synced_table]

w = WorkspaceClient()


def find_key(value, key):
    if isinstance(value, dict):
        if isinstance(value.get(key), str):
            return value[key]
        for child in value.values():
            found = find_key(child, key)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = find_key(child, key)
            if found:
                return found
    return None


def pipeline_for(name):
    try:
        synced = w.api_client.do("GET", f"/api/2.0/postgres/synced_tables/{name}")
    except NotFound:
        return None
    pipeline_id = find_key(synced, "pipeline_id")
    if not pipeline_id:
        raise RuntimeError(f"No pipeline_id on synced table {name}: {json.dumps(synced)[:500]}")
    return pipeline_id


def sync(name, pipeline_id):
    update_id = w.pipelines.start_update(pipeline_id=pipeline_id).update_id
    deadline = time.time() + 30 * 60
    while True:
        update = w.pipelines.get_update(pipeline_id=pipeline_id, update_id=update_id).update
        state = update.state.value if update and update.state else "UNKNOWN"
        if state == "COMPLETED":
            return update_id
        if state in ("FAILED", "CANCELED"):
            raise RuntimeError(f"Lakebase sync of {name} ({update_id}) ended in {state}")
        if time.time() > deadline:
            raise TimeoutError(f"Lakebase sync of {name} ({update_id}) still {state} after 30 minutes")
        time.sleep(15)


pipelines = {name: pipeline_for(name) for name in synced_tables}
missing = [name for name, pipeline_id in pipelines.items() if pipeline_id is None]
if missing:
    dbutils.notebook.exit(json.dumps({"status": "SKIPPED", "reason": f"not deployed yet (serving bundle): {missing}"}))
updates = {name: sync(name, pipeline_id) for name, pipeline_id in pipelines.items()}

# Reconcile: the app reads Postgres, analysts read Delta. They must agree.
query = """
SELECT COUNT(*) AS policies, COUNT_IF(requires_review) AS requiring_review, ROUND(SUM(expected_loss), 2) AS expected_loss
FROM {table}
"""
delta = spark.sql(query.format(table=source_table)).first().asDict()
postgres = spark.sql(query.format(table=synced_table)).first().asDict()
if delta != postgres:
    raise AssertionError(f"Lakebase out of sync with Delta: delta={delta} postgres={postgres}")

dbutils.notebook.exit(json.dumps({"status": "SYNCED", "updates": updates, **{k: str(v) for k, v in delta.items()}}))
