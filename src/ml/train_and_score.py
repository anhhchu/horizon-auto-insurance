# Databricks notebook source
import json

import mlflow
import mlflow.sklearn
import pandas as pd
from mlflow import MlflowClient
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

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
if not spark.catalog.tableExists(feature_table):
    raise RuntimeError(
        f"Required feature table {feature_table} does not exist. "
        "Run the production-mode Horizon Lakeflow pipeline before model training."
    )

training = spark.table(feature_table).select("policy_id", *feature_columns, "had_claim").toPandas()
training = training.sort_values("policy_id")
split = int(len(training) * 0.8)
train = training.iloc[:split]
test = training.iloc[split:]

pipeline = Pipeline(
    [
        ("prep", ColumnTransformer([("numeric", Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), feature_columns)])),
        ("model", LogisticRegression(max_iter=500, class_weight="balanced", random_state=42)),
    ]
)

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(f"/Users/{spark.sql('SELECT current_user()').first()[0]}/horizon_auto/claim_risk")
with mlflow.start_run(run_name="horizon-claim-risk") as run:
    pipeline.fit(train[feature_columns], train["had_claim"])
    probabilities = pipeline.predict_proba(test[feature_columns])[:, 1]
    auc = roc_auc_score(test["had_claim"], probabilities)
    mlflow.log_metric("test_roc_auc", auc)
    mlflow.log_param("training_rows", len(train))
    model_info = mlflow.sklearn.log_model(
        sk_model=pipeline,
        name="model",
        input_example=train[feature_columns].head(5),
        registered_model_name=model_name,
    )

client = MlflowClient(registry_uri="databricks-uc")
client.set_registered_model_alias(model_name, "prod", model_info.registered_model_version)

all_features = training[feature_columns]
training["claim_risk_probability"] = pipeline.predict_proba(all_features)[:, 1]
training["model_version"] = str(model_info.registered_model_version)
training["scored_at"] = pd.Timestamp.utcnow().tz_localize(None)
spark.createDataFrame(training[["policy_id", "claim_risk_probability", "model_version", "scored_at"]]).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{catalog}.{schema}.policy_risk_predictions")

dbutils.notebook.exit(json.dumps({"model": model_name, "model_version": model_info.registered_model_version, "test_roc_auc": auc, "training_rows": len(train), "scored_rows": len(training)}))
