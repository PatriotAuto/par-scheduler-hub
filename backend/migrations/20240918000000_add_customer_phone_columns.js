const SCHEMA = "par";
const TABLE = { schema: SCHEMA, name: "customers" };

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE ${SCHEMA}.customers
      ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
      ADD COLUMN IF NOT EXISTS phone_display TEXT,
      ADD COLUMN IF NOT EXISTS phone_raw TEXT;
  `);
};

exports.down = async () => {};
