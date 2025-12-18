const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

// --------------------
// CORS
// --------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://parhub.patriotautorestyling.com")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, cb) {
    // allow non-browser tools (curl/postman) that send no Origin
    if (!origin) return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);

    // helpful for logs
    return cb(new Error("CORS_NOT_ALLOWED: " + origin), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

// IMPORTANT: put these BEFORE routes
app.use((req, res, next) => {
  res.setHeader("Vary", "Origin");
  next();
});
app.use(cors(corsOptions));

// Explicitly handle preflight for everything
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --------------------
// DB
// --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// --------------------
// Health
// --------------------
app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("select now() as now");
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: String(e) });
  }
});

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

app.options("/auth/*", cors(corsOptions));
app.options("/api/auth/*", cors(corsOptions));
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
