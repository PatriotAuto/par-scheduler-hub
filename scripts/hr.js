// HR page logic – Employees, Departments, Holidays (read-only for now)
(function () {
  // ---- DOM helpers ----
  function qs(sel) {
    return document.querySelector(sel);
  }
  function qsa(sel) {
    return Array.from(document.querySelectorAll(sel));
  }
  function createEl(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  let departments = [];
  let employees = [];
  let filteredEmployees = [];
  let selectedEmployeeId = null;

  // ---- Fetch helpers ----
  async function getJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Network error: " + resp.status);
    return resp.json();
  }

  async function postJson(url, body) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!resp.ok) throw new Error("Network error: " + resp.status);
    return resp.json();
  }

  // ---- Tabs ----
  function setupTabs() {
    qsa(".hr-tab-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        qsa(".hr-tab-button").forEach((b) =>
          b.classList.toggle("hr-tab-active", b === btn)
        );
        qsa(".hr-tab-content").forEach((section) => {
          section.classList.toggle(
            "hr-tab-content-active",
            section.getAttribute("data-tab") === tab
          );
        });
      });
    });
  }

  // ---- Departments ----
  async function loadDepartments() {
    try {
      const data = await getJson(
        GOOGLE_BACKEND_URL + "?action=getDepartments"
      );
      departments = (data.departments || data || []).filter(
        (d) => d.active !== false
      );
    } catch (err) {
      console.error("Failed to load departments", err);
      departments = [];
    }
  }

  function renderDepartmentChips(selectedNames) {
    const container = qs("#empDepartments");
    if (!container) return;
    container.innerHTML = "";

    const selectedSet = new Set(
      (selectedNames || []).map((s) => s.toString())
    );

    if (!departments.length) {
      const note = createEl("div", "hr-muted small");
      note.textContent =
        "No departments found. Add rows to the 'Departments' sheet (Name, Active).";
      container.appendChild(note);
      return;
    }

    departments.forEach((dept) => {
      const name = dept.name || "";
      const pill = createEl("button", "hr-chip");
      const isActive = selectedSet.has(name);
      if (isActive) pill.classList.add("hr-chip-active");
      pill.type = "button";
      pill.textContent = name || "(unnamed)";

      pill.addEventListener("click", () => {
        if (pill.classList.contains("hr-chip-active")) {
          pill.classList.remove("hr-chip-active");
        } else {
          pill.classList.add("hr-chip-active");
        }
      });

      container.appendChild(pill);
    });
  }

  function readSelectedDepartments() {
    const chips = qsa("#empDepartments .hr-chip.hr-chip-active");
    return chips.map((chip) => chip.textContent.trim()).filter(Boolean);
  }

  // ---- Employees ----
  async function loadEmployees() {
    try {
      const data = await getJson(GOOGLE_BACKEND_URL + "?action=getEmployees");
      employees = data.employees || data || [];
      employees.sort((a, b) => {
        const aName = ((a.lastName || "") + " " + (a.firstName || "")).toLowerCase();
        const bName = ((b.lastName || "") + " " + (b.firstName || "")).toLowerCase();
        return aName.localeCompare(bName);
      });
      filteredEmployees = employees.slice();
      renderEmployeeList();
    } catch (err) {
      console.error("Failed to load employees", err);
      employees = [];
      filteredEmployees = [];
      renderEmployeeList();
    }
  }

  function renderEmployeeList() {
    const listEl = qs("#employeeList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!filteredEmployees.length) {
      const empty = createEl("div", "hr-empty");
      empty.textContent = "No employees yet. Click “+ New Employee” to add one.";
      listEl.appendChild(empty);
      return;
    }

    filteredEmployees.forEach((emp) => {
      const card = createEl("button", "hr-employee-item");
      card.type = "button";
      card.setAttribute("data-id", emp.employeeId);

      const name = createEl("div", "hr-employee-name");
      const fullName =
        (emp.firstName || "") + " " + (emp.lastName || "");
      name.textContent = fullName.trim() || "(Unnamed Employee)";

      const meta = createEl("div", "hr-employee-meta");
      const parts = [];
      if (emp.role) parts.push(emp.role);
      if (emp.status) parts.push(emp.status);
      if (Array.isArray(emp.departments) && emp.departments.length) {
        parts.push(emp.departments.join(", "));
      }
      meta.textContent = parts.join(" • ");

      if (emp.isTechnician) {
        const techBadge = createEl("span", "hr-pill hr-pill-tech");
        techBadge.textContent = "Tech";
        card.appendChild(techBadge);
      }

      card.appendChild(name);
      card.appendChild(meta);

      if (emp.employeeId && emp.employeeId === selectedEmployeeId) {
        card.classList.add("hr-employee-item-selected");
      }

      card.addEventListener("click", () => {
        selectEmployee(emp.employeeId);
      });

      listEl.appendChild(card);
    });
  }

  function selectEmployee(id) {
    const emp = employees.find((e) => e.employeeId === id);
    if (!emp) return;
    selectedEmployeeId = id;
    fillEmployeeForm(emp);
    highlightSelectedEmployee();
  }

  function highlightSelectedEmployee() {
    qsa(".hr-employee-item").forEach((el) => {
      const id = el.getAttribute("data-id");
      el.classList.toggle(
        "hr-employee-item-selected",
        id === selectedEmployeeId
      );
    });
  }

  function clearEmployeeForm() {
    selectedEmployeeId = null;
    const form = qs("#employeeForm");
    if (!form) return;
    form.reset();
    qs("#empId").value = "";
    qs("#employeeFormTitle").textContent = "New Employee";
    const badge = qs("#employeeIdBadge");
    if (badge) {
      badge.hidden = true;
      badge.textContent = "";
    }
    const delBtn = qs("#btnDeleteEmployee");
    if (delBtn) delBtn.disabled = true;
    renderDepartmentChips([]);
  }

  function fillEmployeeForm(emp) {
    qs("#employeeFormTitle").textContent = "Employee Profile";
    qs("#empId").value = emp.employeeId || "";
    qs("#empFirstName").value = emp.firstName || "";
    qs("#empLastName").value = emp.lastName || "";
    qs("#empRole").value = emp.role || "";
    qs("#empStatus").value = emp.status || "Active";
    qs("#empPayType").value = emp.payType || "";
    qs("#empBaseRate").value = emp.baseHourlyRate || "";
    qs("#empSalary").value = emp.salaryAnnual || "";
    qs("#empFlatMultiplier").value = emp.flatRateMultiplier || 1;
    qs("#empCommType").value = emp.defaultCommissionType || "";
    qs("#empCommValue").value = emp.defaultCommissionValue || "";
    qs("#empIsTechnician").checked = !!emp.isTechnician;
    qs("#empNotes").value = emp.notes || "";

    const badge = qs("#employeeIdBadge");
    if (badge) {
      if (emp.employeeId) {
        badge.hidden = false;
        badge.textContent = emp.employeeId;
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    }

    renderDepartmentChips(emp.departments || []);

    const delBtn = qs("#btnDeleteEmployee");
    if (delBtn) delBtn.disabled = !emp.employeeId;
  }

  async function saveEmployee() {
    const employee = {
      employeeId: qs("#empId").value || null,
      firstName: qs("#empFirstName").value.trim(),
      lastName: qs("#empLastName").value.trim(),
      role: qs("#empRole").value.trim(),
      status: qs("#empStatus").value || "Active",
      payType: qs("#empPayType").value || "",
      baseHourlyRate: parseFloat(qs("#empBaseRate").value) || "",
      salaryAnnual: parseFloat(qs("#empSalary").value) || "",
      flatRateMultiplier: parseFloat(qs("#empFlatMultiplier").value) || 1,
      defaultCommissionType: qs("#empCommType").value || "",
      defaultCommissionValue:
        qs("#empCommValue").value !== ""
          ? parseFloat(qs("#empCommValue").value)
          : "",
      departments: readSelectedDepartments(),
      isTechnician: qs("#empIsTechnician").checked,
      notes: qs("#empNotes").value.trim(),
    };

    if (!employee.firstName || !employee.lastName) {
      alert("First and last name are required.");
      return;
    }

    try {
      const result = await postJson(GOOGLE_BACKEND_URL, {
        action: "saveEmployee",
        employee,
      });

      if (result && result.employeeId) {
        employee.employeeId = result.employeeId;
      }

      await loadEmployees();
      if (employee.employeeId) {
        selectEmployee(employee.employeeId);
      }
      alert("Employee saved.");
    } catch (err) {
      console.error("Save employee failed", err);
      alert("Failed to save employee. Check console for details.");
    }
  }

  async function deleteEmployee() {
    const id = qs("#empId").value;
    if (!id) return;
    if (!confirm("Delete this employee? This cannot be undone.")) return;

    try {
      await postJson(GOOGLE_BACKEND_URL, {
        action: "deleteEmployee",
        employeeId: id,
      });
      await loadEmployees();
      clearEmployeeForm();
      alert("Employee deleted.");
    } catch (err) {
      console.error("Delete employee failed", err);
      alert("Failed to delete employee. Check console for details.");
    }
  }

  function setupEmployeeEvents() {
    const btnNew = qs("#btnNewEmployee");
    if (btnNew) {
      btnNew.addEventListener("click", () => {
        clearEmployeeForm();
      });
    }

    const btnSave = qs("#btnSaveEmployee");
    if (btnSave) {
      btnSave.addEventListener("click", (e) => {
        e.preventDefault();
        saveEmployee();
      });
    }

    const btnDelete = qs("#btnDeleteEmployee");
    if (btnDelete) {
      btnDelete.addEventListener("click", (e) => {
        e.preventDefault();
        deleteEmployee();
      });
    }

    const searchInput = qs("#employeeSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const term = searchInput.value.trim().toLowerCase();
        if (!term) {
          filteredEmployees = employees.slice();
        } else {
          filteredEmployees = employees.filter((emp) => {
            const fullName =
              ((emp.firstName || "") + " " + (emp.lastName || "")).toLowerCase();
            const role = (emp.role || "").toLowerCase();
            const deptStr = Array.isArray(emp.departments)
              ? emp.departments.join(" ").toLowerCase()
              : "";
            return (
              fullName.includes(term) ||
              role.includes(term) ||
              deptStr.includes(term)
            );
          });
        }
        renderEmployeeList();
      });
    }
  }

  // ---- Holidays (read-only list for now) ----
  async function loadHolidays() {
    const container = qs("#holidayList");
    if (!container) return;
    container.innerHTML = "";

    try {
      const data = await getJson(
        GOOGLE_BACKEND_URL + "?action=loadHolidays"
      );
      const rows = (data && data.rows) || [];
      if (!rows.length) {
        const msg = createEl("div", "hr-empty");
        msg.textContent = "No holidays defined yet.";
        container.appendChild(msg);
        return;
      }

      rows.forEach((row) => {
        const item = createEl("div", "hr-holiday-item");
        const name = row.Name || row.Holiday || row.holidayName || "";
        const dateVal = row.Date || row.date || "";
        const closed = row.ShopClosed || row.closed || "";

        const title = createEl("div", "hr-holiday-name");
        title.textContent = name || "(Unnamed Holiday)";

        const meta = createEl("div", "hr-holiday-meta");
        meta.textContent =
          String(dateVal) +
          (closed ? " • Shop Closed" : "");

        item.appendChild(title);
        item.appendChild(meta);
        container.appendChild(item);
      });
    } catch (err) {
      console.error("Failed to load holidays", err);
      const msg = createEl("div", "hr-empty");
      msg.textContent = "Failed to load holidays from backend.";
      container.appendChild(msg);
    }
  }

  // ---- INIT ----
  document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    setupEmployeeEvents();
    clearEmployeeForm();
    await loadDepartments();
    renderDepartmentChips([]);
    await loadEmployees();
    await loadHolidays();
  });
})();
