const SCHEMA = "par";
const CUSTOMERS = { schema: SCHEMA, name: "customers" };
const VEHICLES = { schema: SCHEMA, name: "vehicles" };
const CUSTOMER_EVENTS = { schema: SCHEMA, name: "customer_events" };
const VIN_DECODE_CACHE = { schema: SCHEMA, name: "vin_decode_cache" };

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE ${SCHEMA}.customers
      ADD COLUMN IF NOT EXISTS legacy_client_id TEXT,
      ADD COLUMN IF NOT EXISTS legacy_lead_id TEXT,
      ADD COLUMN IF NOT EXISTS lead_created_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS date_added TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS company TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT,
      ADD COLUMN IF NOT EXISTS unsubscribed_email BOOLEAN,
      ADD COLUMN IF NOT EXISTS primary_user_assigned TEXT,
      ADD COLUMN IF NOT EXISTS last_appointment TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_service TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS tags TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS pnl TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE;
  `);

  pgm.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS customers_legacy_client_id_idx ON ${SCHEMA}.customers(legacy_client_id)`
  );

  pgm.sql(`
    ALTER TABLE ${SCHEMA}.vehicles
      ADD COLUMN IF NOT EXISTS odometer INTEGER,
      ADD COLUMN IF NOT EXISTS plate_number TEXT,
      ADD COLUMN IF NOT EXISTS vehicle_notes TEXT;
  `);

  pgm.createIndex(VEHICLES, ["customer_id"], { ifNotExists: true });
  pgm.createIndex(VEHICLES, ["make"], { ifNotExists: true });
  pgm.createIndex(VEHICLES, ["model"], { ifNotExists: true });

  pgm.createTable(
    CUSTOMER_EVENTS,
    {
      id: { type: "bigserial", primaryKey: true },
      legacy_event_id: { type: "text", unique: true },
      customer_id: { type: "bigint", references: CUSTOMERS, onDelete: "CASCADE" },
      vehicle_vin: { type: "text", references: VEHICLES, onDelete: "SET NULL" },
      event_date: { type: "timestamptz" },
      title: { type: "text" },
      description: { type: "text" },
      source: { type: "text", notNull: true, default: "calendar_import" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    },
    { ifNotExists: true }
  );

  pgm.createIndex(CUSTOMER_EVENTS, ["customer_id"], { ifNotExists: true });
  pgm.createIndex(CUSTOMER_EVENTS, ["vehicle_vin"], { ifNotExists: true });
  pgm.createIndex(CUSTOMER_EVENTS, ["event_date"], { ifNotExists: true });

  pgm.createTable(
    VIN_DECODE_CACHE,
    {
      vin: { type: "text", primaryKey: true },
      decoded_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      decoded_source: { type: "text", notNull: true, default: "nhtsa_vpic" },
      result_json: { type: "jsonb", notNull: true },
    },
    { ifNotExists: true }
  );
};

exports.down = async () => {};
