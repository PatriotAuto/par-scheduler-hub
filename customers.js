// customers.js
// Clean customers page logic using apiGet() from auth.js
// No top-level await, everything wrapped in async init function.

(function () {
  // Simple in-memory state
  const state = {
    customers: [],
    filtered: [],
    activeAlpha: "All",
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

  function normalizePhone(value) {
    if (value === undefined || value === null) return "";

    let s = String(value).trim();
    if (!s) return "";

    if (/e\+?/i.test(s)) {
      const n = Number(s);
      if (!Number.isNaN(n)) {
        s = n.toFixed(0);
      }
    }

    const digits = s.replace(/\D/g, "");

    if (digits.length === 11 && digits.startsWith("1")) {
      return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
    }
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }

    return digits || s;
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

    const phoneRaw = pick(
      "phone",
      "phonenumber",
      "phone_number",
      "phoneNumber",
      "mobile",
      "cell",
      "primaryphone",
      "primary_phone"
    );
    const phone = normalizePhone(phoneRaw);
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

    const address = asString(
      pick(
        "address",
        "address1",
        "address_1",
        "street",
        "street1",
        "line1",
        "Address"
      )
    );

    const notes = asString(pick("notes", "note", "customerNotes", "customer_notes", "Notes"));

    const displayName = fullName || email || "(No name)";

    return {
      id,
      name: displayName,
      firstName: first,
      lastName: last,
      phone,
      email,
      lastService,
      vehicle,
      address,
      notes,
      raw: c,
    };
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

  function getLastNameInitial(c) {
    const ln = (c.lastName || "").trim();
    const fallback = (c.name || "").trim();
    const source = ln || fallback;
    if (!source) return "#";
    const ch = source[0].toUpperCase();
    return ch >= "A" && ch <= "Z" ? ch : "#";
  }

  function renderCustomers(list) {
    const tbody = $("customersTableBody");
    if (!tbody) {
      console.warn("customers.js: #customersTableBody not found in DOM.");
      return;
    }

    const rows = Array.isArray(list)
      ? list
      : state.filtered.length
      ? state.filtered
      : state.customers;

    // Clear existing rows
    tbody.innerHTML = "";

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No customers found.";
      td.style.textAlign = "center";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((cust) => {
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

      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => openProfile(cust));

      tbody.appendChild(tr);
    });
  }

  // --- Filtering ---

  function getAlphaFilteredList() {
    const all = window.__customersAll || [];
    if (state.activeAlpha && state.activeAlpha !== "All") {
      return all.filter((cust) => getLastNameInitial(cust) === state.activeAlpha);
    }
    return all;
  }

  function applySearchFilter() {
    const input = $("customerSearchInput");
    const baseList = getAlphaFilteredList();
    if (!input) {
      state.filtered = baseList;
      window.__customersFiltered = baseList;
      renderCustomers(baseList);
      return;
    }

    const q = normalizeText(input.value);
    if (!q) {
      state.filtered = baseList;
      window.__customersFiltered = baseList;
      renderCustomers(baseList);
      return;
    }

    const filtered = baseList.filter((cust) => {
      const name = normalizeText(cust.name);
      const phone = normalizeText(cust.phone);
      const email = normalizeText(cust.email);

      return (
        (name && name.indexOf(q) !== -1) ||
        (phone && phone.indexOf(q) !== -1) ||
        (email && email.indexOf(q) !== -1)
      );
    });

    state.filtered = filtered;
    window.__customersFiltered = filtered;
    renderCustomers(filtered);
  }

  function wireEvents() {
    const searchInput = $("customerSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        applySearchFilter();
      });
    }
  }

  function buildAlphaBar(customers) {
    const el = document.getElementById("alphaBar");
    if (!el) return;

    const counts = { "#": 0 };
    for (let i = 65; i <= 90; i++) counts[String.fromCharCode(i)] = 0;

    customers.forEach((c) => counts[getLastNameInitial(c)]++);

    const tabs = ["All", ...Object.keys(counts).filter((k) => k !== "#"), "#"];
    el.innerHTML = "";

    tabs.forEach((letter) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alpha-btn";
      btn.dataset.letter = letter;

      const count = letter === "All" ? customers.length : counts[letter] || 0;

      btn.textContent = letter;
      const span = document.createElement("span");
      span.className = "alpha-count";
      span.textContent = `(${count})`;
      btn.appendChild(span);

      btn.addEventListener("click", () => {
        setActiveAlpha(letter);
        applyAlphaFilter(letter);
      });

      el.appendChild(btn);
    });

    setActiveAlpha("All");
  }

  function setActiveAlpha(letter) {
    document.querySelectorAll(".alpha-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.letter === letter);
    });
    state.activeAlpha = letter || "All";
  }

  function applyAlphaFilter(letter) {
    state.activeAlpha = letter || "All";
    const all = window.__customersAll || [];
    let list = all;

    if (letter && letter !== "All") {
      list = all.filter((c) => getLastNameInitial(c) === letter);
    }

    window.__customersFiltered = list;
    state.filtered = list;

    const input = $("customerSearchInput");
    if (input && input.value && input.value.trim()) {
      applySearchFilter();
      return;
    }

    renderCustomers(list);
  }

  function openProfile(c) {
    const drawer = document.getElementById("profileDrawer");
    const nameEl = document.getElementById("profileName");
    const subEl = document.getElementById("profileSub");
    const bodyEl = document.getElementById("profileBody");

    if (!drawer || !nameEl || !subEl || !bodyEl) return;

    nameEl.textContent = c.name || "(No name)";
    subEl.textContent = [c.phone, c.email].filter(Boolean).join(" • ");

    const rows = [
      ["Customer ID", c.id],
      ["First Name", c.firstName],
      ["Last Name", c.lastName],
      ["Phone", c.phone],
      ["Email", c.email],
      ["Address", c.address],
      ["Vehicle", c.vehicle],
      ["Last Service", c.lastService],
      ["Notes", c.notes],
    ];

    bodyEl.innerHTML = rows
      .filter(([_, v]) => v && String(v).trim() !== "")
      .map(
        ([k, v]) => `
      <div class="profile-row">
        <div class="profile-label">${escapeHtml(k)}</div>
        <div>${escapeHtml(String(v))}</div>
      </div>
    `
      )
      .join("");

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");

    const copyPhone = document.getElementById("profileCopyPhone");
    const copyEmail = document.getElementById("profileCopyEmail");

    if (copyPhone)
      copyPhone.onclick = async () => {
        if (c.phone) await navigator.clipboard.writeText(c.phone);
      };
    if (copyEmail)
      copyEmail.onclick = async () => {
        if (c.email) await navigator.clipboard.writeText(c.email);
      };
  }

  function closeProfile() {
    const drawer = document.getElementById("profileDrawer");
    if (!drawer) return;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
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
      window.__customersAll = customers;
      window.__customersFiltered = customers;
      if (!Array.isArray(customers) || !customers.length) {
        console.warn(
          "Normalized empty list for customers:",
          payload && typeof payload === "object" ? Object.keys(payload) : payload
        );
      }

      console.log("Phone sample raw -> normalized:", rawList[0]?.phone, customers[0]?.phone);
      state.customers = customers;
      console.log("Normalized customer sample:", customers[0]);
      console.log(
        "Raw keys sample:",
        customers[0]?.raw ? Object.keys(customers[0].raw) : []
      );
      state.filtered = [];
      buildAlphaBar(customers);
      applyAlphaFilter(state.activeAlpha);
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
    document.getElementById("profileClose")?.addEventListener("click", closeProfile);
    document.getElementById("profileBackToList")?.addEventListener("click", closeProfile);
    document.getElementById("profileDrawer")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "profileDrawer") closeProfile();
    });
    initCustomersPage();
  });
})();
