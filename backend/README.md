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
  - `npm run db:cleanup:phone_raw` – clear placeholder/invalid `phone_raw` entries before normalization.
  - `npm run db:fix:phones` – normalize customer phone fields (safe, does not drop/truncate).
  - `npm run db:schema` – print the current database schema.
  - `npm run db:schema:json` – output schema as JSON.
 - On Railway, run a one-off `npm run migrate` (or rely on app start) to apply migrations safely.

### Phone number cleanup (one-time)
- Deploy the changes, then run the one-off cleanup on Railway or locally:
  ```bash
  npm run db:cleanup:phone_raw
  npm run db:fix:phones
  ```
- The cleanup script removes placeholder text (e.g., `null`, `n/a`, `-`, `.`) and numbers that are either too short (<10 digits)
  or unrecognizably long (11+ digits not starting with 1).
- The script normalizes parseable phone numbers into `phone_e164`, `phone_display`, and the legacy `phone` column while preserving the original value in `phone_raw`.

## OrbisX XLSX import (customers, vehicles, calendar history)

- Schema changes (via migrations) add OrbisX mapping columns on `par.customers` (e.g., `legacy_client_id` UNIQUE, `legacy_lead_id`, `lead_created_at`, `date_added`, `company`, `country`, `tags`, `source`, `pnl`, `primary_user_assigned`, `last_appointment`, `last_service`, `unsubscribed_email`, `phone_raw`, `phone_e164`, `phone_display`, `is_dealer`), extend `par.vehicles` (`odometer`, `plate_number`, `vehicle_notes` alongside the existing VIN PK), and create `par.customer_events` for calendar history plus `par.vin_decode_cache` for future decoding.
- The importer scripts **do not expect XLSX files inside the repo or container**; pass an absolute/relative path to the local XLSX file and a `DATABASE_URL` that can reach Railway.
- Local usage:
  ```bash
  DATABASE_URL=postgres://... npm run db:import:orbisx -- "/local/path/Patriot Auto Restyling Clients Dec 28th 2025.xlsx"
  DATABASE_URL=postgres://... npm run db:import:calendar -- "/local/path/Patriot Auto Restyling Calendar Events Jan 1st 2025 to Dec 31st 2025.xlsx"
  ```
- Railway one-off commands (requires the XLSX uploaded to the app container path you reference):
  ```bash
  npm run db:import:orbisx -- "/app/Patriot Auto Restyling Clients Dec 28th 2025.xlsx"
  npm run db:import:calendar -- "/app/Patriot Auto Restyling Calendar Events Jan 1st 2025 to Dec 31st 2025.xlsx"
  ```
- High-level behavior:
  - Customers are upserted by `legacy_client_id` (no deletes/truncates) and the legacy phone column stays in place; canonical phones are written only when valid after robust normalization of numeric/scientific cells.
  - Vehicles are upserted by VIN (17 chars only); missing VIN rows are skipped but counted in the summary.
  - Calendar events insert into `par.customer_events` with deterministic `legacy_event_id` hashes when none are provided, linking first by VIN, then by phone, then by exact name when unambiguous.
  - Dealer flag is set when a customer has ≥10 vehicles or a company name.
- Example summary output:
  ```bash
  Import complete.
  {
    customers_processed: 120,
    customers_skipped_missing_id: 2,
    vehicles_upserted: 110,
    vehicles_skipped_missing_vin: 12,
    phones_valid: 118,
    phones_invalid: 4
  }
  ```

### Admin access for write operations
- When `ADMIN_API_KEY` is set, POST/PATCH/DELETE requests to `/api/v2` require the `x-admin-key` header to match. In local/dev (no key set), writes remain open.
- New read/write endpoints live under `/api/v2/customers` and `/api/v2/vehicles`; responses are shaped as `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`.
