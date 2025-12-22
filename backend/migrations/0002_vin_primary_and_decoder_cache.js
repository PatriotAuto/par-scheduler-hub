const NEW_SCHEMA = "par";

function normalizeVin(vin) {
  if (!vin) return null;
  return String(vin).trim().toUpperCase();
}

function isVinValid(vin) {
  if (!vin) return false;
  if (vin.length !== 17) return false;
  return !/[IOQ]/i.test(vin);
}

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // Create cache + legacy tables first so we can preserve data during migrations
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

  // Keep the original vehicles table around for reference
  pgm.renameTable({ schema: NEW_SCHEMA, name: "vehicles" }, { schema: NEW_SCHEMA, name: "vehicles_v1" });

  // Rebuild vehicles with VIN as the primary key
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

  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["customer_id"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["make"], { ifNotExists: true });
  pgm.createIndex({ schema: NEW_SCHEMA, name: "vehicles" }, ["model"], { ifNotExists: true });

  // Data migration: move rows with valid VINs into the new table; stash the rest
  const client = await pgm.db.connect();
  try {
    const { rows: legacyVehicles } = await client.query(
      `SELECT * FROM ${NEW_SCHEMA}.vehicles_v1 ORDER BY created_at ASC, id ASC`
    );
    const seenVins = new Set();
    let migratedCount = 0;
    let skippedCount = 0;

    for (const row of legacyVehicles) {
      const normalizedVin = normalizeVin(row.vin);
      const vinValid = normalizedVin && isVinValid(normalizedVin);
      const isDuplicate = normalizedVin && seenVins.has(normalizedVin);
      const reason = !normalizedVin
        ? "missing_vin"
        : !vinValid
        ? "invalid_vin_format"
        : isDuplicate
        ? "duplicate_vin"
        : null;

      if (reason) {
        await client.query(
          `
          INSERT INTO ${NEW_SCHEMA}.vehicles_legacy_no_vin
            (source_vehicle_id, customer_id, legacy_vehicle_id, year, make, model, trim, color, plate, vin, mileage, notes, reason, created_at, updated_at)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE($14, NOW()), COALESCE($15, NOW()))
        `,
          [
            row.id || null,
            row.customer_id || null,
            row.legacy_vehicle_id || null,
            row.year || null,
            row.make || null,
            row.model || null,
            row.trim || null,
            row.color || null,
            row.plate || null,
            row.vin || null,
            row.mileage || null,
            row.notes || null,
            reason,
            row.created_at || null,
            row.updated_at || null,
          ]
        );
        skippedCount += 1;
        continue;
      }

      seenVins.add(normalizedVin);
      const manualOverrides =
        row.legacy_vehicle_id !== undefined && row.legacy_vehicle_id !== null
          ? { legacy_vehicle_id: row.legacy_vehicle_id }
          : null;

      await client.query(
        `
        INSERT INTO ${NEW_SCHEMA}.vehicles
          (vin, customer_id, year, make, model, trim, color, plate, mileage, notes, manual_overrides, created_at, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, NOW()), COALESCE($13, NOW()))
      `,
        [
          normalizedVin,
          row.customer_id,
          row.year || null,
          row.make || null,
          row.model || null,
          row.trim || null,
          row.color || null,
          row.plate || null,
          row.mileage || null,
          row.notes || null,
          manualOverrides,
          row.created_at || null,
          row.updated_at || null,
        ]
      );
      migratedCount += 1;
    }

    const totalLegacy = legacyVehicles.length;
    if (totalLegacy !== migratedCount + skippedCount) {
      throw new Error(
        `Vehicle migration verification failed: total=${totalLegacy}, migrated=${migratedCount}, skipped=${skippedCount}`
      );
    }
  } finally {
    client.release();
  }
};

exports.down = async (pgm) => {
  // Drop new structures
  pgm.dropTable({ schema: NEW_SCHEMA, name: "vehicles" }, { ifExists: true });
  pgm.dropTable({ schema: NEW_SCHEMA, name: "vin_decode_cache" }, { ifExists: true });
  pgm.dropTable({ schema: NEW_SCHEMA, name: "vehicles_legacy_no_vin" }, { ifExists: true });

  // Restore original table name
  pgm.renameTable({ schema: NEW_SCHEMA, name: "vehicles_v1" }, { schema: NEW_SCHEMA, name: "vehicles" });
};
