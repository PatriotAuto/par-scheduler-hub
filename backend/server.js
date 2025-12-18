const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

const allowedOrigins = [
  "https://parhub.patriotautorestyling.com",
  "http://parhub.patriotautorestyling.com",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser or same-origin requests without an Origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres often requires SSL in production
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("select now() as now");
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: String(e) });
  }
});

app.get("/__routes", (req, res) => {
  res.json({
    ok: true,
    authMounted: true,
    mounts: ["/auth/login", "/api/auth/login"],
  });
});

// Smoke test: both /auth/login and /api/auth/login hit the same handler
app.use("/auth", authRouter);
app.use("/api/auth", authRouter);

app.get("/", (req, res) => res.send("Patriot Backend is running"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));
