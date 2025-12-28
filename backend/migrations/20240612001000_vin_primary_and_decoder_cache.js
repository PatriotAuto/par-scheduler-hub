const NEW_SCHEMA = "par";

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.createTable(
    { schema: NEW_SCHEMA, name: "vin_decode_cache" },
    {
      vin: { type: "text", primaryKey: true },
      decoded_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      decoded_source: { type: "text", notNull: true, default: "nhtsa_vpic" },
      result_json: { type: "jsonb", notNull: true },
    },
    { ifNotExists: true }
  );

  pgm.createTable(
    { schema: NEW_SCHEMA, name: "vehicles_legacy_no_vin" },
    {
      source_vehicle_id: { type: "bigint" },
      customer_id: {
        type: "bigint",
        references: { schema: NEW_SCHEMA, name: "customers" },
        onDelete: "CASCADE",
      },
      legacy_vehicle_id: { type: "text" },
      year: { type: "integer" },
      make: { type: "text" },
      model: { type: "text" },
      trim: { type: "text" },
      color: { type: "text" },
      plate: { type: "text" },
      vin: { type: "text" },
      mileage: { type: "integer" },
      notes: { type: "text" },
      reason: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    },
    { ifNotExists: true }
  );

  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles_legacy_no_vin" }, ["customer_id"], {
    ifNotExists: true,
  });
  pgm.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS vehicles_legacy_no_vin_source_idx ON ${NEW_SCHEMA}.vehicles_legacy_no_vin (source_vehicle_id, vin)`
  );

  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('${NEW_SCHEMA}.vehicles_v1') IS NULL
         AND to_regclass('${NEW_SCHEMA}.vehicles') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = '${NEW_SCHEMA}' AND table_name = 'vehicles' AND column_name = 'id'
         ) THEN
        EXECUTE 'ALTER TABLE ${NEW_SCHEMA}.vehicles RENAME TO vehicles_v1';
      END IF;
    END
    $$;
  `);

  pgm.createTable(
    { schema: NEW_SCHEMA, name: "vehicles" },
    {
      vin: { type: "text", primaryKey: true },
      customer_id: {
        type: "bigint",
        notNull: true,
        references: { schema: NEW_SCHEMA, name: "customers" },
        onDelete: "CASCADE",
      },
      year: { type: "integer" },
      make: { type: "text" },
      model: { type: "text" },
      trim: { type: "text" },
      color: { type: "text" },
      plate: { type: "text" },
      mileage: { type: "integer" },
      notes: { type: "text" },
      decoded_source: { type: "text" },
      decoded_at: { type: "timestamptz" },
      raw_decode: { type: "jsonb" },
      manual_overrides: { type: "jsonb" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    },
    { ifNotExists: true }
  );

  pgm.sql(`
    ALTER TABLE ${NEW_SCHEMA}.vehicles
    ADD COLUMN IF NOT EXISTS decoded_source text,
    ADD COLUMN IF NOT EXISTS decoded_at timestamptz,
    ADD COLUMN IF NOT EXISTS raw_decode jsonb,
    ADD COLUMN IF NOT EXISTS manual_overrides jsonb;
  `);

  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["customer_id"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["make"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["model"], { ifNotExists: true });

  pgm.sql(`
    DO $$
    DECLARE
      rec RECORD;
      normalized_vin TEXT;
      reason TEXT;
    BEGIN
      IF to_regclass('${NEW_SCHEMA}.vehicles_v1') IS NULL THEN
        RETURN;
      END IF;

      IF EXISTS (SELECT 1 FROM ${NEW_SCHEMA}.vehicles LIMIT 1) THEN
        RETURN;
      END IF;

      FOR rec IN
        SELECT * FROM ${NEW_SCHEMA}.vehicles_v1 ORDER BY created_at ASC, id ASC
      LOOP
        normalized_vin := NULLIF(UPPER(TRIM(rec.vin)), '');

        IF normalized_vin IS NULL THEN
          reason := 'missing_vin';
        ELSIF LENGTH(normalized_vin) <> 17 OR normalized_vin ~ '[IOQ]' THEN
          reason := 'invalid_vin_format';
        ELSIF EXISTS (SELECT 1 FROM ${NEW_SCHEMA}.vehicles WHERE vin = normalized_vin) THEN
          reason := 'duplicate_vin';
        ELSE
          reason := NULL;
        END IF;

        IF reason IS NULL THEN
          BEGIN
            INSERT INTO ${NEW_SCHEMA}.vehicles (
              vin,
              customer_id,
              year,
              make,
              model,
              trim,
              color,
              plate,
              mileage,
              notes,
              decoded_source,
              decoded_at,
              raw_decode,
              manual_overrides,
              created_at,
              updated_at
            )
            VALUES (
              normalized_vin,
              rec.customer_id,
              rec.year,
              rec.make,
              rec.model,
              rec.trim,
              rec.color,
              rec.plate,
              rec.mileage,
              rec.notes,
              NULL,
              NULL,
              NULL,
              CASE WHEN rec.legacy_vehicle_id IS NOT NULL THEN jsonb_build_object('legacy_vehicle_id', rec.legacy_vehicle_id) ELSE NULL END,
              COALESCE(rec.created_at, NOW()),
              COALESCE(rec.updated_at, NOW())
            )
            ON CONFLICT (vin) DO NOTHING;
          EXCEPTION WHEN OTHERS THEN
            reason := 'error_inserting';
          END;
        END IF;

        IF reason IS NOT NULL THEN
          INSERT INTO ${NEW_SCHEMA}.vehicles_legacy_no_vin (
            source_vehicle_id,
            customer_id,
            legacy_vehicle_id,
            year,
            make,
            model,
            trim,
            color,
            plate,
            vin,
            mileage,
            notes,
            reason,
            created_at,
            updated_at
          )
          VALUES (
            rec.id,
            rec.customer_id,
            rec.legacy_vehicle_id,
            rec.year,
            rec.make,
            rec.model,
            rec.trim,
            rec.color,
            rec.plate,
            rec.vin,
            rec.mileage,
            rec.notes,
            reason,
            COALESCE(rec.created_at, NOW()),
            COALESCE(rec.updated_at, NOW())
          )
          ON CONFLICT (source_vehicle_id, vin) DO NOTHING;
        END IF;
      END LOOP;
    END
    $$;
  `);
};

exports.down = async () => {};
