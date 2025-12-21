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
      nameCell.textContent = `${cust.firstName || ""} ${cust.lastName || ""}`.trim();

      const phoneCell = document.createElement("td");
      phoneCell.textContent = cust.phone || "";

      const emailCell = document.createElement("td");
      emailCell.textContent = cust.email || "";

      const lastServiceCell = document.createElement("td");
      const lastServiceDate = cust.lastServiceDate || "";
      const lastServiceType = cust.lastServiceType || "";
      if (lastServiceDate || lastServiceType) {
        lastServiceCell.textContent = [lastServiceDate, lastServiceType]
          .filter(Boolean)
          .join(" – ");
      } else {
        lastServiceCell.textContent = "";
      }

      const vehicleCell = document.createElement("td");
      const parts = [
        cust.lastVehicleYear,
        cust.lastVehicleMake,
        cust.lastVehicleModel,
      ].filter(Boolean);
      vehicleCell.textContent = parts.join(" ");

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
      const name = normalizeText(
        `${cust.firstName || ""} ${cust.lastName || ""}`
      );
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

      const customers = normalizeList(payload, ["customers"]);
      if (!Array.isArray(customers) || !customers.length) {
        console.warn(
          "Normalized empty list for customers:",
          payload && typeof payload === "object" ? Object.keys(payload) : payload
        );
      }

      state.customers = customers;
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
