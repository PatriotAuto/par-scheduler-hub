const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const authRouter = express.Router();

authRouter.post("/login", async (req, res) => {
  res.status(501).json({ success: false, message: "Login handler not implemented" });
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

// Smoke test: both /auth/login and /api/auth/login hit the same handler
app.use("/auth", authRouter);
app.use("/api/auth", authRouter);

app.get("/", (req, res) => res.send("Patriot Backend is running"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));
