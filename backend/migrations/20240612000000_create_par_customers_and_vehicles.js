const NEW_SCHEMA = "par";

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.createSchema(NEW_SCHEMA, { ifNotExists: true });

  pgm.createTable(
    { schema: NEW_SCHEMA, name: "customers" },
    {
      id: { type: "bigserial", primaryKey: true },
      legacy_customer_id: { type: "text" },
      first_name: { type: "text" },
      last_name: { type: "text" },
      business_name: { type: "text" },
      phone: { type: "text" },
      email: { type: "text" },
      address1: { type: "text" },
      address2: { type: "text" },
      city: { type: "text" },
      state: { type: "text" },
      zip: { type: "text" },
      notes: { type: "text" },
      is_dealer: { type: "boolean", notNull: true, default: false },
      dealer_level: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    },
    { ifNotExists: true }
  );

  pgm.createIndex({ schema: NEW_SCHEMA, name: "customers" }, ["last_name"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "customers" }, ["phone"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "customers" }, ["email"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "customers" }, ["is_dealer"], { ifNotExists: true });

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
      legacy_vehicle_id: { type: "text" },
      year: { type: "integer" },
      make: { type: "text" },
      model: { type: "text" },
      trim: { type: "text" },
      color: { type: "text" },
      plate: { type: "text" },
      mileage: { type: "integer" },
      notes: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    },
    { ifNotExists: true }
  );

  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["customer_id"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["vin"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["plate"], { ifNotExists: true });

  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('public.customers') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ${NEW_SCHEMA}.customers)
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'id'
         )
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'first_name'
         )
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'last_name'
         )
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'phone'
         )
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'email'
         ) THEN
        INSERT INTO ${NEW_SCHEMA}.customers (
          legacy_customer_id,
          first_name,
          last_name,
          business_name,
          phone,
          email,
          address1,
          address2,
          city,
          state,
          zip,
          notes,
          is_dealer,
          dealer_level,
          created_at,
          updated_at
        )
        SELECT
          c.id::text AS legacy_customer_id,
          c.first_name,
          c.last_name,
          c.business_name,
          c.phone,
          c.email,
          c.address1,
          c.address2,
          c.city,
          c.state,
          c.zip,
          c.notes,
          COALESCE(c.is_dealer, FALSE),
          c.dealer_level,
          COALESCE(c.created_at, NOW()),
          COALESCE(c.updated_at, NOW())
        FROM public.customers c
        WHERE NOT EXISTS (
          SELECT 1 FROM ${NEW_SCHEMA}.customers pc WHERE pc.legacy_customer_id = c.id::text
        );
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('public.vehicles') IS NOT NULL
         AND EXISTS (SELECT 1 FROM ${NEW_SCHEMA}.customers)
         AND NOT EXISTS (SELECT 1 FROM ${NEW_SCHEMA}.vehicles)
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'id'
         )
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'customer_id'
         )
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'vin'
         ) THEN
        INSERT INTO ${NEW_SCHEMA}.vehicles (
          vin,
          customer_id,
          legacy_vehicle_id,
          year,
          make,
          model,
          trim,
          color,
          plate,
          mileage,
          notes,
          created_at,
          updated_at
        )
        SELECT
          UPPER(TRIM(v.vin)) AS vin,
          pc.id AS customer_id,
          v.id::text AS legacy_vehicle_id,
          v.year,
          v.make,
          v.model,
          v.trim,
          v.color,
          v.plate,
          v.mileage,
          v.notes,
          COALESCE(v.created_at, NOW()),
          COALESCE(v.updated_at, NOW())
        FROM public.vehicles v
        JOIN ${NEW_SCHEMA}.customers pc ON pc.legacy_customer_id = v.customer_id::text
        WHERE v.vin IS NOT NULL
          AND LENGTH(TRIM(v.vin)) = 17
          AND UPPER(v.vin) !~ '[IOQ]'
          AND NOT EXISTS (
            SELECT 1 FROM ${NEW_SCHEMA}.vehicles nv WHERE nv.vin = UPPER(TRIM(v.vin))
          );
      END IF;
    END
    $$;
  `);
};

exports.down = async () => {};
