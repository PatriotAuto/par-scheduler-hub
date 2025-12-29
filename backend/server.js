const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const queryUtils = require("./db/query_utils");
const schemaCache = require("./db/schema_cache");
const { runMigrations } = require("./db/run_migrations");
const { normalizeUSPhone } = require("./utils/phone");

const app = express();
app.set("trust proxy", 1);

// --------------------
// CORS
// --------------------
const ALLOWED_ORIGINS = [
  "https://parhub.patriotautorestyling.com",
  "https://patriotautorestyling.com",
  "https://www.patriotautorestyling.com",
];

const corsMiddleware = cors({
  origin: (origin, cb) => {
    // Allow non-browser clients (curl, server-to-server) with no Origin header
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  credentials: true,
  maxAge: 86400,
});

app.use(corsMiddleware);

// Handle preflight for ALL routes
app.options("*", corsMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// --------------------
// DB
// --------------------
const DB_URL = process.env.DATABASE_URL || "";
const needsSSL = DB_URL && !DB_URL.includes(".railway.internal") && !DB_URL.includes("railway.internal");
const sslConfig = needsSSL ? { rejectUnauthorized: false } : false;
const pool = new Pool({
  connectionString: DB_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 8000
});
console.log("DB:", DB_URL ? "DATABASE_URL set" : "DATABASE_URL MISSING");
const DEALER_THRESHOLD = 10;
const VIN_CACHE_MAX_AGE_DAYS = 180;

// --------------------
// Helpers
// --------------------
function handleError(res, err, status = 500) {
  console.error(err);
  res.status(status).json({
    ok: false,
    error: "Internal server error",
    detail: err.message || String(err),
  });
}

function respondError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function pickFirst(source = {}, keys = []) {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

async function listQuery(res, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    return res.json(r.rows || []);
  } catch (e) {
    handleError(res, e);
  }
}

function truthy(value) {
  return typeof value === "string" && ["true", "1", "yes", "y", "on"].includes(value.toLowerCase());
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return truthy(value);
  return false;
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function preparePhoneForWrite(input) {
  if (input === undefined) {
    return { provided: false };
  }

  const raw = input === null ? null : String(input).trim();
  const normalized = normalizeUSPhone(raw);

  if (normalized.valid) {
    return {
      provided: true,
      valid: true,
      raw,
      e164: normalized.e164,
      display: normalized.display,
    };
  }

  return {
    provided: true,
    valid: false,
    raw,
    e164: null,
    display: raw || null,
  };
}

function derivePhoneDisplay(customer = {}) {
  const phoneDisplay = customer.phone_display && String(customer.phone_display).trim();
  if (phoneDisplay) {
    return phoneDisplay;
  }

  const e164 = customer.phone_e164 && String(customer.phone_e164).trim();
  if (e164) {
    return e164.replace(/^\+/, "");
  }

  const phoneRaw = customer.phone_raw && String(customer.phone_raw).trim();
  if (phoneRaw) {
    return phoneRaw;
  }

  return "";
}

function formatCustomerPhones(customer = {}) {
  const phone_raw = customer.phone_raw || customer.phone || null;
  const phone_e164 = customer.phone_e164 || null;

  return {
    ...customer,
    phone_raw,
    phone_e164,
    phone_display: derivePhoneDisplay({ ...customer, phone_raw, phone_e164 }),
  };
}

function normalizeVinInput(vin) {
  if (!vin) return null;
  return String(vin).trim().toUpperCase();
}

function isVinValid(vin) {
  if (!vin) return false;
  if (vin.length !== 17) return false;
  return !/[IOQ]/i.test(vin);
}

function validateVinOrRespond(res, vinInput) {
  const vin = normalizeVinInput(vinInput);
  if (!vin) {
    respondError(res, 400, "VIN_REQUIRED");
    return null;
  }
  if (!isVinValid(vin)) {
    respondError(res, 400, "INVALID_VIN");
    return null;
  }
  return vin;
}

function parseVinDecodeResult(resultJson) {
  const firstResult = Array.isArray(resultJson?.Results) ? resultJson.Results[0] : null;
  if (!firstResult) return {};

  const safeText = (value) => {
    if (!value && value !== 0) return null;
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
  };

  return {
    year: toIntOrNull(firstResult.ModelYear),
    make: safeText(firstResult.Make),
    model: safeText(firstResult.Model),
    trim: safeText(firstResult.Trim),
  };
}

function isCacheFresh(decodedAt) {
  if (!decodedAt) return false;
  const decodedDate = new Date(decodedAt);
  const ageMs = Date.now() - decodedDate.getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  return days <= VIN_CACHE_MAX_AGE_DAYS;
}

function orderClause(table, preferred, direction = "ASC") {
  return queryUtils.safeOrderBy(table, preferred, schemaCache.getSchema(), direction);
}

async function getCachedVinDecode(vin) {
  const { rows } = await pool.query(
    "SELECT vin, decoded_at, decoded_source, result_json FROM par.vin_decode_cache WHERE vin = $1",
    [vin]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    vin: row.vin,
    decodedAt: row.decoded_at,
    decoded_source: row.decoded_source,
    raw: row.result_json,
    parsed: parseVinDecodeResult(row.result_json),
  };
}

async function storeVinDecodeResult(vin, resultJson, source = "nhtsa_vpic") {
  const { rows } = await pool.query(
    `
    INSERT INTO par.vin_decode_cache (vin, decoded_at, decoded_source, result_json)
    VALUES ($1, NOW(), $2, $3)
    ON CONFLICT (vin)
    DO UPDATE SET decoded_at = NOW(), decoded_source = $2, result_json = $3
    RETURNING vin, decoded_at, decoded_source, result_json
  `,
    [vin, source, resultJson]
  );

  const row = rows[0];
  return {
    vin: row.vin,
    decodedAt: row.decoded_at,
    decoded_source: row.decoded_source,
    raw: row.result_json,
    parsed: parseVinDecodeResult(row.result_json),
  };
}

async function decodeVinWithCache(vin) {
  const cached = await getCachedVinDecode(vin);
  if (cached && isCacheFresh(cached.decodedAt)) {
    return { ...cached, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  let response;
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
    response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`NHTSA decode failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    const stored = await storeVinDecodeResult(vin, json, "nhtsa_vpic");
    return { ...stored, cached: false };
  } finally {
    clearTimeout(timeout);
  }
}

// --------------------
// Health + Debug
// --------------------
app.get("/health", async (req, res) => {
  res.json({ ok: true });
});

app.get("/debug/db", async (req, res) => {
  try {
    const ping = await pool.query("SELECT 1 as ok");
    const schema = schemaCache.getSchema();
    const tables = ["customers", "employees", "departments", "services", "appointments"];
    const counts = {};

    for (const table of tables) {
      if (schema[table] && schema[table].length) {
        const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
        counts[table] = result.rows?.[0]?.count ?? 0;
      }
    }

    res.json({ ok: true, db: ping.rows?.[0]?.ok === 1 || ping.rows?.[0]?.ok === "1", counts });
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/debug/cors", (req, res) => {
  res.json({ ok: true, origin: req.get("origin") || null });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());
app.get("/", (req, res) => res.json({ ok: true }));

// --------------------
// TEMP AUTH (same behavior you already have)
// --------------------
const authRouter = express.Router();

authRouter.get("/login", (req, res) => {
  res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      success: false,
      error: "MISSING_CREDENTIALS",
      message: "Email and password are required.",
    });
  }

  const token = Buffer.from(`${email}:${Date.now()}`).toString("base64");

  res.json({
    ok: true,
    success: true,
    token,
    user: { email },
  });
});

app.use("/auth", authRouter);
app.use("/api/auth", authRouter);

// --------------------
// Simple token guard (TEMP)
// --------------------
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const parts = h.split(" ");
  const queryToken = req.query.token;
  const bearerToken = (parts.length === 2 && parts[0] === "Bearer" && parts[1]) ? parts[1] : null;
  const token = bearerToken || queryToken;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.user = { token };
  next();
}

function requireAdminForWrite(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return next();

  const method = String(req.method || "").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const provided = req.header("x-admin-key");
    if (provided !== adminKey) {
      return res.status(403).json({ ok: false, error: "ADMIN_KEY_REQUIRED" });
    }
  }

  next();
}

// --------------------
// API V2 (migrated schema)
// --------------------
const apiV2 = express.Router();
apiV2.use(requireAuth);
apiV2.use(requireAdminForWrite);

apiV2.get("/vin/:vin/decode", async (req, res) => {
  const vin = validateVinOrRespond(res, req.params.vin);
  if (!vin) return;

  let cached = null;
  try {
    cached = await getCachedVinDecode(vin);
    if (cached && isCacheFresh(cached.decodedAt)) {
      return res.json({
        ok: true,
        data: {
          vin,
          decoded_at: cached.decodedAt,
          decoded_source: cached.decoded_source,
          parsed: cached.parsed,
          raw: cached.raw,
          cached: true,
        },
      });
    }
  } catch (err) {
    console.error("VIN cache lookup failed:", err);
  }

  try {
    const decoded = await decodeVinWithCache(vin);
    return res.json({
      ok: true,
      data: {
        vin,
        decoded_at: decoded.decodedAt,
        decoded_source: decoded.decoded_source,
        parsed: decoded.parsed,
        raw: decoded.raw,
        cached: decoded.cached || false,
      },
    });
  } catch (err) {
    console.error("VIN decode failed:", err);
    if (cached) {
      return res.json({
        ok: true,
        data: {
          vin,
          decoded_at: cached.decodedAt,
          decoded_source: cached.decoded_source,
          parsed: cached.parsed,
          raw: cached.raw,
          cached: true,
          stale: true,
        },
        warning: "VIN decode unavailable, using cached result.",
      });
    }
    return res.status(502).json({
      ok: false,
      error: "VIN_DECODE_FAILED",
      detail: err.message || "VIN decoder unavailable",
    });
  }
});

apiV2.get("/customers", async (req, res) => {
  try {
    const search = req.query.search || req.query.q || "";
    const dealerFilter = (req.query.dealer || "all").toString().toLowerCase();
    const whereParts = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      const placeholder = `$${params.length}`;
      whereParts.push(
        `(first_name ILIKE ${placeholder} OR last_name ILIKE ${placeholder} OR business_name ILIKE ${placeholder} OR phone ILIKE ${placeholder} OR email ILIKE ${placeholder})`
      );
    }

    if (dealerFilter === "true") {
      whereParts.push("is_dealer = TRUE");
    } else if (dealerFilter === "false") {
      whereParts.push("is_dealer = FALSE");
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const sql = `SELECT * FROM par.customers ${whereClause} ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, params);
    const formatted = rows.map(formatCustomerPhones);
    return res.json({ ok: true, data: formatted });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.get("/customers/:id/dealer-suggest", async (req, res) => {
  try {
    const id = req.params.id;
    const { rows: customerRows } = await pool.query(
      "SELECT id FROM par.customers WHERE id = $1",
      [id]
    );
    if (!customerRows.length) {
      return respondError(res, 404, "NOT_FOUND");
    }

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM par.vehicles WHERE customer_id = $1",
      [id]
    );
    const vehicleCount = parseInt(rows[0]?.count, 10) || 0;
    return res.json({
      ok: true,
      data: { suggested: vehicleCount >= DEALER_THRESHOLD, vehicleCount },
    });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.get("/customers/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { rows: customerRows } = await pool.query(
      "SELECT * FROM par.customers WHERE id = $1",
      [id]
    );
    if (!customerRows.length) {
      return respondError(res, 404, "NOT_FOUND");
    }

    const { rows: vehicles } = await pool.query(
      "SELECT * FROM par.vehicles WHERE customer_id = $1 ORDER BY created_at DESC",
      [id]
    );

    const customer = formatCustomerPhones(customerRows[0]);
    return res.json({ ok: true, data: { ...customer, vehicles } });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.get("/customers/:id/events", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return respondError(res, 400, "INVALID_ID");
    }

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit)) limit = 50;
    limit = Math.min(Math.max(limit, 1), 200);

    const { rows: events } = await pool.query(
      `
      SELECT
        ce.id,
        ce.legacy_event_id,
        ce.customer_id,
        ce.vehicle_vin,
        ce.event_date,
        ce.title,
        ce.description,
        ce.source,
        ce.created_at,
        v.year as vehicle_year,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.trim as vehicle_trim
      FROM par.customer_events ce
      LEFT JOIN par.vehicles v
        ON v.vin = ce.vehicle_vin
      WHERE ce.customer_id = $1
      ORDER BY ce.event_date DESC NULLS LAST, ce.created_at DESC
      LIMIT $2;
    `,
      [id, limit]
    );

    return res.json({ ok: true, data: { customer_id: id, limit, events } });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.post("/customers", async (req, res) => {
  try {
    const body = req.body || {};
    const firstName = pickFirst(body, ["first_name", "firstName"]) || null;
    const lastName = pickFirst(body, ["last_name", "lastName"]) || null;
    const businessName = pickFirst(body, ["business_name", "businessName", "company"]) || null;
    const phoneInput = pickFirst(body, ["phone", "phone_number", "phoneNumber"]);
    const phone = preparePhoneForWrite(phoneInput);
    const email = pickFirst(body, ["email", "email_address", "emailAddress"]) || null;
    const address1 = pickFirst(body, ["address1", "address_1", "street1"]) || null;
    const address2 = pickFirst(body, ["address2", "address_2", "street2"]) || null;
    const city = pickFirst(body, ["city"]) || null;
    const state = pickFirst(body, ["state", "region"]) || null;
    const zip = pickFirst(body, ["zip", "zipcode", "postalCode"]) || null;
    const notes = pickFirst(body, ["notes", "note"]) || null;
    const isDealer = toBoolean(pickFirst(body, ["is_dealer", "isDealer"]));
    const dealerLevel = pickFirst(body, ["dealer_level", "dealerLevel"]) || null;
    const legacyCustomerId = pickFirst(body, ["legacy_customer_id", "legacyCustomerId"]) || null;

    const { rows } = await pool.query(
      `
      INSERT INTO par.customers
        (legacy_customer_id, first_name, last_name, business_name, phone, phone_e164, phone_display, phone_raw, email, address1, address2, city, state, zip, notes, is_dealer, dealer_level)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *
    `,
      [
        legacyCustomerId,
        firstName,
        lastName,
        businessName,
        phone.valid ? phone.e164 : null,
        phone.valid ? phone.e164 : null,
        phone.display,
        phone.provided ? phone.raw : null,
        email,
        address1,
        address2,
        city,
        state,
        zip,
        notes,
        isDealer,
        dealerLevel,
      ]
    );

    return res.status(201).json({ ok: true, data: formatCustomerPhones(rows[0]) });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.patch("/customers/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const updates = [];
    const params = [];

    const addUpdate = (column, value) => {
      if (value !== undefined) {
        params.push(value);
        updates.push(`${column} = $${params.length}`);
      }
    };

    addUpdate("first_name", pickFirst(body, ["first_name", "firstName"]));
    addUpdate("last_name", pickFirst(body, ["last_name", "lastName"]));
    addUpdate("business_name", pickFirst(body, ["business_name", "businessName", "company"]));
    addUpdate("email", pickFirst(body, ["email", "email_address", "emailAddress"]));
    addUpdate("address1", pickFirst(body, ["address1", "address_1", "street1"]));
    addUpdate("address2", pickFirst(body, ["address2", "address_2", "street2"]));
    addUpdate("city", pickFirst(body, ["city"]));
    addUpdate("state", pickFirst(body, ["state", "region"]));
    addUpdate("zip", pickFirst(body, ["zip", "zipcode", "postalCode"]));
    addUpdate("notes", pickFirst(body, ["notes", "note"]));
    const isDealerInput = pickFirst(body, ["is_dealer", "isDealer"]);
    addUpdate("is_dealer", isDealerInput !== undefined ? toBoolean(isDealerInput) : undefined);
    addUpdate("dealer_level", pickFirst(body, ["dealer_level", "dealerLevel"]));
    addUpdate("legacy_customer_id", pickFirst(body, ["legacy_customer_id", "legacyCustomerId"]));

    const phoneInput = pickFirst(body, ["phone", "phone_number", "phoneNumber"]);
    const phone = preparePhoneForWrite(phoneInput);
    if (phone.provided) {
      addUpdate("phone_raw", phone.raw);
      if (phone.valid) {
        addUpdate("phone", phone.e164);
        addUpdate("phone_e164", phone.e164);
        addUpdate("phone_display", phone.display);
      } else if (phone.display !== undefined) {
        addUpdate("phone_display", phone.display);
      }
    }

    if (!updates.length) {
      return respondError(res, 400, "NO_FIELDS_PROVIDED");
    }

    updates.push(`updated_at = NOW()`);
    const sql = `UPDATE par.customers SET ${updates.join(", ")} WHERE id = $${params.length + 1} RETURNING *`;
    params.push(id);

    const result = await pool.query(sql, params);
    if (!result.rowCount) {
      return respondError(res, 404, "NOT_FOUND");
    }

    return res.json({ ok: true, data: formatCustomerPhones(result.rows[0]) });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.post("/customers/:id/vehicles", async (req, res) => {
  try {
    const customerId = req.params.id;
    const body = req.body || {};

    const { rowCount: customerExists } = await pool.query(
      "SELECT 1 FROM par.customers WHERE id = $1",
      [customerId]
    );
    if (!customerExists) {
      return respondError(res, 404, "CUSTOMER_NOT_FOUND");
    }

    const vin = validateVinOrRespond(res, pickFirst(body, ["vin"]));
    if (!vin) return;

    const manualYear = toIntOrNull(pickFirst(body, ["year"]));
    const manualMake = pickFirst(body, ["make"]);
    const manualModel = pickFirst(body, ["model"]);
    const manualTrim = pickFirst(body, ["trim"]);
    const manualOverrides = {};
    if (manualYear !== null && manualYear !== undefined) manualOverrides.year = manualYear;
    if (manualMake !== undefined) manualOverrides.make = manualMake;
    if (manualModel !== undefined) manualOverrides.model = manualModel;
    if (manualTrim !== undefined) manualOverrides.trim = manualTrim;

    let decodeData = null;
    let cachedDecode = null;
    try {
      cachedDecode = await getCachedVinDecode(vin);
    } catch (err) {
      console.warn("VIN cache lookup failed during create:", err.message || err);
    }

    try {
      decodeData = await decodeVinWithCache(vin);
    } catch (err) {
      console.warn("VIN decode unavailable for create:", err.message || err);
      decodeData = cachedDecode || null;
    }

    const decodedFields = decodeData?.parsed || {};

    const finalYear = manualYear ?? decodedFields.year ?? null;
    const finalMake = manualMake ?? decodedFields.make ?? null;
    const finalModel = manualModel ?? decodedFields.model ?? null;
    const finalTrim = manualTrim ?? decodedFields.trim ?? null;

    const rawDecode = decodeData?.raw || null;
    const decodedSource = decodeData?.decoded_source || null;
    const decodedAt = decodeData?.decodedAt || null;
    const manualOverridesValue =
      Object.keys(manualOverrides).length > 0 ? manualOverrides : null;

    try {
      const insertResult = await pool.query(
        `
        INSERT INTO par.vehicles
          (vin, customer_id, year, make, model, trim, color, plate, mileage, notes, decoded_source, decoded_at, raw_decode, manual_overrides)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *
      `,
        [
          vin,
          customerId,
          finalYear,
          finalMake,
          finalModel,
          finalTrim,
          pickFirst(body, ["color"]),
          pickFirst(body, ["plate", "licensePlate"]),
          toIntOrNull(pickFirst(body, ["mileage"])),
          pickFirst(body, ["notes", "note"]),
          decodedSource,
          decodedAt,
          rawDecode,
          manualOverridesValue,
        ]
      );

      return res.status(201).json({
        ok: true,
        data: insertResult.rows[0],
        decode_used: Boolean(decodeData),
      });
    } catch (err) {
      if (err.code === "23505") {
        return respondError(res, 409, "VIN_ALREADY_EXISTS");
      }
      throw err;
    }
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.patch("/vehicles/:vin", async (req, res) => {
  try {
    const vin = validateVinOrRespond(res, req.params.vin);
    if (!vin) return;
    const body = req.body || {};
    const updates = [];
    const params = [];
    const manualUpdates = {};

    const newVinInput = pickFirst(body, ["vin"]);
    if (newVinInput && normalizeVinInput(newVinInput) !== vin) {
      return respondError(res, 400, "VIN_IMMUTABLE");
    }

    const { rows: existingRows } = await pool.query(
      "SELECT manual_overrides FROM par.vehicles WHERE vin = $1",
      [vin]
    );
    if (!existingRows.length) {
      return respondError(res, 404, "NOT_FOUND");
    }
    const existingManual = existingRows[0]?.manual_overrides || {};

    const addUpdate = (column, value) => {
      if (value !== undefined) {
        params.push(value);
        updates.push(`${column} = $${params.length}`);
      }
    };

    const updatedYear = toIntOrNull(pickFirst(body, ["year"]));
    const updatedMake = pickFirst(body, ["make"]);
    const updatedModel = pickFirst(body, ["model"]);
    const updatedTrim = pickFirst(body, ["trim"]);

    if (updatedYear !== undefined) manualUpdates.year = updatedYear;
    if (updatedMake !== undefined) manualUpdates.make = updatedMake;
    if (updatedModel !== undefined) manualUpdates.model = updatedModel;
    if (updatedTrim !== undefined) manualUpdates.trim = updatedTrim;

    addUpdate("year", updatedYear);
    addUpdate("make", updatedMake);
    addUpdate("model", updatedModel);
    addUpdate("trim", updatedTrim);
    addUpdate("color", pickFirst(body, ["color"]));
    addUpdate("plate", pickFirst(body, ["plate", "licensePlate"]));
    addUpdate("mileage", toIntOrNull(pickFirst(body, ["mileage"])));
    addUpdate("notes", pickFirst(body, ["notes", "note"]));

    if (Object.keys(manualUpdates).length) {
      const mergedManual = { ...existingManual, ...manualUpdates };
      addUpdate("manual_overrides", mergedManual);
    }

    if (!updates.length) {
      return respondError(res, 400, "NO_FIELDS_PROVIDED");
    }

    updates.push(`updated_at = NOW()`);
    const sql = `UPDATE par.vehicles SET ${updates.join(", ")} WHERE vin = $${params.length + 1} RETURNING *`;
    params.push(vin);

    const result = await pool.query(sql, params);
    if (!result.rowCount) {
      return respondError(res, 404, "NOT_FOUND");
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.delete("/vehicles/:vin", async (req, res) => {
  try {
    const vin = validateVinOrRespond(res, req.params.vin);
    if (!vin) return;

    const result = await pool.query("DELETE FROM par.vehicles WHERE vin = $1 RETURNING vin", [vin]);

    if (!result.rowCount) {
      return respondError(res, 404, "NOT_FOUND");
    }

    return res.json({ ok: true, data: { vin } });
  } catch (err) {
    handleError(res, err);
  }
});

app.use("/api/v2", apiV2);

// --------------------
// API ROUTER
// --------------------
const api = express.Router();
api.use(requireAuth);

api.get("/customers", async (req, res) => {
  const schema = schemaCache.getSchema();
  const search = req.query.search || req.query.q;
  let whereClause = "";
  let params = [];
  const columns = queryUtils.getTableColumns(schema, "customers");

  const phoneColumn = Array.from(columns).find((col) => {
    const normalized = typeof col === "string" ? col.toLowerCase() : col;
    return ["phone", "phonenumber", "phone_number", "mobile", "cell", "primaryphone", "primary_phone"].includes(normalized);
  });
  const selectClause = phoneColumn
    ? `SELECT *, "${String(phoneColumn).replace(/"/g, '""')}"::text AS phone FROM customers`
    : queryUtils.safeSelectAll("customers");

  if (search) {
    const { clause, params: searchParams } = queryUtils.safeSearchWhere(
      "customers",
      ["name", "firstname", "lastname", "phone", "email", "vehiclemake", "vehiclemodel", "vehicle_year", "vehicleyear", "lastvehiclemake", "lastvehiclemodel", "lastvehicleyear"],
      search,
      1,
      schema
    );
    if (clause) {
      whereClause = ` WHERE ${clause}`;
      params = searchParams;
    }
  }

  const sql = `${selectClause}${whereClause}${orderClause(
    "customers",
    ["created_at", "createdat", "created", "id"],
    "DESC"
  )}`;
  try {
    const { rows } = await pool.query(sql, params);
    const formatted = rows.map(formatCustomerPhones);
    return res.json(formatted);
  } catch (err) {
    handleError(res, err);
  }
});

api.get("/employees", async (req, res) => {
  const schema = schemaCache.getSchema();
  const search = req.query.search || req.query.q;
  const technicianFilter = req.query.isTechnician || req.query.technician || req.query.tech;
  const columns = queryUtils.getTableColumns(schema, "employees");

  const whereParts = [];
  let params = [];
  let nextIndex = 1;

  if (search) {
    const { clause, params: searchParams, nextIndex: updatedIndex } = queryUtils.safeSearchWhere(
      "employees",
      ["firstname", "lastname", "employeeid", "role"],
      search,
      nextIndex,
      schema
    );
    if (clause) {
      whereParts.push(clause);
      params = params.concat(searchParams);
      nextIndex = updatedIndex;
    }
  }

  if (truthy(String(technicianFilter || "")) && columns.has("istechnician")) {
    whereParts.push("LOWER(istechnician) IN ('true','1','yes','y','on')");
  }

  const whereClause = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
  const sql = `${queryUtils.safeSelectAll("employees")}${whereClause}${orderClause(
    "employees",
    ["lastname", "last_name", "firstname", "first_name", "id"]
  )}`;
  await listQuery(res, sql, params);
});

api.get("/services", async (req, res) => {
  const sql = `${queryUtils.safeSelectAll("services")}${orderClause("services", ["name", "servicename", "id"])}`;
  await listQuery(res, sql);
});

api.get("/departments", async (req, res) => {
  const sql = `${queryUtils.safeSelectAll("departments")}${orderClause("departments", ["name", "departmentname", "id"])}`;
  await listQuery(res, sql);
});

api.get("/appointments", async (req, res) => {
  const sql = `${queryUtils.safeSelectAll("appointments")}${orderClause(
    "appointments",
    ["start", "starttime", "start_time", "date", "time", "id"]
  )}`;
  await listQuery(res, sql);
});

api.get("/employee_schedule", async (req, res) => {
  const employeeId = req.query.employee_id || req.query.employeeId;
  const schema = schemaCache.getSchema();
  const columns = queryUtils.getTableColumns(schema, "employee_schedule");
  const params = [];
  let whereClause = "";

  if (employeeId && columns.has("employeeid")) {
    params.push(employeeId);
    whereClause = ` WHERE employeeid = $${params.length}`;
  } else if (employeeId && columns.has("employee_id")) {
    params.push(employeeId);
    whereClause = ` WHERE employee_id = $${params.length}`;
  }

  const sql = `${queryUtils.safeSelectAll("employee_schedule")}${whereClause}${orderClause(
    "employee_schedule",
    ["employeeid", "dayofweek", "id"]
  )}`;
  await listQuery(res, sql, params);
});

api.get("/tech_time_off", async (req, res) => {
  const sql = `${queryUtils.safeSelectAll("tech_time_off")}${orderClause("tech_time_off", ["startdate", "start_date", "id"])}`;
  await listQuery(res, sql);
});

api.get("/holidays", async (req, res) => {
  const sql = `${queryUtils.safeSelectAll("holidays")}${orderClause("holidays", ["date", "name", "id"])}`;
  await listQuery(res, sql);
});

api.get("/leads", async (req, res) => {
  const schema = schemaCache.getSchema();
  const columns = queryUtils.getTableColumns(schema, "leads");
  const status = req.query.status;

  const params = [];
  let whereClause = "";

  if (status && columns.has("status")) {
    params.push(status);
    whereClause = ` WHERE LOWER(status) = LOWER($${params.length})`;
  }

  const sql = `${queryUtils.safeSelectAll("leads")}${whereClause}${orderClause(
    "leads",
    ["created_at", "createdat", "created", "updatedat", "id"],
    "DESC"
  )}`;
  await listQuery(res, sql, params);
});

api.post("/leads", async (req, res) => {
  try {
    const lead = req.body || {};
    const values = [
      lead.contactName || lead.contactname || "",
      lead.phone || "",
      lead.email || "",
      lead.source || "",
      lead.status || "",
      lead.vehicleYear || lead.vehicleyear || "",
      lead.vehicleMake || lead.vehiclemake || "",
      lead.vehicleModel || lead.vehiclemodel || "",
      lead.serviceInterest || lead.serviceinterest || "",
      lead.budget || "",
      lead.notes || ""
    ];
    const insertSql = `
      INSERT INTO leads (contactname, phone, email, source, status, vehicleyear, vehiclemake, vehiclemodel, serviceinterest, budget, notes, createdat, updatedat)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
      RETURNING *`;
    const result = await pool.query(insertSql, values);
    res.status(201).json(result.rows || []);
  } catch (e) {
    handleError(res, e);
  }
});

api.put("/leads/:id", async (req, res) => {
  try {
    const lead = req.body || {};
    const id = req.params.id;
    const values = [
      lead.contactName || lead.contactname || "",
      lead.phone || "",
      lead.email || "",
      lead.source || "",
      lead.status || "",
      lead.vehicleYear || lead.vehicleyear || "",
      lead.vehicleMake || lead.vehiclemake || "",
      lead.vehicleModel || lead.vehiclemodel || "",
      lead.serviceInterest || lead.serviceinterest || "",
      lead.budget || "",
      lead.notes || "",
      id
    ];
    const updateSql = `
      UPDATE leads
         SET contactname=$1,
             phone=$2,
             email=$3,
             source=$4,
             status=$5,
             vehicleyear=$6,
             vehiclemake=$7,
             vehiclemodel=$8,
             serviceinterest=$9,
             budget=$10,
             notes=$11,
             updatedat=now()
       WHERE id=$12
       RETURNING *`;
    const result = await pool.query(updateSql, values);
    res.json(result.rows || []);
  } catch (e) {
    handleError(res, e);
  }
});

api.delete("/leads/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM leads WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    handleError(res, e);
  }
});

api.get("/users", async (req, res) => {
  const schema = schemaCache.getSchema();
  const search = req.query.search || req.query.q;
  let whereClause = "";
  let params = [];

  if (search) {
    const { clause, params: searchParams } = queryUtils.safeSearchWhere(
      "users",
      ["email", "name", "role"],
      search,
      1,
      schema
    );
    if (clause) {
      whereClause = ` WHERE ${clause}`;
      params = searchParams;
    }
  }

  const sql = `${queryUtils.safeSelectAll("users")}${whereClause}${orderClause(
    "users",
    ["created_at", "createdat", "name", "id"],
    "DESC"
  )}`;
  await listQuery(res, sql, params);
});

// route sanity check
app.get("/__routes", (req, res) => {
  res.json({
    ok: true,
    mounts: [
      "/health",
      "/debug/db",
      "/auth/login",
      "/api/auth/login",
      "/customers (auth)",
      "/employees (auth)",
      "/services (auth)",
      "/departments (auth)",
      "/appointments (auth)",
      "/employee_schedule (auth)",
      "/tech_time_off (auth)",
      "/holidays (auth)",
      "/leads (auth)",
      "/users (auth)",
      "/api/customers (auth)",
      "/api/employees (auth)",
      "/api/services (auth)",
      "/api/departments (auth)",
      "/api/appointments (auth)",
      "/api/employee_schedule (auth)",
      "/api/tech_time_off (auth)",
      "/api/holidays (auth)",
      "/api/leads (auth)",
      "/api/users (auth)",
      "/api/v2/customers (auth)",
      "/api/v2/customers/:id (auth)",
      "/api/v2/customers/:id/events (auth)",
      "/api/v2/customers/:id/vehicles (auth)",
      "/api/v2/customers/:id/dealer-suggest (auth)",
      "/api/v2/vehicles/:vin (auth)",
      "/api/v2/vin/:vin/decode (auth)",
    ],
  });
});

app.use("/", api);
app.use("/api", api);

async function startServer() {
  try {
    await runMigrations(DB_URL);
    console.log("Migrations complete.");
  } catch (err) {
    console.error("Failed to run migrations:", err);
    process.exit(1);
  }

  try {
    await schemaCache.loadSchemaCache(pool);
    console.log("Schema cache loaded.");
  } catch (err) {
    console.error("Failed to load schema cache:", err);
  }

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("Listening on", port));
}

startServer();
