Patriot Scheduler Backend

## Seeding Postgres from CSV (Railway compatible)

1. Ensure the `DATABASE_URL` environment variable is set (Railway provides this automatically).
2. Place/update CSV files under `backend/data/` (e.g., `Employees.csv`, `Appointments.csv`, etc.).
3. Run the seeder:
   ```bash
   npm run seed
   ```
   This will create any missing tables, truncate existing data, and insert the CSV rows (preserving `id` values when present).
4. On Railway, trigger a one-off command with the same script (`npm run seed`) to load data into the attached Postgres instance.

## Database migrations (customers/vehicles v2)

- Migrations use [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate) and run automatically before the server starts. If a migration fails, the server will exit instead of booting with a partial schema.
- New tables live in the `par` schema (`par.customers`, `par.vehicles`) and legacy tables are left untouched. Customer and vehicle rows are copied, not moved or deleted.
- Scripts:
  - `npm run migrate` – run migrations up (uses `DATABASE_URL`).
  - `npm run migrate:down` – roll back the last migration.
  - `npm run db:verify` – print legacy vs. new customer/vehicle counts and exit non-zero on mismatch.
- On Railway, run a one-off `npm run migrate` (or rely on app start) to apply migrations safely.

### Admin access for write operations
- When `ADMIN_API_KEY` is set, POST/PATCH/DELETE requests to `/api/v2` require the `x-admin-key` header to match. In local/dev (no key set), writes remain open.
- New read/write endpoints live under `/api/v2/customers` and `/api/v2/vehicles`; responses are shaped as `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`.
