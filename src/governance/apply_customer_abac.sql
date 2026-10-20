CREATE OR REPLACE FUNCTION serverless_stable_dvmvgw_catalog.horizon_auto.mask_customer_display_name(customer_display_name STRING)
RETURNS STRING
RETURN CASE
  WHEN customer_display_name IS NULL THEN NULL
  ELSE CONCAT(LEFT(customer_display_name, 1), REPEAT('*', GREATEST(LENGTH(customer_display_name) - 1, 0)))
END;

-- Region entitlements: the single source for who sees which region, in Unity Catalog (row
-- filter below) and in Lakebase (synced as underwriter_region_assignments_synced and joined in
-- the app's horizon_app.my_policy_risk_decisions view). Principals match current_user():
-- user email, or the service principal's application ID.
CREATE TABLE IF NOT EXISTS serverless_stable_dvmvgw_catalog.horizon_auto.underwriter_region_assignments (
  principal STRING NOT NULL COMMENT 'current_user() of the reader: user email or service principal application ID',
  region STRING NOT NULL COMMENT 'Horizon underwriting region the principal may see',
  CONSTRAINT underwriter_region_assignments_pk PRIMARY KEY (principal, region)
)
COMMENT 'Underwriter region entitlements for the Unity Catalog row filter and the Lakebase app view.'
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

MERGE INTO serverless_stable_dvmvgw_catalog.horizon_auto.underwriter_region_assignments AS target
USING (
  SELECT * FROM VALUES
    ('anhhoang.chu@databricks.com', 'West'),
    -- horizon-underwriting app service principal (Genie and copilot calls made as the app).
    ('82488809-bd0c-4366-8775-4af4290fca11', 'West')
  AS assignments(principal, region)
) AS source
ON target.principal = source.principal AND target.region = source.region
WHEN NOT MATCHED THEN INSERT *
WHEN NOT MATCHED BY SOURCE THEN DELETE;

CREATE OR REPLACE FUNCTION serverless_stable_dvmvgw_catalog.horizon_auto.filter_underwriter_region(policy_region STRING)
RETURNS BOOLEAN
RETURN EXISTS (
  SELECT 1
  FROM serverless_stable_dvmvgw_catalog.horizon_auto.underwriter_region_assignments AS assignment
  WHERE assignment.principal = current_user()
    AND assignment.region = policy_region
);

ALTER TABLE serverless_stable_dvmvgw_catalog.horizon_auto.silver_customers
  ALTER COLUMN customer_display_name
  SET TAGS ('class.name');

ALTER MATERIALIZED VIEW serverless_stable_dvmvgw_catalog.horizon_auto.renewal_review_candidates
  ALTER COLUMN customer_display_name
  SET TAGS ('class.name');

ALTER MATERIALIZED VIEW serverless_stable_dvmvgw_catalog.horizon_auto.renewal_review_candidates
  ALTER COLUMN region
  SET TAGS ('class.location');

CREATE OR REPLACE POLICY horizon_mask_customer_names
ON SCHEMA serverless_stable_dvmvgw_catalog.horizon_auto
COMMENT 'Mask synthetic customer names for all analyst-facing queries.'
COLUMN MASK serverless_stable_dvmvgw_catalog.horizon_auto.mask_customer_display_name
TO `account users`
FOR TABLES
MATCH COLUMNS has_tag('class.name') AS customer_name
ON COLUMN customer_name;

CREATE OR REPLACE POLICY horizon_filter_underwriter_regions
ON SCHEMA serverless_stable_dvmvgw_catalog.horizon_auto
COMMENT 'Restrict underwriters to their assigned operating region on analyst-facing renewal records.'
ROW FILTER serverless_stable_dvmvgw_catalog.horizon_auto.filter_underwriter_region
TO `account users`
FOR TABLES
MATCH COLUMNS has_tag('class.location') AS region
USING COLUMNS (region);
