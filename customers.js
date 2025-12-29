// customers.js
// Clean customers page logic using apiGet() from auth.js
// No top-level await, everything wrapped in async init function.

(function () {
  // Simple in-memory state
  const state = {
    customers: [],
    filtered: [],
    activeAlpha: "All",
    activeCustomerId: null,
    vehicles: [],
    customerHistory: [],
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

  function formatDateLocal(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function normalizeVinInput(value) {
    return (value || "").toString().trim().toUpperCase();
  }

  function setVehiclesStatus(message) {
    const el = $("vehiclesStatus");
    if (el) el.textContent = message || "";
  }

  function setVehicleFormStatus(message) {
    const el = $("vehicleFormStatus");
    if (el) el.textContent = message || "";
  }

  function setHistoryStatus(message) {
    const el = $("historyStatus");
    if (el) el.textContent = message || "";
  }

  function renderHistoryList(list) {
    const container = $("historyList");
    if (!container) return;
    container.innerHTML = "";

    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No history found.";
      container.appendChild(empty);
      return;
    }

    items.forEach((event) => {
      const card = document.createElement("div");
      card.className = "history-card";

      const header = document.createElement("div");
      header.className = "history-card-header";

      const date = document.createElement("div");
      date.className = "history-date";
      date.textContent = formatDateLocal(event.event_date || event.created_at) || "";

      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = event.title || "(No title)";

      header.appendChild(date);
      header.appendChild(title);

      const description = document.createElement("div");
      description.className = "history-description";
      description.textContent = event.description || "";

      const vehicleLine = document.createElement("div");
      vehicleLine.className = "history-vehicle";
      const vehiclePieces = [event.vehicle_year, event.vehicle_make, event.vehicle_model, event.vehicle_trim]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (vehiclePieces) {
        const vin = event.vehicle_vin ? ` (VIN: ${event.vehicle_vin})` : "";
        vehicleLine.textContent = `Vehicle: ${vehiclePieces}${vin}`;
      } else if (event.vehicle_vin) {
        vehicleLine.textContent = `Vehicle VIN: ${event.vehicle_vin}`;
      }

      const source = document.createElement("div");
      source.className = "history-source";
      source.textContent = event.source ? `Source: ${event.source}` : "";

      card.appendChild(header);
      if (description.textContent) card.appendChild(description);
      if (vehicleLine.textContent) card.appendChild(vehicleLine);
      if (source.textContent) card.appendChild(source);

      container.appendChild(card);
    });
  }

  function renderVehiclesList(list) {
    const container = $("vehiclesList");
    if (!container) return;
    container.innerHTML = "";

    const vehicles = Array.isArray(list) ? list : state.vehicles || [];
    if (!vehicles.length) {
      const empty = document.createElement("div");
      empty.className = "vehicles-status";
      empty.textContent = "No vehicles on file.";
      container.appendChild(empty);
      return;
    }

    vehicles.forEach((v) => {
      const card = document.createElement("div");
      card.className = "vehicle-card";

      const title = document.createElement("div");
      title.className = "vehicle-card-title";
      const name = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").trim();
      title.textContent = name || "Vehicle";

      const meta = document.createElement("div");
      meta.className = "vehicle-card-meta";
      const vin = v.vin ? `VIN: ${v.vin}` : "VIN: Not provided";
      const plate = v.plate ? `Plate: ${v.plate}` : null;
      const color = v.color ? `Color: ${v.color}` : null;
      const mileage = v.mileage ? `Mileage: ${v.mileage}` : null;
      [vin, plate, color, mileage].filter(Boolean).forEach((item) => {
        const span = document.createElement("span");
        span.textContent = item;
        meta.appendChild(span);
      });

      card.appendChild(title);
      card.appendChild(meta);
      if (v.notes) {
        const notes = document.createElement("div");
        notes.className = "vehicles-status";
        notes.textContent = v.notes;
        card.appendChild(notes);
      }
      container.appendChild(card);
    });
  }

  function applyDecodedFields(fields) {
    if (!fields || typeof fields !== "object") return;
    const yearInput = $("vehicleYearInput");
    const makeInput = $("vehicleMakeInput");
    const modelInput = $("vehicleModelInput");
    const trimInput = $("vehicleTrimInput");

    if (yearInput && !yearInput.value && fields.year) yearInput.value = fields.year;
    if (makeInput && !makeInput.value && fields.make) makeInput.value = fields.make;
    if (modelInput && !modelInput.value && fields.model) modelInput.value = fields.model;
    if (trimInput && !trimInput.value && fields.trim) trimInput.value = fields.trim;
  }

  function getVehicleFormPayload() {
    const vin = normalizeVinInput($("vehicleVinInput")?.value || "");
    return {
      vin,
      year: $("vehicleYearInput")?.value || "",
      make: $("vehicleMakeInput")?.value || "",
      model: $("vehicleModelInput")?.value || "",
      trim: $("vehicleTrimInput")?.value || "",
      color: $("vehicleColorInput")?.value || "",
      plate: $("vehiclePlateInput")?.value || "",
      mileage: $("vehicleMileageInput")?.value || "",
      notes: $("vehicleNotesInput")?.value || "",
    };
  }

  function clearVehicleForm() {
    ["vehicleVinInput","vehicleYearInput","vehicleMakeInput","vehicleModelInput","vehicleTrimInput","vehicleColorInput","vehiclePlateInput","vehicleMileageInput","vehicleNotesInput"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
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
    const cardsContainer = $("customersCards");
    if (!tbody) {
      console.warn("customers.js: #customersTableBody not found in DOM.");
      return;
    }

    const rows = Array.isArray(list)
      ? list
      : state.filtered.length
      ? state.filtered
      : state.customers;

    // Clear existing rows/cards
    tbody.innerHTML = "";
    if (cardsContainer) cardsContainer.innerHTML = "";

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No customers found.";
      td.style.textAlign = "center";
      tr.appendChild(td);
      tbody.appendChild(tr);

      if (cardsContainer) {
        const empty = document.createElement("div");
        empty.className = "customer-card";
        empty.textContent = "No customers found.";
        cardsContainer.appendChild(empty);
      }
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

      if (cardsContainer) {
        const card = document.createElement("div");
        card.className = "customer-card";
        card.innerHTML = `
          <div class="customer-card__name">${escapeHtml(cust.name)}</div>
          <div class="customer-card__meta">
            ${escapeHtml([cust.phone, cust.email].filter(Boolean).join(" • "))}
          </div>
          ${
            cust.vehicle
              ? `<div class="customer-card__meta">Vehicle: ${escapeHtml(cust.vehicle)}</div>`
              : ""
          }
          <div class="customer-card__actions">
            <button class="customer-card__btn" type="button">View Profile</button>
          </div>
        `;
        card.addEventListener("click", () => openProfile(cust));
        card.querySelector("button")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openProfile(cust);
        });
        cardsContainer.appendChild(card);
      }
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

    ["vehicleDecodeBtn", "vehicleDecodeInline"].forEach((id) => {
      const btn = $(id);
      if (btn) btn.addEventListener("click", decodeVinInput);
    });

    ["vehicleScanBtn", "vehicleScanInline"].forEach((id) => {
      const btn = $(id);
      if (btn) btn.addEventListener("click", startVinScanner);
    });

    const vehicleForm = $("vehicleForm");
    if (vehicleForm) {
      vehicleForm.addEventListener("submit", saveVehicle);
    }

    $("vinScannerClose")?.addEventListener("click", stopVinScanner);
    $("vinScannerStop")?.addEventListener("click", stopVinScanner);
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

  async function loadVehiclesForCustomer(customerId) {
    if (!customerId) {
      setVehiclesStatus("Select a customer to view vehicles.");
      renderVehiclesList([]);
      return;
    }

    setVehiclesStatus("Loading vehicles...");
    try {
      const url = buildApiUrl(`/api/v2/customers/${encodeURIComponent(customerId)}`);
      const payload = await fetchJsonDebug(url);
      const data = payload?.data || payload || {};
      const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
      state.vehicles = vehicles;
      renderVehiclesList(vehicles);
      setVehiclesStatus(`${vehicles.length} vehicle(s) found`);
    } catch (err) {
      console.error("Failed to load vehicles:", err);
      setVehiclesStatus("Could not load vehicles for this customer.");
      renderVehiclesList([]);
    }
  }

  async function loadHistoryForCustomer(customerId) {
    if (!customerId) {
      setHistoryStatus("Load a customer to view history.");
      renderHistoryList([]);
      return;
    }

    setHistoryStatus("Loading history…");
    renderHistoryList([]);
    try {
      const url = buildApiUrl(`/api/v2/customers/${encodeURIComponent(customerId)}/events?limit=50`);
      const payload = await fetchJsonDebug(url);
      const data = payload?.data || payload || {};
      const events = Array.isArray(data.events) ? data.events : [];
      state.customerHistory = events;
      renderHistoryList(events);
      setHistoryStatus(events.length ? `${events.length} record(s)` : "No history found.");
    } catch (err) {
      console.error("Failed to load history:", err);
      const unauthorized = err?.status === 401;
      setHistoryStatus(
        unauthorized ? "Session expired — please log in again." : "Could not load history."
      );
      renderHistoryList([]);
    }
  }

  async function openProfile(c) {
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
    state.activeCustomerId = c.id || null;
    await Promise.all([
      loadVehiclesForCustomer(state.activeCustomerId),
      loadHistoryForCustomer(state.activeCustomerId),
    ]);

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
    state.activeCustomerId = null;
    state.vehicles = [];
    state.customerHistory = [];
    renderVehiclesList([]);
    setVehiclesStatus("Load a customer to view vehicles.");
    renderHistoryList([]);
    setHistoryStatus("Load a customer to view history.");
    stopVinScanner();
  }

  async function decodeVinInput() {
    const vin = normalizeVinInput($("vehicleVinInput")?.value || "");
    if (!vin) {
      setVehicleFormStatus("Enter a VIN to decode.");
      return;
    }

    setVehicleFormStatus("Decoding VIN...");
    try {
      const url = buildApiUrl(`/api/v2/vin/${encodeURIComponent(vin)}/decode`);
      const payload = await fetchJsonDebug(url);
      const parsed = payload?.data?.parsed || {};
      applyDecodedFields(parsed);
      setVehicleFormStatus("VIN decoded. Fields auto-filled when available.");
    } catch (err) {
      console.error("VIN decode failed:", err);
      setVehicleFormStatus("VIN decode failed. Check the VIN or try again.");
    }
  }

  async function saveVehicle(event) {
    if (event) event.preventDefault();
    if (!state.activeCustomerId) {
      setVehicleFormStatus("Select a customer before adding a vehicle.");
      return;
    }

    const payload = getVehicleFormPayload();
    if (!payload.vin) {
      setVehicleFormStatus("VIN is required.");
      return;
    }

    const url = buildApiUrl(`/api/v2/customers/${encodeURIComponent(state.activeCustomerId)}/vehicles`);
    setVehicleFormStatus("Saving vehicle...");
    try {
      const response = await fetchJsonDebug(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const vehicle = response?.data || response;
      if (vehicle) {
        state.vehicles = [vehicle, ...(state.vehicles || [])];
        renderVehiclesList(state.vehicles);
      }
      setVehicleFormStatus("Vehicle saved.");
      clearVehicleForm();
    } catch (err) {
      console.error("Failed to save vehicle:", err);
      const message = err?.status === 400 ? "Invalid VIN or missing data." : "Unable to save vehicle.";
      setVehicleFormStatus(message);
    }
  }

  let vinScanner = null;
  async function startVinScanner() {
    const modal = $("vinScannerModal");
    const viewportId = "vinScannerViewport";
    const statusEl = $("vinScannerStatus");
    if (!modal || !statusEl) return;

    if (typeof Html5Qrcode === "undefined") {
      statusEl.textContent = "VIN scanning is not supported on this device.";
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      return;
    }

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    statusEl.textContent = "Starting camera...";

    try {
      const formats =
        typeof Html5QrcodeSupportedFormats !== "undefined"
          ? [
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.QR_CODE,
            ]
          : null;

      vinScanner = new Html5Qrcode(
        viewportId,
        formats ? { formatsToSupport: formats } : undefined
      );

      await vinScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          const vinValue = normalizeVinInput(decodedText);
          if (vinValue && vinValue.length >= 11) {
            const vinInput = $("vehicleVinInput");
            if (vinInput) {
              vinInput.value = vinValue;
            }
            stopVinScanner();
            decodeVinInput();
          }
        },
        () => {}
      );
      statusEl.textContent = "Scanning... align the VIN barcode.";
    } catch (err) {
      console.error("VIN scanner failed:", err);
      statusEl.textContent = "Could not start camera. Use manual entry instead.";
    }
  }

  async function stopVinScanner() {
    const modal = $("vinScannerModal");
    const statusEl = $("vinScannerStatus");
    if (vinScanner) {
      try {
        await vinScanner.stop();
        await vinScanner.clear();
      } catch (e) {
        console.warn("Failed to stop scanner", e);
      }
      vinScanner = null;
    }
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }
    if (statusEl) statusEl.textContent = "";
  }

  // --- API ---

  async function fetchCustomers() {
    setLoading(true);
    setError("");

    try {
      const url = buildApiUrl(`/customers`);
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
    document.getElementById("alphaToggle")?.addEventListener("click", () => {
      document.getElementById("alphaBar")?.classList.toggle("open");
    });
    initCustomersPage();
  });
})();
