const {
  buildRowAccessor,
  fetchColumns,
  findColumn,
  findTableByHint,
  quoteIdent,
} = require("../db/legacy_discovery");

const NEW_SCHEMA = "par";
const DEALER_THRESHOLD = 10;

function splitName(fullName = "") {
  if (!fullName) return { first: null, last: null };
  const parts = String(fullName).trim().split(/\s+/);
  if (!parts.length) return { first: null, last: null };
  const first = parts.shift() || null;
  const last = parts.length ? parts.join(" ") : null;
  return { first, last };
}

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
      id: { type: "bigserial", primaryKey: true },
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
      vin: { type: "text" },
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

  const client = await pgm.db.connect();

  try {
    const legacyCustomerTable = await findTableByHint(client, ["customers", "customer"], "public");
    const legacyVehicleTable = await findTableByHint(client, ["vehicles", "vehicle"], "public");

    const vehicleColumns = legacyVehicleTable ? await fetchColumns(client, legacyVehicleTable) : [];

    const legacyVehicleCustomerColumn = vehicleColumns.length
      ? findColumn(vehicleColumns, ["customer_id", "customerid", "customer", "customer_id_fk", "owner_id"])
      : null;

    if (legacyVehicleTable && !legacyVehicleCustomerColumn) {
      console.warn(
        `[migration] Detected ${legacyVehicleTable} but could not find a customer reference column; vehicle copy skipped.`
      );
    }

    const vehicleCountByCustomer = new Map();
    let legacyVehicleRows = [];
    if (legacyVehicleTable && legacyVehicleCustomerColumn) {
      const { rows } = await client.query(`SELECT * FROM ${quoteIdent(legacyVehicleTable)}`);
      legacyVehicleRows = rows;
      for (const row of rows) {
        const accessor = buildRowAccessor(row);
        const legacyCustomerId = accessor([legacyVehicleCustomerColumn]);
        if (legacyCustomerId !== undefined && legacyCustomerId !== null && legacyCustomerId !== "") {
          const key = String(legacyCustomerId);
          vehicleCountByCustomer.set(key, (vehicleCountByCustomer.get(key) || 0) + 1);
        }
      }
    }

    if (!legacyCustomerTable) {
      console.warn("[migration] No legacy customer table detected; par schema created without copied data.");
      return;
    }

    const legacyCustomerRows = (await client.query(`SELECT * FROM ${quoteIdent(legacyCustomerTable)}`)).rows;
    const customerIdMap = new Map();

    const idCandidates = ["id", "customerid", "customer_id", "legacy_customer_id", "externalclientid"];
    const firstCandidates = ["first_name", "firstname", "first"];
    const lastCandidates = ["last_name", "lastname", "last"];
    const fullNameCandidates = ["name", "fullname", "customername", "customer_name"];
    const businessCandidates = ["business_name", "business", "company", "company_name"];
    const phoneCandidates = [
      "phone",
      "phone_number",
      "phonenumber",
      "mobile",
      "cell",
      "primary_phone",
      "primaryphone",
    ];
    const emailCandidates = ["email", "email_address", "emailaddress"];
    const address1Candidates = ["address1", "address_1", "street", "street1", "line1", "address"];
    const address2Candidates = ["address2", "address_2", "street2", "line2", "suite", "apt", "apartment"];
    const cityCandidates = ["city", "town"];
    const stateCandidates = ["state", "state_province", "province", "region"];
    const zipCandidates = ["zip", "zipcode", "postal", "postal_code", "postalcode", "zip_code"];
    const notesCandidates = ["notes", "note", "comments", "comment"];
    const dealerLevelCandidates = ["dealer_level", "tier", "level"];
    const createdAtCandidates = ["created_at", "createdat", "created", "created_on", "created_date"];
    const updatedAtCandidates = ["updated_at", "updatedat", "updated", "updated_on", "modified_at"];

    const insertCustomerSql = `
      INSERT INTO ${NEW_SCHEMA}.customers
        (legacy_customer_id, first_name, last_name, business_name, phone, email, address1, address2, city, state, zip, notes, is_dealer, dealer_level, created_at, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, COALESCE($15, NOW()), COALESCE($16, NOW()))
      RETURNING id, legacy_customer_id
    `;

    for (const row of legacyCustomerRows) {
      const accessor = buildRowAccessor(row);
      const legacyId = accessor(idCandidates);
      const legacyKey =
        legacyId !== undefined && legacyId !== null && legacyId !== "" ? String(legacyId) : null;

      const fullName = accessor(fullNameCandidates);
      const split = splitName(fullName);
      const firstName = accessor(firstCandidates) || split.first || null;
      const lastName = accessor(lastCandidates) || split.last || null;
      const businessName = accessor(businessCandidates) || null;
      const phone = accessor(phoneCandidates) || null;
      const email = accessor(emailCandidates) || null;
      const address1 = accessor(address1Candidates) || null;
      const address2 = accessor(address2Candidates) || null;
      const city = accessor(cityCandidates) || null;
      const state = accessor(stateCandidates) || null;
      const zip = accessor(zipCandidates) || null;
      const notes = accessor(notesCandidates) || null;
      const dealerLevel = accessor(dealerLevelCandidates) || null;
      const createdAt = accessor(createdAtCandidates) || null;
      const updatedAt = accessor(updatedAtCandidates) || null;
      const vehicleCount =
        legacyKey && vehicleCountByCustomer.get(legacyKey) ? vehicleCountByCustomer.get(legacyKey) : 0;
      const isDealer = Boolean(businessName) || vehicleCount >= DEALER_THRESHOLD;

      const result = await client.query(insertCustomerSql, [
        legacyKey,
        firstName,
        lastName,
        businessName,
        phone,
        email,
        address1,
        address2,
        city,
        state,
        zip,
        notes,
        isDealer,
        dealerLevel,
        createdAt,
        updatedAt,
      ]);

      if (legacyKey) {
        customerIdMap.set(legacyKey, result.rows[0].id);
      }
    }

    if (legacyVehicleTable && legacyVehicleRows.length && legacyVehicleCustomerColumn) {
      const vehicleIdCandidates = ["id", "vehicleid", "vehicle_id", "legacy_vehicle_id"];
      const yearCandidates = ["year", "vehicleyear", "vehicle_year"];
      const makeCandidates = ["make", "vehiclemake", "vehicle_make"];
      const modelCandidates = ["model", "vehiclemodel", "vehicle_model"];
      const trimCandidates = ["trim"];
      const colorCandidates = ["color", "paint"];
      const plateCandidates = ["plate", "license_plate", "licenseplate"];
      const vinCandidates = ["vin", "vinnumber", "vehicle_vin"];
      const mileageCandidates = ["mileage", "miles", "odometer"];
      const vehicleNotesCandidates = ["notes", "note", "comments", "comment"];
      const vehicleCreatedCandidates = ["created_at", "createdat", "created", "created_on", "created_date"];
      const vehicleUpdatedCandidates = ["updated_at", "updatedat", "updated", "updated_on", "modified_at"];

      const insertVehicleSql = `
        INSERT INTO ${NEW_SCHEMA}.vehicles
          (customer_id, legacy_vehicle_id, year, make, model, trim, color, plate, vin, mileage, notes, created_at, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, NOW()), COALESCE($13, NOW()))
      `;

      for (const row of legacyVehicleRows) {
        const accessor = buildRowAccessor(row);
        const legacyCustomerId = accessor([legacyVehicleCustomerColumn]);
        const legacyCustomerKey =
          legacyCustomerId !== undefined && legacyCustomerId !== null && legacyCustomerId !== ""
            ? String(legacyCustomerId)
            : null;
        const customerId = legacyCustomerKey ? customerIdMap.get(legacyCustomerKey) : null;
        if (!customerId) continue;

        const legacyVehicleId = accessor(vehicleIdCandidates) || null;
        const year = accessor(yearCandidates) || null;
        const make = accessor(makeCandidates) || null;
        const model = accessor(modelCandidates) || null;
        const trim = accessor(trimCandidates) || null;
        const color = accessor(colorCandidates) || null;
        const plate = accessor(plateCandidates) || null;
        const vin = accessor(vinCandidates) || null;
        const mileage = accessor(mileageCandidates) || null;
        const vehicleNotes = accessor(vehicleNotesCandidates) || null;
        const createdAt = accessor(vehicleCreatedCandidates) || null;
        const updatedAt = accessor(vehicleUpdatedCandidates) || null;

        await client.query(insertVehicleSql, [
          customerId,
          legacyVehicleId,
          year,
          make,
          model,
          trim,
          color,
          plate,
          vin,
          mileage,
          vehicleNotes,
          createdAt,
          updatedAt,
        ]);
      }
    }

    const { rows: legacyCustomerCountRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdent(legacyCustomerTable)}`
    );
    const legacyCustomerCount = parseInt(legacyCustomerCountRows[0]?.count, 10) || 0;
    const { rows: newCustomerCountRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${NEW_SCHEMA}.customers`
    );
    const newCustomerCount = parseInt(newCustomerCountRows[0]?.count, 10) || 0;

    if (legacyCustomerCount !== newCustomerCount) {
      throw new Error(
        `Customer migration verification failed: legacy=${legacyCustomerCount}, new=${newCustomerCount}`
      );
    }

    if (legacyVehicleTable && legacyVehicleCustomerColumn) {
      const { rows: legacyVehicleCountRows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdent(legacyVehicleTable)}`
      );
      const legacyVehicleCount = parseInt(legacyVehicleCountRows[0]?.count, 10) || 0;
      const { rows: newVehicleCountRows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${NEW_SCHEMA}.vehicles`
      );
      const newVehicleCount = parseInt(newVehicleCountRows[0]?.count, 10) || 0;

      if (legacyVehicleCount !== newVehicleCount) {
        throw new Error(
          `Vehicle migration verification failed: legacy=${legacyVehicleCount}, new=${newVehicleCount}`
        );
      }
    }
  } finally {
    client.release();
  }
};

exports.down = async (pgm) => {
  pgm.dropTable({ schema: NEW_SCHEMA, name: "vehicles" }, { ifExists: true });
  pgm.dropTable({ schema: NEW_SCHEMA, name: "customers" }, { ifExists: true });
  pgm.dropSchema(NEW_SCHEMA, { ifExists: true });
};
