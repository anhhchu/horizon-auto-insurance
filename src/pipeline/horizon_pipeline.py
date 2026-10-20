from pyspark import pipelines as dp
from pyspark.sql import functions as F
from pyspark.sql.window import Window

policy_admin_path = spark.conf.get("horizon.policy_admin_path")
telematics_path = spark.conf.get("horizon.telematics_path")


def ingest_json(base_path, dataset, schema_hints):
    return (
        spark.readStream.format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.partitionColumns", "load_type")
        .option("cloudFiles.schemaHints", schema_hints)
        .option("cloudFiles.schemaEvolutionMode", "rescue")
        .load(f"{base_path}/{dataset}")
        .withColumn("source_file", F.col("_metadata.file_path"))
        .withColumn("ingested_at", F.current_timestamp())
    )


@dp.table(name="bronze_customers", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_customers():
    return ingest_json(policy_admin_path, "customers", "customer_id STRING, customer_display_name STRING, region STRING, customer_segment STRING, telematics_consent BOOLEAN, source_updated_at TIMESTAMP, batch_id STRING")


@dp.table(name="bronze_policies", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_policies():
    return ingest_json(policy_admin_path, "policies", "policy_id STRING, customer_id STRING, vehicle_id STRING, region STRING, effective_date DATE, renewal_date DATE, annual_premium DOUBLE, policy_status STRING, source_updated_at TIMESTAMP, batch_id STRING")


@dp.table(name="bronze_vehicles", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_vehicles():
    return ingest_json(policy_admin_path, "vehicles", "vehicle_id STRING, policy_id STRING, model_year INT, vehicle_type STRING, safety_package STRING, source_updated_at TIMESTAMP, batch_id STRING")


@dp.table(name="bronze_trips", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_trips():
    return ingest_json(telematics_path, "trips", "trip_id STRING, policy_id STRING, vehicle_id STRING, trip_start_at TIMESTAMP, distance_miles DOUBLE, nighttime_miles_pct DOUBLE, severe_weather_miles_pct DOUBLE, source_updated_at TIMESTAMP, batch_id STRING")


@dp.table(name="bronze_driving_events", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_driving_events():
    return ingest_json(telematics_path, "driving_events", "event_id STRING, trip_id STRING, policy_id STRING, event_type STRING, event_timestamp TIMESTAMP, severity DOUBLE, source_updated_at TIMESTAMP, batch_id STRING")


@dp.table(name="bronze_claims", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_claims():
    return ingest_json(policy_admin_path, "claims", "claim_id STRING, policy_id STRING, loss_date DATE, incurred_amount DOUBLE, claim_type STRING, source_updated_at TIMESTAMP, batch_id STRING")


@dp.table(name="bronze_weather", table_properties={"quality": "bronze", "delta.enableRowTracking": "true"})
def bronze_weather():
    return ingest_json(telematics_path, "weather", "weather_date DATE, region STRING, condition STRING, source_updated_at TIMESTAMP, batch_id STRING")


def latest(table_name, key):
    frame = spark.read.table(table_name)
    window = Window.partitionBy(key).orderBy(F.col("source_updated_at").desc(), F.col("ingested_at").desc())
    return frame.withColumn("record_rank", F.row_number().over(window)).filter("record_rank = 1").drop("record_rank", "_rescued_data")


@dp.materialized_view(name="silver_customers", table_properties={"quality": "silver", "delta.enableRowTracking": "true"})
@dp.expect_or_fail("valid_customer_id", "customer_id IS NOT NULL")
def silver_customers():
    return latest("bronze_customers", "customer_id")


@dp.materialized_view(name="silver_policies", table_properties={"quality": "silver", "delta.enableRowTracking": "true"})
@dp.expect_or_fail("valid_policy_id", "policy_id IS NOT NULL")
@dp.expect_or_drop("valid_dates", "effective_date <= renewal_date")
def silver_policies():
    return latest("bronze_policies", "policy_id")


@dp.materialized_view(name="silver_vehicles", table_properties={"quality": "silver", "delta.enableRowTracking": "true"})
@dp.expect_or_fail("valid_vehicle_id", "vehicle_id IS NOT NULL")
def silver_vehicles():
    return latest("bronze_vehicles", "vehicle_id")


@dp.materialized_view(name="silver_trips", table_properties={"quality": "silver", "delta.enableRowTracking": "true"})
@dp.expect_or_drop("positive_distance", "distance_miles >= 0")
def silver_trips():
    return latest("bronze_trips", "trip_id")


@dp.materialized_view(name="silver_driving_events", table_properties={"quality": "silver", "delta.enableRowTracking": "true"})
@dp.expect_or_drop("valid_severity", "severity BETWEEN 0 AND 1")
def silver_driving_events():
    return latest("bronze_driving_events", "event_id")


@dp.materialized_view(name="silver_claims", table_properties={"quality": "silver", "delta.enableRowTracking": "true"})
@dp.expect_or_drop("nonnegative_claim", "incurred_amount >= 0")
def silver_claims():
    return latest("bronze_claims", "claim_id")


def orphan_count(child, parent, join_columns, relationship):
    return (
        child.join(parent, join_columns, "left_anti")
        .agg(F.count(F.lit(1)).alias("orphan_count"))
        .withColumn("relationship", F.lit(relationship))
        .select("relationship", "orphan_count")
    )


@dp.materialized_view(name="referential_integrity_checks", table_properties={"quality": "silver"})
@dp.expect_or_fail("no_orphaned_foreign_keys", "orphan_count = 0")
def referential_integrity_checks():
    customers = spark.read.table("silver_customers").select("customer_id")
    policies = spark.read.table("silver_policies").select("policy_id", "customer_id", "vehicle_id")
    vehicles = spark.read.table("silver_vehicles").select("vehicle_id", "policy_id")
    trips = spark.read.table("silver_trips").select("trip_id", "policy_id", "vehicle_id")
    events = spark.read.table("silver_driving_events").select("event_id", "trip_id", "policy_id")
    claims = spark.read.table("silver_claims").select("claim_id", "policy_id")
    checks = [
        orphan_count(policies.select("customer_id"), customers, ["customer_id"], "policy.customer_id -> customer.customer_id"),
        orphan_count(policies.select("policy_id", "vehicle_id"), vehicles.select("policy_id", "vehicle_id"), ["policy_id", "vehicle_id"], "policy.vehicle_id -> vehicle.vehicle_id"),
        orphan_count(trips.select("policy_id"), policies.select("policy_id"), ["policy_id"], "trip.policy_id -> policy.policy_id"),
        orphan_count(trips.select("policy_id", "vehicle_id"), vehicles.select("policy_id", "vehicle_id"), ["policy_id", "vehicle_id"], "trip.vehicle_id -> vehicle.vehicle_id"),
        orphan_count(events.select("trip_id", "policy_id"), trips.select("trip_id", "policy_id"), ["trip_id", "policy_id"], "event.trip_id -> trip.trip_id"),
        orphan_count(claims.select("policy_id"), policies.select("policy_id"), ["policy_id"], "claim.policy_id -> policy.policy_id"),
    ]
    result = checks[0]
    for check in checks[1:]:
        result = result.unionByName(check)
    return result


@dp.materialized_view(name="policy_driving_features", table_properties={"quality": "gold", "delta.enableRowTracking": "true"})
def policy_driving_features():
    trips = spark.read.table("silver_trips")
    events = spark.read.table("silver_driving_events")
    claims = spark.read.table("silver_claims")
    trip_features = trips.groupBy("policy_id").agg(
        F.count("trip_id").alias("trip_count_90d"),
        F.sum("distance_miles").alias("miles_90d"),
        F.avg("nighttime_miles_pct").alias("nighttime_miles_pct"),
        F.avg("severe_weather_miles_pct").alias("severe_weather_miles_pct"),
    )
    event_features = events.groupBy("policy_id").agg(
        F.count("event_id").alias("event_count_90d"),
        F.sum(F.when(F.col("event_type") == "SPEEDING", 1).otherwise(0)).alias("speeding_events_90d"),
        F.sum(F.when(F.col("event_type") == "HARD_BRAKE", 1).otherwise(0)).alias("hard_brake_events_90d"),
        F.sum(F.when(F.col("event_type") == "PHONE_DISTRACTION", 1).otherwise(0)).alias("distraction_events_90d"),
        F.avg("severity").alias("avg_event_severity"),
    )
    claim_features = claims.groupBy("policy_id").agg(
        F.count("claim_id").alias("prior_claim_count"),
        F.sum("incurred_amount").alias("prior_incurred_amount"),
    )
    return (
        trip_features.join(event_features, "policy_id", "left")
        .join(claim_features, "policy_id", "left")
        .fillna(0)
        .withColumn("had_claim", (F.col("prior_claim_count") > 0).cast("int"))
        # Heuristic behavior score kept as an explanatory feature. Risk bands, recommendations,
        # and expected loss come from the ML probability in policy_risk_decisions (src/gold).
        .withColumn(
            "behavior_risk_score",
            F.least(
                F.lit(0.99),
                F.lit(0.08)
                + F.col("nighttime_miles_pct") * 0.25
                + F.col("severe_weather_miles_pct") * 0.15
                + F.col("avg_event_severity") * 0.35
                + F.col("distraction_events_90d") / F.greatest(F.col("trip_count_90d"), F.lit(1)) * 0.4,
            ),
        )
    )


@dp.materialized_view(name="renewal_review_candidates", table_properties={"quality": "gold", "delta.enableRowTracking": "true"})
def renewal_review_candidates():
    policies = spark.read.table("silver_policies").drop("telematics_consent")
    customers = spark.read.table("silver_customers").select("customer_id", "customer_display_name", "customer_segment", "telematics_consent")
    features = spark.read.table("policy_driving_features")
    return policies.join(customers, "customer_id").join(features, "policy_id")
