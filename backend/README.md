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
