// customers.js
// Clean customers page logic using apiGet() from auth.js
// No top-level await, everything wrapped in async init function.

(function () {
  // Simple in-memory state
  const state = {
    customers: [],
    filtered: [],
  };
  let vehicleDropdownsReady = null;

  // --- DOM Helpers ---

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    const el = $("customersStatus");
    if (!el) return;
    el.textContent = message || "";
  }

  function setError(message) {
    const el = $("customersError");
    if (!el) return;
    el.textContent = message || "";
  }

  function setLoading(isLoading) {
    const el = $("customersStatus");
    if (!el) return;
    el.textContent = isLoading ? "Loading customers..." : "";
  }

  function normalizeText(value) {
    return (value || "").toString().trim().toLowerCase();
  }

  function normalizeCustomer(c) {
    if (!c || typeof c !== "object") return null;

    const pick = (...keys) => {
      for (const k of keys) {
        const v = c[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return "";
    };

    const asString = (v) =>
      v === undefined || v === null ? "" : String(v).trim();

    const first = asString(
      pick(
        "firstname",
        "first_name",
        "firstName",
        "first",
        "FirstName",
        "First Name"
      )
    );
    const last = asString(
      pick(
        "lastname",
        "last_name",
        "lastName",
        "last",
        "LastName",
        "Last Name"
      )
    );
    const fullName =
      asString(pick("name", "fullname", "full_name", "fullName")) ||
      `${first} ${last}`.trim();

    const phoneRaw = asString(
      pick(
        "phone",
        "phonenumber",
        "phone_number",
        "phoneNumber",
        "mobile",
        "cell",
        "primaryphone",
        "primary_phone"
      )
    );
    const email = asString(
      pick("email", "emailaddress", "email_address", "emailAddress")
    );

    const year = asString(
      pick("vehicleyear", "vehicle_year", "year", "lastVehicleYear")
    );
    const make = asString(
      pick("vehiclemake", "vehicle_make", "make", "lastVehicleMake")
    );
    const model = asString(
      pick("vehiclemodel", "vehicle_model", "model", "lastVehicleModel")
    );
    const trim = asString(
      pick("vehicletrim", "vehicle_trim", "trim", "lastVehicleTrim")
    );
    const vehicle = [year, make, model, trim].filter(Boolean).join(" ");

    const lastServiceValue = asString(
      pick("lastservice", "last_service", "lastService")
    );
    const lastServiceDate = asString(
      pick("lastservicedate", "last_service_date", "lastServiceDate")
    );
    const lastServiceType = asString(
      pick("lastservicetype", "last_service_type", "lastServiceType")
    );
    const lastService =
      lastServiceValue ||
      [lastServiceDate, lastServiceType].filter(Boolean).join(" – ");

    const id = asString(pick("id", "customerid", "customer_id", "customerId", "ID"));

    const digits = phoneRaw.replace(/\D/g, "");
    let phone = phoneRaw;
    if (digits.length === 10) {
      phone = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.length === 11 && digits.startsWith("1")) {
      phone = `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
    }

    const displayName = fullName || email || "(No name)";

    return { id, name: displayName, phone, email, lastService, vehicle, raw: c };
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- Rendering ---

  function renderCustomers() {
    const tbody = $("customersTableBody");
    if (!tbody) {
      console.warn("customers.js: #customersTableBody not found in DOM.");
      return;
    }

    const list = state.filtered.length ? state.filtered : state.customers;

    // Clear existing rows
    tbody.innerHTML = "";

    if (!list.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No customers found.";
      td.style.textAlign = "center";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    list.forEach((cust) => {
      const tr = document.createElement("tr");

      const nameCell = document.createElement("td");
      nameCell.className = "col-name";
      nameCell.innerHTML = escapeHtml(cust.name);

      const phoneCell = document.createElement("td");
      phoneCell.className = "col-phone";
      phoneCell.innerHTML = escapeHtml(cust.phone);

      const emailCell = document.createElement("td");
      emailCell.className = "col-email";
      emailCell.innerHTML = escapeHtml(cust.email);

      const lastServiceCell = document.createElement("td");
      lastServiceCell.className = "col-lastservice";
      lastServiceCell.innerHTML = escapeHtml(cust.lastService);

      const vehicleCell = document.createElement("td");
      vehicleCell.className = "col-vehicle";
      vehicleCell.innerHTML = escapeHtml(cust.vehicle);

      tr.appendChild(nameCell);
      tr.appendChild(phoneCell);
      tr.appendChild(emailCell);
      tr.appendChild(lastServiceCell);
      tr.appendChild(vehicleCell);

      tbody.appendChild(tr);
    });
  }

  // --- Filtering ---

  function applyFilter() {
    const input = $("customerSearchInput");
    if (!input) {
      state.filtered = [];
      renderCustomers();
      return;
    }

    const q = normalizeText(input.value);
    if (!q) {
      state.filtered = [];
      renderCustomers();
      return;
    }

    state.filtered = state.customers.filter((cust) => {
      const name = normalizeText(cust.name);
      const phone = normalizeText(cust.phone);
      const email = normalizeText(cust.email);

      return (
        (name && name.indexOf(q) !== -1) ||
        (phone && phone.indexOf(q) !== -1) ||
        (email && email.indexOf(q) !== -1)
      );
    });

    renderCustomers();
  }

  function wireEvents() {
    const searchInput = $("customerSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        applyFilter();
      });
    }
  }

  // --- API ---

  async function fetchCustomers() {
    setLoading(true);
    setError("");

    try {
      const url = `${API_BASE_URL}/customers`;
      const payload = await fetchJsonDebug(url);
      console.log("Customers raw response:", payload);

      const rawList = normalizeList(payload, ["customers"]) || [];
      const list = Array.isArray(rawList) ? rawList : [];
      const customers = list.map(normalizeCustomer).filter(Boolean);
      window.__customers = customers;
      if (!Array.isArray(customers) || !customers.length) {
        console.warn(
          "Normalized empty list for customers:",
          payload && typeof payload === "object" ? Object.keys(payload) : payload
        );
      }

      state.customers = customers;
      console.log("Normalized customer sample:", customers[0]);
      console.log(
        "Raw keys sample:",
        customers[0]?.raw ? Object.keys(customers[0].raw) : []
      );
      state.filtered = [];
      renderCustomers();
      setStatus(`${state.customers.length} customer(s) loaded.`);
    } catch (err) {
      console.error("Failed to load customers:", err);
      setError("Failed to load customers. Please try again.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  // --- Init ---

  async function initCustomersPage() {
    try {
      if (typeof ensureLoggedIn === "function" && !ensureLoggedIn()) {
        return;
      }
      // Require login using auth.js helper if present
      if (typeof getStoredUser === "function") {
        const user = getStoredUser();
        if (!user) {
          // Not logged in – send to login page
          window.location.href = "login.html";
          return;
        }
      }

      vehicleDropdownsReady = window.initVehicleDropdowns && window.initVehicleDropdowns();
      wireEvents();
      await fetchCustomers();
    } catch (err) {
      console.error("Error initializing customers page:", err);
      setError("Something went wrong initializing the Customers page.");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initCustomersPage();
  });
})();
