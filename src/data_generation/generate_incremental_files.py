# Databricks notebook source
import json
from datetime import datetime, timezone

from faker import Faker
from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "serverless_stable_dvmvgw_catalog")
dbutils.widgets.text("schema", "horizon_auto")
dbutils.widgets.text("delivery_date", "")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
requested_delivery_date = dbutils.widgets.get("delivery_date")

delivery_time = datetime.now(timezone.utc)
delivery_date = requested_delivery_date or delivery_time.date().isoformat()
delivery_hour = delivery_time.strftime("%H")
batch_suffix = delivery_time.strftime("%Y%m%d-%H%M%S")
policy_batch_id = f"PAS-INC-{batch_suffix}"
telematics_batch_id = f"VD-INC-{batch_suffix}"

policy_admin_volume = f"/Volumes/{catalog}/{schema}/policy_admin_landing"
telematics_volume = f"/Volumes/{catalog}/{schema}/vectordrive_landing"
source_updated_at = F.to_timestamp(F.lit(delivery_time.isoformat()))

fake = Faker("en_US")
Faker.seed(20261001)
customer_names = spark.createDataFrame(
    [(customer_num, f"{fake.first_name()} {fake.last_name()}") for customer_num in range(2_000)],
    "customer_num LONG, customer_display_name STRING",
)

customer_updates = (
    spark.range(20, numPartitions=2)
    .withColumn("customer_num", F.pmod(F.hash(F.lit(delivery_date), "id"), F.lit(2_000)))
    .join(F.broadcast(customer_names), "customer_num")
    .select(
        F.format_string("CUST-%06d", F.col("customer_num")).alias("customer_id"),
        "customer_display_name",
        F.element_at(F.array(*[F.lit(x) for x in ["West", "Southwest", "Midwest", "Southeast"]]), (F.col("customer_num") % 4 + 1).cast("int")).alias("region"),
        F.element_at(F.array(*[F.lit(x) for x in ["Standard", "Preferred", "Premier"]]), (F.col("customer_num") % 3 + 1).cast("int")).alias("customer_segment"),
        (F.col("customer_num") % 19 != 0).alias("telematics_consent"),
        source_updated_at.alias("source_updated_at"),
        F.lit(policy_batch_id).alias("batch_id"),
    )
)

policy_updates = (
    spark.range(20, numPartitions=2)
    .withColumn("policy_num", F.pmod(F.hash(F.lit(delivery_date), "id"), F.lit(2_000)))
    .select(
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.format_string("CUST-%06d", F.col("policy_num")).alias("customer_id"),
        F.format_string("VIN%014d", F.col("policy_num")).alias("vehicle_id"),
        F.element_at(F.array(*[F.lit(x) for x in ["West", "Southwest", "Midwest", "Southeast"]]), (F.col("policy_num") % 4 + 1).cast("int")).alias("region"),
        F.date_sub(F.to_date(F.lit(delivery_date)), (F.col("policy_num") % 500).cast("int")).alias("effective_date"),
        F.date_add(F.to_date(F.lit(delivery_date)), (F.col("policy_num") % 60 + 7).cast("int")).alias("renewal_date"),
        F.round(F.lit(925) + (F.col("policy_num") % 1100), 2).alias("annual_premium"),
        F.when(F.col("policy_num") % 10 < 8, "ACTIVE").otherwise("REVIEW").alias("policy_status"),
        source_updated_at.alias("source_updated_at"),
        F.lit(policy_batch_id).alias("batch_id"),
    )
)

