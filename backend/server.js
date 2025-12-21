const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

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
  // allow non-browser requests (no Origin) and allowlisted browser origins
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

// IMPORTANT: put these BEFORE routes
app.use(cors(corsOptionsDelegate));
// Explicitly handle preflight for everything
app.options("*", cors(corsOptionsDelegate));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --------------------
// DB
// --------------------
const DB_URL = process.env.DATABASE_URL || process.env.DATABASE_URL || "";
const needsSSL = DB_URL && !DB_URL.includes(".railway.internal") && !DB_URL.includes("railway.internal");
const sslConfig = needsSSL ? { rejectUnauthorized: false } : false;
const pool = new Pool({
  connectionString: DB_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 8000
});
console.log("DB:", DB_URL ? "DATABASE_URL set" : "DATABASE_URL MISSING");

// --------------------
// Health
// --------------------
app.get("/health", async (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
app.get("/debug/db", async (req, res) => {
  try {
    const r = await pool.query("SELECT now() as now, (select count(*)::int from customers) as customers");
    res.json(r.rows || []);
  } catch (e) {
    console.error("GET /debug/db failed:", e);
    res.status(500).json({ error: "Internal server error", detail: e.message });
  }
});
app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/", (req, res) => res.send("Patriot Backend is running"));

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

  // Temporary token generation until real auth is wired up
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
// Expects: Authorization: Bearer <token>
// Token is whatever /auth/login returned.
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
  // We are NOT validating token server-side yet (temporary)
  req.user = { token };
  next();
}

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

// --------------------
// API ROUTER
// --------------------
const api = express.Router();
api.use(requireAuth);

// NOTE: we’ll mount this router at BOTH / and /api to reduce frontend breakage.

api.get("/customers", async (req, res) => {
  await listQuery(res, `SELECT * FROM customers ORDER BY created_at DESC NULLS LAST`);
});

api.get("/employees", async (req, res) => {
  await listQuery(res, `SELECT * FROM employees ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST`);
});

api.get("/services", async (req, res) => {
  await listQuery(res, `SELECT * FROM services`);
});

api.get("/departments", async (req, res) => {
  await listQuery(res, `SELECT * FROM departments ORDER BY name ASC NULLS LAST`);
});

api.get("/appointments", async (req, res) => {
  await listQuery(res, `SELECT * FROM appointments ORDER BY date ASC NULLS LAST, time ASC NULLS LAST`);
});

api.get("/employee_schedule", async (req, res) => {
  const employeeId = req.query.employee_id || req.query.employeeId;
  const sql = employeeId
    ? `SELECT * FROM employee_schedule WHERE employeeid = $1 OR employee_id = $1 ORDER BY dayofweek ASC NULLS LAST`
    : `SELECT * FROM employee_schedule ORDER BY employeeid ASC NULLS LAST, dayofweek ASC NULLS LAST`;
  await listQuery(res, sql, employeeId ? [employeeId] : []);
});

api.get("/tech_time_off", async (req, res) => {
  await listQuery(res, `SELECT * FROM tech_time_off ORDER BY startdate ASC NULLS LAST`);
});

api.get("/holidays", async (req, res) => {
  await listQuery(res, `SELECT * FROM holidays ORDER BY date ASC NULLS LAST`);
});

api.get("/leads", async (req, res) => {
  const status = req.query.status;
  if (status) {
    await listQuery(res, `SELECT * FROM leads WHERE LOWER(status) = LOWER($1) ORDER BY createdat DESC NULLS LAST`, [status]);
  } else {
    await listQuery(res, `SELECT * FROM leads ORDER BY createdat DESC NULLS LAST`);
  }
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

// route sanity check
app.get("/__routes", (req, res) => {
  res.json({
    ok: true,
    mounts: [
      "/health",
      "/auth/login",
      "/api/auth/login",
      "/customers (auth)",
      "/employees (auth)",
      "/services (auth)",
      "/departments (auth)",
      "/api/customers (auth)",
      "/api/employees (auth)",
      "/api/services (auth)",
      "/api/departments (auth)",
    ],
  });
});

// Mount API at BOTH root and /api so frontend can use either style:
app.use("/", api);
app.use("/api", api);

// --------------------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));
