const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.API_TOKEN || "test-token";
const SMOKE_CUSTOMER_ID = process.env.SMOKE_CUSTOMER_ID || 1;
const SMOKE_CUSTOMER_LEGACY_ID = process.env.SMOKE_CUSTOMER_LEGACY_ID;

const endpoints = [
  "/health",
  "/customers",
  "/employees",
  "/customers?search=test",
  "/employees?search=test",
  "/services",
  "/departments",
  "/appointments",
  "/employee_schedule",
  "/tech_time_off",
  "/holidays",
  "/leads",
  "/users",
  "/debug/db",
];

async function checkCustomerEvents() {
  const path = `/api/v2/customers/${SMOKE_CUSTOMER_ID}/events?limit=2`;
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => ({}));
  const ok = res.status === 200 && data && Array.isArray(data.data?.events || data.events);

  if (!ok) {
    console.error(`${res.status} ${url} -> unexpected response`);
  } else {
    console.log(`${res.status} ${url} (${(data.data?.events || data.events || []).length} events)`);
  }

  return ok;
}

async function checkLegacyCustomerRoutes() {
  if (!SMOKE_CUSTOMER_LEGACY_ID) {
    console.log("Skipping legacy customer checks (SMOKE_CUSTOMER_LEGACY_ID not set)");
    return true;
  }

  const basePath = `/api/v2/customers/${SMOKE_CUSTOMER_LEGACY_ID}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  const endpoints = [
    basePath,
    `${basePath}/events?limit=1`,
  ];

  const results = await Promise.all(
    endpoints.map(async (path) => {
      const res = await fetch(`${BASE_URL}${path}`, { headers });
      const ok = res.status === 200;
      if (!ok) {
        const snippet = (await res.text()).slice(0, 120).replace(/\s+/g, " ").trim();
        console.error(`${res.status} ${path} -> ${snippet}`);
      } else {
        console.log(`${res.status} ${path}`);
      }
      return ok;
    })
  );

  return results.every(Boolean);
}

async function checkEndpoint(path) {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { "Content-Type": "application/json" };
  if (!path.startsWith("/health") && !path.startsWith("/debug")) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const res = await fetch(url, { headers });
  const text = await res.text();

  const ok = res.status < 400 || res.status === 404;
  if (!ok) {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
    console.error(`${res.status} ${url} -> ${snippet}`);
  } else {
    console.log(`${res.status} ${url}`);
  }

  return ok;
}

async function main() {
  const results = await Promise.all([
    ...endpoints.map(checkEndpoint),
    checkCustomerEvents(),
    checkLegacyCustomerRoutes(),
  ]);
  if (results.includes(false)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Smoke test failed to run:", err.message || err);
  process.exitCode = 1;
});