claim_updates = (
    spark.range(10, numPartitions=2)
    .withColumn("policy_num", F.pmod(F.hash(F.lit(delivery_date), "id"), F.lit(2_000)))
    .select(
        F.concat(F.lit("CLM-I-"), F.regexp_replace(F.lit(delivery_date), "-", ""), F.format_string("-%04d", F.col("id"))).alias("claim_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.to_date(F.lit(delivery_date)).alias("loss_date"),
        F.round(F.lit(1_000) + F.pmod(F.hash("id"), F.lit(20_000)), 2).alias("incurred_amount"),
        F.when(F.col("id") % 5 == 0, "BODILY_INJURY").otherwise("COLLISION").alias("claim_type"),
        source_updated_at.alias("source_updated_at"),
        F.lit(policy_batch_id).alias("batch_id"),
    )
)

trips = (
    spark.range(1_000, numPartitions=4)
    .withColumn("policy_num", F.pmod(F.hash(F.lit(batch_suffix), "id"), F.lit(2_000)))
    .select(
        F.concat(F.lit("TRIP-I-"), F.lit(batch_suffix), F.format_string("-%06d", F.col("id"))).alias("trip_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.format_string("VIN%014d", F.col("policy_num")).alias("vehicle_id"),
        source_updated_at.alias("trip_start_at"),
        F.round(F.lit(3.0) + F.pmod(F.hash("id"), F.lit(420)) / 10.0, 1).alias("distance_miles"),
        F.when(F.col("policy_num").between(200, 279), 0.48).otherwise(0.16).alias("nighttime_miles_pct"),
        F.when(F.col("policy_num").between(200, 279), 0.22).otherwise(0.07).alias("severe_weather_miles_pct"),
        source_updated_at.alias("source_updated_at"),
        F.lit(telematics_batch_id).alias("batch_id"),
    )
)

events = (
    spark.range(3_000, numPartitions=8)
    .withColumn("trip_num", F.col("id") % 1_000)
    .withColumn("policy_num", F.pmod(F.hash(F.lit(batch_suffix), "trip_num"), F.lit(2_000)))
    .select(
        F.concat(F.lit("EVT-I-"), F.lit(batch_suffix), F.format_string("-%06d", F.col("id"))).alias("event_id"),
        F.concat(F.lit("TRIP-I-"), F.lit(batch_suffix), F.format_string("-%06d", F.col("trip_num"))).alias("trip_id"),
        F.format_string("POL-%06d", F.col("policy_num")).alias("policy_id"),
        F.element_at(F.array(*[F.lit(x) for x in ["HARD_BRAKE", "RAPID_ACCELERATION", "SPEEDING", "PHONE_DISTRACTION"]]), (F.col("id") % 4 + 1).cast("int")).alias("event_type"),
        source_updated_at.alias("event_timestamp"),
        F.when(F.col("policy_num").between(200, 279), 0.9).otherwise(0.4).alias("severity"),
        source_updated_at.alias("source_updated_at"),
        F.lit(telematics_batch_id).alias("batch_id"),
    )
)

policy_path = f"load_type=INCREMENTAL/delivery_date={delivery_date}/batch_id={policy_batch_id}"
telematics_path = f"load_type=INCREMENTAL/delivery_date={delivery_date}/hour={delivery_hour}/batch_id={telematics_batch_id}"
for name, frame in {"customers": customer_updates, "policies": policy_updates, "claims": claim_updates}.items():
    frame.write.mode("overwrite").json(f"{policy_admin_volume}/{name}/{policy_path}")
for name, frame in {"trips": trips, "driving_events": events}.items():
    frame.write.mode("overwrite").json(f"{telematics_volume}/{name}/{telematics_path}")

dbutils.fs.put(
    f"{policy_admin_volume}/manifests/{policy_batch_id}.json",
    json.dumps({"source_system": "HORIZON_POLICY_ADMIN", "batch_id": policy_batch_id, "delivery_timestamp": delivery_time.isoformat(), "load_type": "INCREMENTAL", "record_counts": {"customers": 20, "policies": 20, "claims": 10}}, indent=2),
    True,
)
dbutils.fs.put(
    f"{telematics_volume}/manifests/{telematics_batch_id}.json",
    json.dumps({"source_system": "VECTORDRIVE", "batch_id": telematics_batch_id, "delivery_timestamp": delivery_time.isoformat(), "load_type": "INCREMENTAL", "record_counts": {"trips": 1000, "driving_events": 3000}}, indent=2),
    True,
)

dbutils.notebook.exit(json.dumps({"delivery_date": delivery_date, "policy_batch_id": policy_batch_id, "telematics_batch_id": telematics_batch_id}))
