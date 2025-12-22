const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const queryUtils = require("./db/query_utils");
const schemaCache = require("./db/schema_cache");
const { runMigrations } = require("./db/run_migrations");

const app = express();

// --------------------
// CORS
// --------------------
const allowedOrigins = new Set([
  "https://parhub.patriotautorestyling.com",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const corsOptionsDelegate = (req, callback) => {
  const origin = req.header("Origin");
  if (!origin || allowedOrigins.has(origin)) {
    callback(null, {
      origin: origin || true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
      optionsSuccessStatus: 204,
      maxAge: 86400
    });
  } else {
    callback(null, { origin: false });
  }
};

app.use(cors(corsOptionsDelegate));
app.options("*", cors(corsOptionsDelegate));
app.use(express.json());
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

function orderClause(table, preferred, direction = "ASC") {
  return queryUtils.safeOrderBy(table, preferred, schemaCache.getSchema(), direction);
}

// --------------------
// Health + Debug
// --------------------
app.get("/health", async (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
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

app.options("/auth/*", cors(corsOptionsDelegate));
app.options("/api/auth/*", cors(corsOptionsDelegate));
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
    return res.json({ ok: true, data: rows });
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

    return res.json({ ok: true, data: { ...customerRows[0], vehicles } });
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
    const phone = pickFirst(body, ["phone", "phone_number", "phoneNumber"]) || null;
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
        (legacy_customer_id, first_name, last_name, business_name, phone, email, address1, address2, city, state, zip, notes, is_dealer, dealer_level)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `,
      [
        legacyCustomerId,
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
      ]
    );

    return res.status(201).json({ ok: true, data: rows[0] });
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
    addUpdate("phone", pickFirst(body, ["phone", "phone_number", "phoneNumber"]));
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

    return res.json({ ok: true, data: result.rows[0] });
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

    const insertResult = await pool.query(
      `
      INSERT INTO par.vehicles
        (customer_id, legacy_vehicle_id, year, make, model, trim, color, plate, vin, mileage, notes)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,
      [
        customerId,
        pickFirst(body, ["legacy_vehicle_id", "legacyVehicleId"]),
        toIntOrNull(pickFirst(body, ["year"])),
        pickFirst(body, ["make"]),
        pickFirst(body, ["model"]),
        pickFirst(body, ["trim"]),
        pickFirst(body, ["color"]),
        pickFirst(body, ["plate", "licensePlate"]),
        pickFirst(body, ["vin"]),
        toIntOrNull(pickFirst(body, ["mileage"])),
        pickFirst(body, ["notes", "note"]),
      ]
    );

    return res.status(201).json({ ok: true, data: insertResult.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.patch("/vehicles/:vehicleId", async (req, res) => {
  try {
    const vehicleId = req.params.vehicleId;
    const body = req.body || {};
    const updates = [];
    const params = [];

    const addUpdate = (column, value) => {
      if (value !== undefined) {
        params.push(value);
        updates.push(`${column} = $${params.length}`);
      }
    };

    addUpdate("year", toIntOrNull(pickFirst(body, ["year"])));
    addUpdate("make", pickFirst(body, ["make"]));
    addUpdate("model", pickFirst(body, ["model"]));
    addUpdate("trim", pickFirst(body, ["trim"]));
    addUpdate("color", pickFirst(body, ["color"]));
    addUpdate("plate", pickFirst(body, ["plate", "licensePlate"]));
    addUpdate("vin", pickFirst(body, ["vin"]));
    addUpdate("mileage", toIntOrNull(pickFirst(body, ["mileage"])));
    addUpdate("notes", pickFirst(body, ["notes", "note"]));

    if (!updates.length) {
      return respondError(res, 400, "NO_FIELDS_PROVIDED");
    }

    updates.push(`updated_at = NOW()`);
    const sql = `UPDATE par.vehicles SET ${updates.join(", ")} WHERE id = $${params.length + 1} RETURNING *`;
    params.push(vehicleId);

    const result = await pool.query(sql, params);
    if (!result.rowCount) {
      return respondError(res, 404, "NOT_FOUND");
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

apiV2.delete("/vehicles/:vehicleId", async (req, res) => {
  try {
    const vehicleId = req.params.vehicleId;
    const result = await pool.query("DELETE FROM par.vehicles WHERE id = $1 RETURNING id", [vehicleId]);

    if (!result.rowCount) {
      return respondError(res, 404, "NOT_FOUND");
    }

    return res.json({ ok: true, data: { id: vehicleId } });
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
  await listQuery(res, sql, params);
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
      "/api/v2/customers/:id/vehicles (auth)",
      "/api/v2/customers/:id/dealer-suggest (auth)",
      "/api/v2/vehicles/:vehicleId (auth)",
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
