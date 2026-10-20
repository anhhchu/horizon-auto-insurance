# Databricks notebook source
import json

import mlflow
import pandas as pd

dbutils.widgets.text("catalog", "serverless_stable_dvmvgw_catalog")
dbutils.widgets.text("schema", "horizon_auto")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
model_name = f"{catalog}.{schema}.driving_claim_risk_model"
feature_table = f"{catalog}.{schema}.policy_driving_features"

feature_columns = [
    "trip_count_90d",
    "miles_90d",
    "nighttime_miles_pct",
    "severe_weather_miles_pct",
    "event_count_90d",
    "speeding_events_90d",
    "hard_brake_events_90d",
    "distraction_events_90d",
    "avg_event_severity",
]

mlflow.set_registry_uri("databricks-uc")
model = mlflow.sklearn.load_model(f"models:/{model_name}@prod")
features = spark.table(feature_table).select("policy_id", *feature_columns).toPandas()
features["claim_risk_probability"] = model.predict_proba(features[feature_columns])[:, 1]
features["model_alias"] = "prod"
features["scored_at"] = pd.Timestamp.utcnow().tz_localize(None)

spark.createDataFrame(
    features[["policy_id", "claim_risk_probability", "model_alias", "scored_at"]]
).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{catalog}.{schema}.policy_risk_predictions"
)

dbutils.notebook.exit(
    json.dumps(
        {
            "model": model_name,
            "model_alias": "prod",
            "scored_rows": len(features),
            "output_table": f"{catalog}.{schema}.policy_risk_predictions",
        }
    )
)
