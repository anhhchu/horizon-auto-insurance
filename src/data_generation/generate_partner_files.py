# Databricks notebook source
import json
from datetime import date

from faker import Faker
from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "serverless_stable_dvmvgw_catalog")
dbutils.widgets.text("schema", "horizon_auto")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
policy_admin_volume = f"/Volumes/{catalog}/{schema}/policy_admin_landing"
telematics_volume = f"/Volumes/{catalog}/{schema}/vectordrive_landing"

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{schema}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.policy_admin_landing")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog}.{schema}.vectordrive_landing")

as_of_date = date(2026, 10, 1)
as_of = F.to_date(F.lit(as_of_date.isoformat()))

fake = Faker("en_US")
Faker.seed(20261001)
customer_names = spark.createDataFrame(
    [(customer_num, f"{fake.first_name()} {fake.last_name()}") for customer_num in range(2_000)],
    "customer_num LONG, customer_display_name STRING",
)

customers = (
    spark.range(2_000, numPartitions=8)
    .withColumnRenamed("id", "customer_num")
    .join(F.broadcast(customer_names), "customer_num")
    .select(
        F.format_string("CUST-%06d", F.col("customer_num")).alias("customer_id"),
        "customer_display_name",
        F.element_at(F.array(*[F.lit(x) for x in ["West", "Southwest", "Midwest", "Southeast"]]), (F.col("customer_num") % 4 + 1).cast("int")).alias("region"),
        F.element_at(F.array(*[F.lit(x) for x in ["Standard", "Preferred", "Premier"]]), (F.col("customer_num") % 3 + 1).cast("int")).alias("customer_segment"),
        F.lit(True).alias("telematics_consent"),
        F.to_timestamp(F.lit("2026-10-01T00:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

policies = (
    spark.range(2_000, numPartitions=8)
    .select(
        F.format_string("POL-%06d", F.col("id")).alias("policy_id"),
        F.format_string("CUST-%06d", F.col("id")).alias("customer_id"),
        F.format_string("VIN%014d", F.col("id")).alias("vehicle_id"),
        F.element_at(F.array(*[F.lit(x) for x in ["West", "Southwest", "Midwest", "Southeast"]]), (F.col("id") % 4 + 1).cast("int")).alias("region"),
        F.date_sub(as_of, (F.col("id") % 500).cast("int")).alias("effective_date"),
        F.date_add(as_of, (F.col("id") % 60 + 7).cast("int")).alias("renewal_date"),
        F.round(F.lit(900) + (F.col("id") % 1100), 2).alias("annual_premium"),
        F.when(F.col("id") % 10 < 8, "ACTIVE").otherwise("REVIEW").alias("policy_status"),
        F.to_timestamp(F.lit("2026-10-01T00:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

vehicles = (
    spark.range(2_000, numPartitions=8)
    .select(
        F.format_string("VIN%014d", F.col("id")).alias("vehicle_id"),
        F.format_string("POL-%06d", F.col("id")).alias("policy_id"),
        (F.lit(2016) + F.col("id") % 10).cast("int").alias("model_year"),
        F.element_at(F.array(*[F.lit(x) for x in ["Sedan", "SUV", "Pickup", "EV"]]), (F.col("id") % 4 + 1).cast("int")).alias("vehicle_type"),
        F.element_at(F.array(*[F.lit(x) for x in ["Standard", "Advanced", "Premium"]]), (F.col("id") % 3 + 1).cast("int")).alias("safety_package"),
        F.to_timestamp(F.lit("2026-10-01T00:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

trips = (
    spark.range(120_000, numPartitions=16)
    .withColumn("policy_num", F.col("id") % 2_000)
    .withColumn("trip_day", F.date_sub(as_of, (F.col("id") % 90).cast("int")))
    .withColumn("high_risk", F.col("policy_num").between(200, 279))
    .select(
        F.format_string("TRIP-%09d", F.col("id")).alias("trip_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.format_string("VIN%014d", F.col("policy_num")).alias("vehicle_id"),
        F.to_timestamp(F.concat_ws(" ", F.col("trip_day"), F.format_string("%02d:00:00", (F.col("id") % 24).cast("int")))).alias("trip_start_at"),
        F.round(F.lit(3.0) + F.pmod(F.hash("id"), F.lit(420)) / 10.0, 1).alias("distance_miles"),
        F.when(F.col("high_risk"), F.lit(0.48)).otherwise(F.lit(0.16)).alias("nighttime_miles_pct"),
        F.when(F.col("high_risk"), F.lit(0.22)).otherwise(F.lit(0.07)).alias("severe_weather_miles_pct"),
        F.to_timestamp(F.lit("2026-10-01T01:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

events = (
    spark.range(300_000, numPartitions=32)
    .withColumn("policy_num", F.col("id") % 2_000)
    .withColumn("high_risk", F.col("policy_num").between(200, 279))
    .select(
        F.format_string("EVT-%09d", F.col("id")).alias("event_id"),
        F.format_string("TRIP-%09d", F.col("id") % 120_000).alias("trip_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.element_at(
            F.when(F.col("high_risk"), F.array(*[F.lit(x) for x in ["PHONE_DISTRACTION", "SPEEDING", "HARD_BRAKE", "PHONE_DISTRACTION"]]))
            .otherwise(F.array(*[F.lit(x) for x in ["HARD_BRAKE", "RAPID_ACCELERATION", "SPEEDING", "HARD_BRAKE"]])),
            (F.col("id") % 4 + 1).cast("int"),
        ).alias("event_type"),
        F.to_timestamp(F.expr("timestamp'2026-10-01 00:00:00' - INTERVAL 1 DAY * (id % 90)")).alias("event_timestamp"),
        F.when(F.col("high_risk"), F.lit(0.85)).otherwise(F.lit(0.35)).alias("severity"),
        F.to_timestamp(F.lit("2026-10-01T01:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

claims = (
    spark.range(450, numPartitions=8)
    .withColumn("policy_num", F.when(F.col("id") < 160, F.col("id") % 80 + 200).otherwise(F.col("id") * 7 % 2_000))
    .select(
        F.format_string("CLM-%07d", F.col("id")).alias("claim_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.date_sub(as_of, (F.col("id") % 365).cast("int")).alias("loss_date"),
        F.round(F.lit(800) + F.pmod(F.hash("id"), F.lit(24000)), 2).alias("incurred_amount"),
        F.when(F.col("id") % 8 == 0, "BODILY_INJURY").otherwise("COLLISION").alias("claim_type"),
        F.to_timestamp(F.lit("2026-10-01T02:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

weather = (
    spark.range(90 * 4, numPartitions=4)
    .select(
        F.date_sub(as_of, (F.col("id") / 4).cast("int")).alias("weather_date"),
        F.element_at(F.array(*[F.lit(x) for x in ["West", "Southwest", "Midwest", "Southeast"]]), (F.col("id") % 4 + 1).cast("int")).alias("region"),
        F.when(F.col("id") % 11 == 0, "SEVERE").when(F.col("id") % 5 == 0, "RAIN").otherwise("CLEAR").alias("condition"),
        F.to_timestamp(F.lit("2026-10-01T03:00:00Z")).alias("source_updated_at"),
        F.lit("FULL-20261001").alias("batch_id"),
    )
)

policy_admin_datasets = {
    "customers": customers,
    "policies": policies,
    "vehicles": vehicles,
    "claims": claims,
}

telematics_datasets = {
    "trips": trips,
    "driving_events": events,
    "weather": weather,
}

for name, frame in policy_admin_datasets.items():
    frame.write.mode("overwrite").json(f"{policy_admin_volume}/{name}/load_type=FULL/load_date=2026-10-01")

for name, frame in telematics_datasets.items():
    frame.write.mode("overwrite").json(f"{telematics_volume}/{name}/load_type=FULL/load_date=2026-10-01")

manifest = {
    "batch_id": "FULL-20261001",
    "delivery_timestamp": "2026-10-01T04:00:00Z",
    "load_type": "FULL",
    "schema_version": "1.0",
    "source_system": "HORIZON_POLICY_ADMIN",
    "record_counts": {"customers": 2000, "policies": 2000, "vehicles": 2000, "claims": 450},
}
dbutils.fs.put(f"{policy_admin_volume}/manifests/FULL-20261001.json", json.dumps(manifest, indent=2), True)
dbutils.fs.put(
    f"{telematics_volume}/manifests/FULL-20261001.json",
    json.dumps({"batch_id": "FULL-20261001", "delivery_timestamp": "2026-10-01T04:00:00Z", "load_type": "FULL", "schema_version": "1.0", "source_system": "VECTORDRIVE", "record_counts": {"trips": 120000, "driving_events": 300000, "weather": 360}}, indent=2),
    True,
)

incremental_trips = (
    spark.range(2_000, numPartitions=8)
    .withColumn("policy_num", F.when(F.col("id") < 900, F.col("id") % 80 + 200).otherwise((F.col("id") * 13) % 2_000))
    .select(
        F.format_string("TRIP-I-%08d", F.col("id")).alias("trip_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.format_string("VIN%014d", F.col("policy_num")).alias("vehicle_id"),
        F.to_timestamp(F.lit("2026-10-02T08:00:00Z")).alias("trip_start_at"),
        F.round(F.lit(3.0) + F.pmod(F.hash("id"), F.lit(420)) / 10.0, 1).alias("distance_miles"),
        F.when(F.col("policy_num").between(200, 279), F.lit(0.48)).otherwise(F.lit(0.16)).alias("nighttime_miles_pct"),
        F.when(F.col("policy_num").between(200, 279), F.lit(0.22)).otherwise(F.lit(0.07)).alias("severe_weather_miles_pct"),
        F.to_timestamp(F.lit("2026-10-02T08:10:00Z")).alias("source_updated_at"),
        F.lit("INC-20261002-08").alias("batch_id"),
    )
)

incremental_events = (
    spark.range(5_000, numPartitions=8)
    .withColumn("trip_num", F.col("id") % 2_000)
    .withColumn("policy_num", F.when(F.col("trip_num") < 900, F.col("trip_num") % 80 + 200).otherwise((F.col("trip_num") * 13) % 2_000))
    .select(
        F.format_string("EVT-I-%08d", F.col("id")).alias("event_id"),
        F.format_string("TRIP-I-%08d", F.col("trip_num")).alias("trip_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.when(F.col("id") % 3 == 0, "PHONE_DISTRACTION").when(F.col("id") % 3 == 1, "SPEEDING").otherwise("HARD_BRAKE").alias("event_type"),
        F.to_timestamp(F.lit("2026-10-02T08:00:00Z")).alias("event_timestamp"),
        F.when(F.col("policy_num").between(200, 279), F.lit(0.92)).otherwise(F.lit(0.4)).alias("severity"),
        F.to_timestamp(F.lit("2026-10-02T08:10:00Z")).alias("source_updated_at"),
        F.lit("INC-20261002-08").alias("batch_id"),
    )
)
incremental_trips.write.mode("overwrite").json(f"{telematics_volume}/trips/load_type=INCREMENTAL/delivery_date=2026-10-02/hour=08")
incremental_events.write.mode("overwrite").json(f"{telematics_volume}/driving_events/load_type=INCREMENTAL/delivery_date=2026-10-02/hour=08")
dbutils.fs.put(
    f"{telematics_volume}/manifests/INC-20261002-08.json",
    json.dumps({"batch_id": "INC-20261002-08", "delivery_timestamp": "2026-10-02T08:15:00Z", "load_type": "INCREMENTAL", "schema_version": "1.0", "record_counts": {"trips": 2000, "driving_events": 5000}}, indent=2),
    True,
)

dbutils.notebook.exit(json.dumps({"policy_admin_volume": policy_admin_volume, "telematics_volume": telematics_volume, "policy_admin_datasets": list(policy_admin_datasets), "telematics_datasets": list(telematics_datasets), "full_batch": "FULL-20261001", "incremental_batch": "INC-20261002-08"}))
