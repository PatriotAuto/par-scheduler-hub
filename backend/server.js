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

// --------------------
// Health
// --------------------
app.get("/health", async (req, res) => {
  try {
    if (!DB_URL) return res.status(500).json({ ok: false, db: false, error: "DATABASE_URL_MISSING" });
    const r = await pool.query("select now() as now");
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: String(e) });
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
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  // We are NOT validating token server-side yet (temporary)
  req.user = { token: parts[1] };
  next();
}

// --------------------
// API ROUTER
// --------------------
const api = express.Router();
api.use(requireAuth);

// NOTE: we’ll mount this router at BOTH / and /api to reduce frontend breakage.

api.get("/customers", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM customers ORDER BY created_at DESC NULLS LAST`);
    res.json({ ok: true, customers: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

api.get("/employees", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM employees ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST`);
    res.json({ ok: true, employees: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

api.get("/services", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM services ORDER BY name ASC NULLS LAST`);
    res.json({ ok: true, services: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

api.get("/departments", async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM departments ORDER BY name ASC NULLS LAST`);
    res.json({ ok: true, departments: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
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
