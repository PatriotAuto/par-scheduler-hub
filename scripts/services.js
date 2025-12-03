// Standalone Services Library logic for services.html
// Uses the same localStorage key as index.html: "patriotServicePackages"

(function () {
  const STORAGE_KEY = "patriotServicePackages";

  const defaultServicePackages = {
    "Detailing": [
      { name: "Interior Detail", minutes: 150, price: 275 },
      { name: "Exterior Detail", minutes: 120, price: 225 },
      { name: "Full Detail", minutes: 210, price: 450 },
      { name: "Quick Clean", minutes: 60, price: 120 }
    ],
    "Tint": [
      { name: "Front Windows Only", minutes: 60, price: 180 },
      { name: "Full Tint", minutes: 120, price: 380 },
      { name: "Windshield Tint", minutes: 90, price: 220 }
    ],
    "PPF": [
      { name: "Full Front PPF", minutes: 240, price: 1600 }
    ],
    "Ceramic": [
      { name: "1 Year Coating", minutes: 150, price: 650 },
      { name: "3 Year Coating", minutes: 210, price: 1100 },
      { name: "5 Year Coating", minutes: 240, price: 1400 }
    ],
    "Electronics": [
      { name: "Remote Start", minutes: 120, price: 450 },
      { name: "Remote Start + Security", minutes: 150, price: 650 }
    ]
  };

  let servicePackages = {};

  // ---- Storage helpers ----

  function hasLocalStorage() {
    try {
      const testKey = "__patriot_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  const storageAvailable = hasLocalStorage();

  function normalizeServiceList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(item => {
      if (typeof item === "string") {
        return { name: item, minutes: 90, price: 0 };
      }
      const minutes = Math.max(15, parseInt(item.minutes, 10) || 90);
      const price = parseFloat(item.price) || 0;
      return {
        name: item.name || "Unnamed Service",
        minutes,
        price
      };
    });
  }

  function normalizePackages(raw) {
    const cleaned = {};
    Object.keys(raw || {}).forEach(cat => {
      cleaned[cat] = normalizeServiceList(raw[cat]);
    });
    return cleaned;
  }

  function loadServicePackages() {
    if (!storageAvailable) {
      servicePackages = normalizePackages(defaultServicePackages);
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      servicePackages = normalizePackages(defaultServicePackages);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      servicePackages = normalizePackages(parsed);
    } catch (e) {
      console.error("Failed to parse stored service packages, using defaults.", e);
      servicePackages = normalizePackages(defaultServicePackages);
    }
  }

  function saveServicePackages() {
    if (!storageAvailable) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servicePackages));
  }

  // ---- DOM helpers ----

  function qs(id) {
    return document.getElementById(id);
  }

  function createEl(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  // ---- Rendering ----

  function renderCategories() {
    const container = qs("serviceCategoriesList");
    if (!container) return;

    container.innerHTML = "";

    const categories = Object.keys(servicePackages).sort();
    if (!categories.length) {
      const empty = createEl("div", "svc-empty");
      empty.textContent =
        "No service categories yet. Add one below to get started.";
      container.appendChild(empty);
      return;
    }

    categories.forEach(cat => {
      const card = createEl("div", "svc-category-card");

      // Header
      const header = createEl("div", "svc-category-header");
      const titleWrap = createEl("div");
      const title = createEl("div", "svc-category-title");
      title.textContent = cat;

      const meta = createEl("div", "svc-category-meta");
      const count = (servicePackages[cat] || []).length;
      meta.textContent =
        count === 1 ? "1 service" : `${count} services`;

      titleWrap.appendChild(title);
      titleWrap.appendChild(meta);

      const actions = createEl("div", "svc-category-actions");
      const delBtn = createEl("button", "svc-btn svc-btn-small svc-btn-danger");
      delBtn.type = "button";
      delBtn.textContent = "Delete Category";

      delBtn.addEventListener("click", () => {
        if (
          confirm(
            `Delete category "${cat}" and all its services? This cannot be undone.`
          )
        ) {
          delete servicePackages[cat];
          saveServicePackages();
          renderCategories();
        }
      });

      actions.appendChild(delBtn);
      header.appendChild(titleWrap);
      header.appendChild(actions);
      card.appendChild(header);

      // Existing services
      const svcList = createEl("div", "svc-service-list");

      (servicePackages[cat] || []).forEach((svc, idx) => {
        const row = createEl("div", "svc-service-row");

        const nameCol = createEl("div");
        const name = createEl("div", "svc-service-name");
        name.textContent = svc.name;
        const metaLine = createEl("div", "svc-service-meta");
        metaLine.textContent = `${svc.minutes} min · $${svc.price}`;
        nameCol.appendChild(name);
        nameCol.appendChild(metaLine);

        const minutesInput = createEl("input", "svc-number");
        minutesInput.type = "number";
        minutesInput.min = "15";
        minutesInput.step = "15";
        minutesInput.value = svc.minutes || 90;

        const priceInput = createEl("input", "svc-number");
        priceInput.type = "number";
        priceInput.min = "0";
        priceInput.step = "1";
        priceInput.value = svc.price || 0;

        const controls = createEl("div", "svc-service-controls");
        const removeBtn = createEl(
          "button",
          "svc-btn svc-btn-small svc-btn-ghost"
        );
        removeBtn.type = "button";
        removeBtn.textContent = "Remove";

        function persist() {
          const newMinutes = Math.max(
            15,
            parseInt(minutesInput.value, 10) || 90
          );
          const newPrice = parseFloat(priceInput.value) || 0;
          servicePackages[cat][idx] = {
            ...svc,
            minutes: newMinutes,
            price: newPrice
          };
          saveServicePackages();
          renderCategories();
        }

        minutesInput.addEventListener("change", persist);
        priceInput.addEventListener("change", persist);

        removeBtn.addEventListener("click", () => {
          if (!servicePackages[cat]) return;
          servicePackages[cat].splice(idx, 1);
          saveServicePackages();
          renderCategories();
        });

        controls.appendChild(removeBtn);

        row.appendChild(nameCol);
        row.appendChild(minutesInput);
        row.appendChild(priceInput);
        row.appendChild(controls);

        svcList.appendChild(row);
      });

      card.appendChild(svcList);

      // Add service row
      const addRow = createEl("div", "svc-add-service-row");

      const newNameInput = createEl("input", "svc-input");
      newNameInput.placeholder = "Add service (e.g., Full Detail + Interior)";

      const newMinutesInput = createEl("input", "svc-number");
      newMinutesInput.type = "number";
      newMinutesInput.min = "15";
      newMinutesInput.step = "15";
      newMinutesInput.placeholder = "Mins";

      const newPriceInput = createEl("input", "svc-number");
      newPriceInput.type = "number";
      newPriceInput.min = "0";
      newPriceInput.step = "1";
      newPriceInput.placeholder = "$";

      const addBtn = createEl("button", "svc-btn svc-btn-small svc-btn-primary");
      addBtn.type = "button";
      addBtn.textContent = "Add";

      addBtn.addEventListener("click", () => {
        const name = newNameInput.value.trim();
        const minutesVal = Math.max(
          15,
          parseInt(newMinutesInput.value, 10) || 90
        );
        const priceVal = parseFloat(newPriceInput.value) || 0;
        if (!name) return;
        if (!servicePackages[cat]) servicePackages[cat] = [];

        const exists = servicePackages[cat].some(
          s => (s.name || "").toLowerCase() === name.toLowerCase()
        );
        if (exists) {
          alert("That service already exists in this category.");
          return;
        }

        servicePackages[cat].push({
          name,
          minutes: minutesVal,
          price: priceVal
        });
        saveServicePackages();
        renderCategories();
      });

      addRow.appendChild(newNameInput);
      addRow.appendChild(newMinutesInput);
      addRow.appendChild(newPriceInput);
      addRow.appendChild(addBtn);

      card.appendChild(addRow);

      container.appendChild(card);
    });
  }

  // ---- Add Category ----

  function setupAddCategory() {
    const input = qs("inputNewCategoryName");
    const btn = qs("btnAddCategory");
    if (!input || !btn) return;

    btn.addEventListener("click", () => {
      const name = (input.value || "").trim();
      if (!name) return;
      if (servicePackages[name]) {
        alert("That category already exists.");
        return;
      }
      servicePackages[name] = [];
      saveServicePackages();
      input.value = "";
      renderCategories();
    });
  }

  // ---- Init ----

  document.addEventListener("DOMContentLoaded", () => {
    loadServicePackages();
    renderCategories();
    setupAddCategory();
  });
})();
