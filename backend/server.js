const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const queryUtils = require("./db/query_utils");
const schemaCache = require("./db/schema_cache");

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
      allowedHeaders: ["Content-Type", "Authorization"],
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

// --------------------
// Helpers
// --------------------
function handleError(res, err, status = 500) {
  console.error(err);
  res.status(status).json({ error: "Internal server error", detail: err.message || String(err) });
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

  const sql = `${queryUtils.safeSelectAll("customers")}${whereClause}${orderClause(
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
    ],
  });
});

app.use("/", api);
app.use("/api", api);

async function startServer() {
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
