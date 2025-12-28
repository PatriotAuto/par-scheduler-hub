const { spawn } = require("child_process");
const path = require("path");

async function runMigrations(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const migrateBin = require.resolve("node-pg-migrate/bin/node-pg-migrate");
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const args = [
    migrateBin,
    "up",
    "--dir",
    migrationsDir,
    "--database-url",
    databaseUrl,
    "--no-lock",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      const err = new Error(`node-pg-migrate exited with code ${code}`);
      console.error(err.message);
      reject(err);
    });
  });
}

module.exports = {
  runMigrations,
};
