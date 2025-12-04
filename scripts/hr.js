// HR page logic – Employees, Departments, Holidays
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

  const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let departments = [];
  let employees = [];
  let filteredEmployees = [];
  let selectedEmployeeId = null;

  let scheduleEntries = [];
  let currentScheduleEmployeeId = null;

  let timeOffEntries = [];
  let filteredTimeOffEntries = [];
  let selectedTimeOffId = null;

  // ---- Holidays ----
  let holidays = [];
  let selectedHolidayId = null;

  // ---- Fetch helpers ----
  async function getJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Network error: " + resp.status);
    return resp.json();
  }

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    // IMPORTANT: no custom headers so the browser doesn't send a CORS preflight
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
      employees = (data && data.employees) || [];
      filteredEmployees = employees.slice();

      renderEmployeeList();
      populateTimeOffEmployeeSelects();
      populateScheduleEmployeeSelect();
    } catch (err) {
      console.error("Failed to load employees", err);
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
      const params = new URLSearchParams();
      params.set("action", "saveEmployee");
      params.set("employee", JSON.stringify(employee));

      const resp = await fetch(GOOGLE_BACKEND_URL + "?" + params.toString(), {
        method: "GET",
      });

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      const result = await resp.json();

      if (!result || result.ok === false) {
        console.error("saveEmployee backend error:", result);
        alert("Failed to save employee: " + (result && result.error ? result.error : "Unknown error"));
        return;
      }

      if (result.employeeId) {
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
      const params = new URLSearchParams();
      params.set("action", "deleteEmployee");
      params.set("employeeId", id);

      const resp = await fetch(GOOGLE_BACKEND_URL + "?" + params.toString(), {
        method: "GET",
      });

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

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
  // ---- TIME OFF ----

  function populateTimeOffEmployeeSelects() {
    const selectMain = qs("#timeOffEmployee");
    const selectFilter = qs("#timeOffFilterEmployee");
    if (!selectMain && !selectFilter) return;

    // get current selection to restore
    const currentMain = selectMain ? selectMain.value : "";
    const currentFilter = selectFilter ? selectFilter.value : "";

    if (selectMain) {
      selectMain.innerHTML = '<option value="">Select employee...</option>';
    }
    if (selectFilter) {
      selectFilter.innerHTML = '<option value="">All employees</option>';
    }

    employees.forEach((emp) => {
      const label =
        ((emp.firstName || "") + " " + (emp.lastName || "")).trim() ||
        emp.employeeId ||
        "(Unnamed)";

      if (selectMain) {
        const opt = document.createElement("option");
        opt.value = emp.employeeId || "";
        opt.textContent = label;
        selectMain.appendChild(opt);
      }

      if (selectFilter) {
        const opt2 = document.createElement("option");
        opt2.value = emp.employeeId || "";
        opt2.textContent = label;
        selectFilter.appendChild(opt2);
      }
    });

    if (selectMain && currentMain) {
      selectMain.value = currentMain;
    }
    if (selectFilter && currentFilter) {
      selectFilter.value = currentFilter;
    }
  }

  function populateScheduleEmployeeSelect() {
    const select = qs("#scheduleEmployee");
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="">Select employee...</option>';

    // Only show employees marked as technicians
    employees
      .filter((emp) => emp.isTechnician)
      .forEach((emp) => {
        const label =
          ((emp.firstName || "") + " " + (emp.lastName || "")).trim() ||
          emp.employeeId ||
          "(Unnamed)";

        const opt = document.createElement("option");
        opt.value = emp.employeeId || "";
        opt.textContent = label;
        select.appendChild(opt);
      });

    if (current) {
      select.value = current;
    }
  }

  function clearScheduleForm() {
    currentScheduleEmployeeId = null;
    const select = qs("#scheduleEmployee");
    if (select) select.value = "";

    WEEK_DAYS.forEach((day) => {
      qsa(`.sch-working[data-day="${day}"]`).forEach((el) =>
        (el.checked = false)
      );
      qsa(`.sch-start[data-day="${day}"]`).forEach((el) => (el.value = ""));
      qsa(`.sch-end[data-day="${day}"]`).forEach((el) => (el.value = ""));
      qsa(`.sch-location[data-day="${day}"]`).forEach(
        (el) => (el.value = "")
      );
      qsa(`.sch-bay[data-day="${day}"]`).forEach((el) => (el.value = ""));
    });
  }

  function readScheduleForm() {
    const employeeId = qs("#scheduleEmployee") ? qs("#scheduleEmployee").value : "";
    if (!employeeId) return null;

    const emp = employees.find((e) => e.employeeId === employeeId);
    const employeeName =
      (emp && ((emp.firstName || "") + " " + (emp.lastName || "")).trim()) ||
      "";

    const entries = WEEK_DAYS.map((day) => {
      const working = qsa(`.sch-working[data-day="${day}"]`)[0];
      const start = qsa(`.sch-start[data-day="${day}"]`)[0];
      const end = qsa(`.sch-end[data-day="${day}"]`)[0];
      const loc = qsa(`.sch-location[data-day="${day}"]`)[0];
      const bay = qsa(`.sch-bay[data-day="${day}"]`)[0];

      const isWorking = working && working.checked;
      const startTime = start ? start.value : "";
      const endTime = end ? end.value : "";
      const location = loc ? loc.value.trim() : "";
      const bayVal = bay ? bay.value.trim() : "";

      return {
        dayOfWeek: day,
        isWorking: isWorking,
        startTime: startTime,
        endTime: endTime,
        location: location,
        bay: bayVal,
      };
    });

    return {
      employeeId,
      employeeName,
      entries,
    };
  }

  function fillScheduleForm(entries) {
    // clear first
    WEEK_DAYS.forEach((day) => {
      qsa(`.sch-working[data-day="${day}"]`).forEach((el) =>
        (el.checked = false)
      );
      qsa(`.sch-start[data-day="${day}"]`).forEach((el) => (el.value = ""));
      qsa(`.sch-end[data-day="${day}"]`).forEach((el) => (el.value = ""));
      qsa(`.sch-location[data-day="${day}"]`).forEach(
        (el) => (el.value = "")
      );
      qsa(`.sch-bay[data-day="${day}"]`).forEach((el) => (el.value = ""));
    });

    entries.forEach((e) => {
      const day = e.dayOfWeek;
      if (!day) return;

      const working = qsa(`.sch-working[data-day="${day}"]`)[0];
      const start = qsa(`.sch-start[data-day="${day}"]`)[0];
      const end = qsa(`.sch-end[data-day="${day}"]`)[0];
      const loc = qsa(`.sch-location[data-day="${day}"]`)[0];
      const bay = qsa(`.sch-bay[data-day="${day}"]`)[0];

      if (working) working.checked = !!e.isWorking;
      if (start && e.startTime) start.value = e.startTime;
      if (end && e.endTime) end.value = e.endTime;
      if (loc && e.location) loc.value = e.location;
      if (bay && e.bay) bay.value = e.bay;
    });
  }

  async function loadScheduleForEmployee(employeeId) {
    if (!employeeId) {
      clearScheduleForm();
      return;
    }
    currentScheduleEmployeeId = employeeId;

    try {
      const url =
        GOOGLE_BACKEND_URL +
        "?action=getEmployeeSchedule&employeeId=" +
        encodeURIComponent(employeeId);

      const data = await getJson(url);
      const schedule = (data && data.schedule) || [];

      // Normalize into entries for the form
      const entries = schedule.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        isWorking: row.isWorking,
        startTime: row.startTime,
        endTime: row.endTime,
        location: row.location,
        bay: row.bay,
      }));

      fillScheduleForm(entries);
    } catch (err) {
      console.error("Failed to load schedule", err);
      alert("Failed to load schedule. Check console for details.");
    }
  }

  async function saveSchedule() {
    const payload = readScheduleForm();
    if (!payload || !payload.employeeId) {
      alert("Select an employee first.");
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("action", "saveEmployeeSchedule");
      params.set("schedule", JSON.stringify(payload));

      const resp = await fetch(
        GOOGLE_BACKEND_URL + "?" + params.toString(),
        { method: "GET" }
      );

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      const result = await resp.json();
      if (!result || result.ok === false) {
        console.error("saveEmployeeSchedule backend error:", result);
        alert(
          "Failed to save schedule: " +
            (result && result.error ? result.error : "Unknown error")
        );
        return;
      }

      alert("Schedule saved.");
    } catch (err) {
      console.error("Save schedule failed", err);
      alert("Failed to save schedule. Check console for details.");
    }
  }

  async function clearScheduleForEmployee() {
    const select = qs("#scheduleEmployee");
    if (!select || !select.value) {
      alert("Select an employee first.");
      return;
    }
    if (!confirm("Clear schedule for this employee?")) return;

    // Saving an empty entries array for this employee will clear rows on backend
    const payload = {
      employeeId: select.value,
      employeeName: "",
      entries: [],
    };

    try {
      const params = new URLSearchParams();
      params.set("action", "saveEmployeeSchedule");
      params.set("schedule", JSON.stringify(payload));

      const resp = await fetch(
        GOOGLE_BACKEND_URL + "?" + params.toString(),
        { method: "GET" }
      );

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      const result = await resp.json();
      if (!result || result.ok === false) {
        console.error("clearSchedule backend error:", result);
        alert(
          "Failed to clear schedule: " +
            (result && result.error ? result.error : "Unknown error")
        );
        return;
      }

      clearScheduleForm();
      select.value = "";
      alert("Schedule cleared for employee.");
    } catch (err) {
      console.error("Clear schedule failed", err);
      alert("Failed to clear schedule. Check console for details.");
    }
  }

  async function loadTimeOff() {
    const container = qs("#timeOffList");
    if (container) {
      container.innerHTML = "";
    }
    try {
      const data = await getJson(GOOGLE_BACKEND_URL + "?action=getTimeOff");
      timeOffEntries = (data && data.timeOff) || [];
      filteredTimeOffEntries = timeOffEntries.slice();
      renderTimeOffList();
    } catch (err) {
      console.error("Failed to load time off", err);
      if (container) {
        const msg = createEl("div", "hr-empty");
        msg.textContent =
          "Failed to load time off from backend. Check console for details.";
        container.appendChild(msg);
      }
    }
  }

  function renderTimeOffList() {
    const list = qs("#timeOffList");
    if (!list) return;
    list.innerHTML = "";

    if (!filteredTimeOffEntries.length) {
      const empty = createEl("div", "hr-empty");
      empty.textContent = "No time off entries yet.";
      list.appendChild(empty);
      return;
    }

    filteredTimeOffEntries.forEach((entry) => {
      const item = createEl("button", "hr-holiday-item");
      item.type = "button";
      item.setAttribute("data-id", entry.timeOffId || "");

      const title = createEl("div", "hr-holiday-name");
      const name =
        entry.employeeName ||
        entry.employeeId ||
        "(Unknown employee)";
      title.textContent = name;

      const meta = createEl("div", "hr-holiday-meta");
      const start = entry.startDate || "";
      const end = entry.endDate || "";
      let range = start;
      if (end && end !== start) {
        range = start + " → " + end;
      }
      const parts = [];
      if (range) parts.push(range);
      if (entry.allDay) parts.push("All day");
      if (entry.startTime && entry.endTime && !entry.allDay) {
        parts.push(entry.startTime + "–" + entry.endTime);
      }
      if (entry.status) parts.push(entry.status);
      meta.textContent = parts.join(" • ");

      item.appendChild(title);
      item.appendChild(meta);

      if (entry.timeOffId && entry.timeOffId === selectedTimeOffId) {
        item.classList.add("hr-employee-item-selected");
      }

      item.addEventListener("click", () => {
        selectTimeOffEntry(entry.timeOffId);
      });

      list.appendChild(item);
    });
  }

  function clearTimeOffForm() {
    selectedTimeOffId = null;
    const form = qs("#timeOffForm");
    if (!form) return;
    form.reset();
    qs("#timeOffId").value = "";
    const delBtn = qs("#btnDeleteTimeOff");
    if (delBtn) delBtn.disabled = true;
  }

  function selectTimeOffEntry(id) {
    const entry = timeOffEntries.find((t) => t.timeOffId === id);
    if (!entry) return;
    selectedTimeOffId = id;
    qs("#timeOffId").value = entry.timeOffId || "";
    qs("#timeOffEmployee").value = entry.employeeId || "";
    qs("#timeOffStartDate").value = entry.startDate || "";
    qs("#timeOffEndDate").value = entry.endDate || "";
    qs("#timeOffStartTime").value = entry.startTime || "";
    qs("#timeOffEndTime").value = entry.endTime || "";
    qs("#timeOffAllDay").checked = !!entry.allDay;
    qs("#timeOffStatus").value = entry.status || "Planned";
    qs("#timeOffReason").value = entry.reason || "";

    const delBtn = qs("#btnDeleteTimeOff");
    if (delBtn) delBtn.disabled = !entry.timeOffId;

    // highlight selection
    const items = qsa("#timeOffList .hr-holiday-item");
    items.forEach((el) => {
      const rowId = el.getAttribute("data-id");
      el.classList.toggle("hr-employee-item-selected", rowId === selectedTimeOffId);
    });
  }

  async function saveTimeOff() {
    const empId = qs("#timeOffEmployee").value;
    if (!empId) {
      alert("Please select an employee.");
      return;
    }
    const emp = employees.find((e) => e.employeeId === empId);
    const startDate = qs("#timeOffStartDate").value;
    if (!startDate) {
      alert("Start date is required.");
      return;
    }

    const timeOff = {
      timeOffId: qs("#timeOffId").value || null,
      employeeId: empId,
      employeeName:
        (emp && ((emp.firstName || "") + " " + (emp.lastName || "")).trim()) || "",
      startDate: startDate,
      endDate: qs("#timeOffEndDate").value || startDate,
      startTime: qs("#timeOffStartTime").value || "",
      endTime: qs("#timeOffEndTime").value || "",
      allDay: qs("#timeOffAllDay").checked,
      status: qs("#timeOffStatus").value || "Planned",
      reason: qs("#timeOffReason").value.trim(),
    };

    try {
      const params = new URLSearchParams();
      params.set("action", "saveTimeOff");
      params.set("timeoff", JSON.stringify(timeOff));

      const resp = await fetch(
        GOOGLE_BACKEND_URL + "?" + params.toString(),
        { method: "GET" }
      );

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      const result = await resp.json();
      if (!result || result.ok === false) {
        console.error("saveTimeOff backend error:", result);
        alert(
          "Failed to save time off: " +
            (result && result.error ? result.error : "Unknown error")
        );
        return;
      }

      if (result.timeOffId) {
        timeOff.timeOffId = result.timeOffId;
      }

      await loadTimeOff();
      if (timeOff.timeOffId) {
        selectTimeOffEntry(timeOff.timeOffId);
      }
      alert("Time off saved.");
    } catch (err) {
      console.error("Save time off failed", err);
      alert("Failed to save time off. Check console for details.");
    }
  }

  async function deleteTimeOff() {
    const id = qs("#timeOffId").value;
    if (!id) return;
    if (!confirm("Delete this time off entry? This cannot be undone.")) return;

    try {
      const params = new URLSearchParams();
      params.set("action", "deleteTimeOff");
      params.set("timeOffId", id);

      const resp = await fetch(
        GOOGLE_BACKEND_URL + "?" + params.toString(),
        { method: "GET" }
      );

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      await loadTimeOff();
      clearTimeOffForm();
      alert("Time off deleted.");
    } catch (err) {
      console.error("Delete time off failed", err);
      alert("Failed to delete time off. Check console for details.");
    }
  }

  function setupTimeOffEvents() {
    const btnSave = qs("#btnSaveTimeOff");
    if (btnSave) {
      btnSave.addEventListener("click", (e) => {
        e.preventDefault();
        saveTimeOff();
      });
    }

    const btnClear = qs("#btnClearTimeOff");
    if (btnClear) {
      btnClear.addEventListener("click", (e) => {
        e.preventDefault();
        clearTimeOffForm();
      });
    }

    const btnDelete = qs("#btnDeleteTimeOff");
    if (btnDelete) {
      btnDelete.addEventListener("click", (e) => {
        e.preventDefault();
        deleteTimeOff();
      });
    }

    const filterSelect = qs("#timeOffFilterEmployee");
    if (filterSelect) {
      filterSelect.addEventListener("change", () => {
        const empId = filterSelect.value;
        if (!empId) {
          filteredTimeOffEntries = timeOffEntries.slice();
        } else {
          filteredTimeOffEntries = timeOffEntries.filter(
            (t) => t.employeeId === empId
          );
        }
        renderTimeOffList();
      });
    }
  }

  function setupScheduleEvents() {
    const select = qs("#scheduleEmployee");
    if (select) {
      select.addEventListener("change", () => {
        const empId = select.value;
        loadScheduleForEmployee(empId);
      });
    }

    const btnSave = qs("#btnSaveSchedule");
    if (btnSave) {
      btnSave.addEventListener("click", (e) => {
        e.preventDefault();
        saveSchedule();
      });
    }

    const btnClear = qs("#btnClearSchedule");
    if (btnClear) {
      btnClear.addEventListener("click", (e) => {
        e.preventDefault();
        clearScheduleForEmployee();
      });
    }
  }

  // ---- Holidays ----
  function renderHolidayList() {
    const list = qs("#holidayList");
    if (!list) return;
    list.innerHTML = "";

    if (!holidays.length) {
      const empty = createEl("div", "hr-empty");
      empty.textContent = "No holidays defined yet.";
      list.appendChild(empty);
      return;
    }

    holidays.forEach((h) => {
      const item = createEl("button", "hr-holiday-item");
      item.type = "button";
      item.setAttribute("data-id", h.id || "");

      const title = createEl("div", "hr-holiday-name");
      title.textContent = h.name || "(Unnamed Holiday)";

      const meta = createEl("div", "hr-holiday-meta");
      const metaParts = [];

      if (h.date) metaParts.push(h.date);

      if (h.shopClosed) {
        metaParts.push("Closed all day");
      } else if (h.openTime && h.closeTime) {
        metaParts.push(`Open ${h.openTime}–${h.closeTime}`);
      }

      if (h.notes) metaParts.push(h.notes);

      meta.textContent = metaParts.join(" • ");

      item.appendChild(title);
      item.appendChild(meta);

      if (h.id && h.id === selectedHolidayId) {
        item.classList.add("hr-employee-item-selected");
      }

      item.addEventListener("click", () => {
        selectHoliday(h.id);
      });

      list.appendChild(item);
    });
  }

  function clearHolidayForm() {
    selectedHolidayId = null;
    const form = qs("#holidayForm");
    if (!form) return;
    form.reset();
    qs("#holidayId").value = "";
    const delBtn = qs("#btnDeleteHoliday");
    if (delBtn) delBtn.disabled = true;

    // clear list highlight
    const items = qsa("#holidayList .hr-holiday-item");
    items.forEach((el) => el.classList.remove("hr-employee-item-selected"));
  }

  function fillHolidayForm(h) {
    qs("#holidayId").value = h.id || "";
    qs("#holidayName").value = h.name || "";
    qs("#holidayDate").value = h.date || "";
    qs("#holidayShopClosed").checked = !!h.shopClosed;
    qs("#holidayOpenTime").value = h.openTime || "";
    qs("#holidayCloseTime").value = h.closeTime || "";
    qs("#holidayNotes").value = h.notes || "";

    const delBtn = qs("#btnDeleteHoliday");
    if (delBtn) delBtn.disabled = !h.id;
  }

  function selectHoliday(id) {
    const h = holidays.find((x) => x.id === id);
    if (!h) return;
    selectedHolidayId = id;
    fillHolidayForm(h);

    const items = qsa("#holidayList .hr-holiday-item");
    items.forEach((el) => {
      const rowId = el.getAttribute("data-id");
      el.classList.toggle("hr-employee-item-selected", rowId === selectedHolidayId);
    });
  }

  async function loadHolidays() {
    const container = qs("#holidayList");
    if (container) container.innerHTML = "";

    try {
      const data = await getJson(
        GOOGLE_BACKEND_URL + "?action=loadHolidays"
      );

      // New backend shape: { ok, holidays: [ { id, name, date, shopClosed, openTime, closeTime, notes } ] }
      if (data && Array.isArray(data.holidays)) {
        holidays = data.holidays.map((row) => ({
          id: String(row.id || row.holidayId || ""),
          name: row.name || row.holidayName || row.Name || "",
          date: row.date || row.Date || "",
          shopClosed: !!(row.shopClosed ?? row.ShopClosed ?? row.closed),
          openTime: row.openTime || row.OpenTime || "",
          closeTime: row.closeTime || row.CloseTime || "",
          notes: row.notes || row.Notes || "",
        }));
      } else {
        // Fallback if something older ever calls it
        const rows = (data && data.rows) || [];
        holidays = rows.map((row, idx) => ({
          id: String(row.id || row.holidayId || row.rowNumber || idx + 1),
          name: row.Name || row.Holiday || row.holidayName || "",
          date: row.Date || row.date || "",
          shopClosed: !!(row.ShopClosed || row.closed),
          openTime: row.OpenTime || row.openTime || "",
          closeTime: row.CloseTime || row.closeTime || "",
          notes: row.Notes || row.notes || "",
        }));
      }

      renderHolidayList();
    } catch (err) {
      console.error("Failed to load holidays", err);
      if (container) {
        const msg = createEl("div", "hr-empty");
        msg.textContent = "Failed to load holidays from backend.";
        container.appendChild(msg);
      }
    }
  }

  async function saveHoliday() {
    const name = qs("#holidayName").value.trim();
    const date = qs("#holidayDate").value;
    const shopClosed = qs("#holidayShopClosed").checked;
    const openTime = qs("#holidayOpenTime").value;
    const closeTime = qs("#holidayCloseTime").value;
    const notes = qs("#holidayNotes").value.trim();
    const id = qs("#holidayId").value || null;

    if (!name) {
      alert("Holiday name is required.");
      return;
    }
    if (!date) {
      alert("Holiday date is required.");
      return;
    }

    // Optional sanity: if not closed and one time is set, require both
    if (!shopClosed && ((openTime && !closeTime) || (!openTime && closeTime))) {
      alert("For shortened hours, please set both open and close times.");
      return;
    }

    const holiday = {
      id,
      name,
      date,
      shopClosed,
      openTime,
      closeTime,
      notes,
    };

    try {
      const params = new URLSearchParams();
      params.set("action", "saveHoliday");
      params.set("holiday", JSON.stringify(holiday));

      const resp = await fetch(
        GOOGLE_BACKEND_URL + "?" + params.toString(),
        { method: "GET" }
      );

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      const result = await resp.json();
      if (!result || result.ok === false) {
        console.error("saveHoliday backend error:", result);
        alert(
          "Failed to save holiday: " +
            (result && result.error ? result.error : "Unknown error")
        );
        return;
      }

      if (result.holidayId) {
        holiday.id = String(result.holidayId);
      }

      await loadHolidays();
      if (holiday.id) {
        selectHoliday(holiday.id);
      }
      alert("Holiday saved.");
    } catch (err) {
      console.error("Save holiday failed", err);
      alert("Failed to save holiday. Check console for details.");
    }
  }

  async function deleteHoliday() {
    const id = qs("#holidayId").value;
    if (!id) return;
    if (!confirm("Delete this holiday? This cannot be undone.")) return;

    try {
      const params = new URLSearchParams();
      params.set("action", "deleteHoliday");
      params.set("holidayId", id);

      const resp = await fetch(
        GOOGLE_BACKEND_URL + "?" + params.toString(),
        { method: "GET" }
      );

      if (!resp.ok) {
        throw new Error("Network error: " + resp.status);
      }

      const result = await resp.json();
      if (!result || result.ok === false) {
        console.error("deleteHoliday backend error:", result);
        alert(
          "Failed to delete holiday: " +
            (result && result.error ? result.error : "Unknown error")
        );
        return;
      }

      await loadHolidays();
      clearHolidayForm();
      alert("Holiday deleted.");
    } catch (err) {
      console.error("Delete holiday failed", err);
      alert("Failed to delete holiday. Check console for details.");
    }
  }

  function setupHolidayEvents() {
    const btnSave = qs("#btnSaveHoliday");
    if (btnSave) {
      btnSave.addEventListener("click", (e) => {
        e.preventDefault();
        saveHoliday();
      });
    }

    const btnClear = qs("#btnClearHoliday");
    if (btnClear) {
      btnClear.addEventListener("click", (e) => {
        e.preventDefault();
        clearHolidayForm();
      });
    }

    const btnDelete = qs("#btnDeleteHoliday");
    if (btnDelete) {
      btnDelete.addEventListener("click", (e) => {
        e.preventDefault();
        deleteHoliday();
      });
    }
  }

  // ---- INIT ----
  document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    setupEmployeeEvents();
    setupTimeOffEvents();
    setupScheduleEvents();
    setupHolidayEvents();
    clearEmployeeForm();

    await loadDepartments();
    renderDepartmentChips([]);

    await loadEmployees();
    await loadHolidays();
    await loadTimeOff();
  });

})();
