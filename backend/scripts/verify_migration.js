const { Pool } = require("pg");
const { findTableByHint, quoteIdent } = require("../db/legacy_discovery");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    const legacyCustomerTable = await findTableByHint(client, ["customers", "customer"], "public");
    const legacyVehicleTable = await findTableByHint(client, ["vehicles", "vehicle"], "public");

    const { rows: newCustomerRows } = await client.query(
      "SELECT COUNT(*)::int AS count FROM par.customers"
    );
    const { rows: newVehicleRows } = await client.query(
      "SELECT COUNT(*)::int AS count FROM par.vehicles"
    );

    const counts = {
      legacyCustomers: null,
      legacyVehicles: null,
      newCustomers: parseInt(newCustomerRows[0]?.count, 10) || 0,
      newVehicles: parseInt(newVehicleRows[0]?.count, 10) || 0,
    };

    if (legacyCustomerTable) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdent(legacyCustomerTable)}`
      );
      counts.legacyCustomers = parseInt(rows[0]?.count, 10) || 0;
    }

    if (legacyVehicleTable) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdent(legacyVehicleTable)}`
      );
      counts.legacyVehicles = parseInt(rows[0]?.count, 10) || 0;
    }

    console.log("Legacy customer count:", counts.legacyCustomers ?? "(no legacy table)");
    console.log("New customer count:", counts.newCustomers);
    console.log("Legacy vehicle count:", counts.legacyVehicles ?? "(no legacy table)");
    console.log("New vehicle count:", counts.newVehicles);

    const customerMismatch =
      counts.legacyCustomers !== null && counts.legacyCustomers !== counts.newCustomers;
    const vehicleMismatch =
      counts.legacyVehicles !== null && counts.legacyVehicles !== counts.newVehicles;

    if (customerMismatch || vehicleMismatch) {
      console.error(
        "Verification failed: record counts do not match. Migration should be investigated before continuing."
      );
      process.exitCode = 1;
    } else {
      console.log("Verification passed: counts are aligned.");
    }
  } catch (err) {
    console.error("Verification error:", err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
