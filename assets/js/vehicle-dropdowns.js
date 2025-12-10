function ensureOption(selectEl, value, label) {
  if (!selectEl || !value) return;
  const exists = Array.from(selectEl.options || []).some((opt) => opt.value === value);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label || value;
    selectEl.appendChild(opt);
  }
}

function initVehicleDropdowns(options = {}) {
  const {
    yearSelectId = 'vehicleYearSelect',
    makeSelectId = 'vehicleMakeSelect',
    modelSelectId = 'vehicleModelSelect',
    initialValues = {}
  } = options;

  const yearSelect = document.getElementById(yearSelectId);
  const makeSelect = document.getElementById(makeSelectId);
  const modelSelect = document.getElementById(modelSelectId);

  if (!yearSelect || !makeSelect || !modelSelect) {
    return Promise.resolve(null);
  }

  const resetSelects = () => {
    yearSelect.innerHTML = '<option value="">Year</option>';
    makeSelect.innerHTML = '<option value="">Make</option>';
    modelSelect.innerHTML = '<option value="">Model</option>';
    makeSelect.disabled = true;
    modelSelect.disabled = true;
  };

  const loadMakes = async (year, prefillMake, prefillModel) => {
    makeSelect.innerHTML = '<option value="">Make</option>';
    modelSelect.innerHTML = '<option value="">Model</option>';
    makeSelect.disabled = true;
    modelSelect.disabled = true;

    if (!year) return;

    const resp = await fetch(API_URL + '?action=vehicles.makes&year=' + encodeURIComponent(year));
    const json = await resp.json();
    const makes = (json && json.makes) || [];

    makeSelect.innerHTML = '<option value="">Make</option>' +
      makes.map((m) => `<option value="${m}">${m}</option>`).join('');
    makeSelect.disabled = false;

    if (prefillMake) {
      ensureOption(makeSelect, prefillMake);
      makeSelect.value = prefillMake;
      await loadModels(year, prefillMake, prefillModel);
    }
  };

  const loadModels = async (year, make, prefillModel) => {
    modelSelect.innerHTML = '<option value="">Model</option>';
    modelSelect.disabled = true;

    if (!year || !make) return;

    const resp = await fetch(
      API_URL + '?action=vehicles.models&year=' + encodeURIComponent(year) +
      '&make=' + encodeURIComponent(make)
    );
    const json = await resp.json();
    const models = (json && json.models) || [];

    modelSelect.innerHTML = '<option value="">Model</option>' +
      models.map((m) => `<option value="${m}">${m}</option>`).join('');
    modelSelect.disabled = false;

    if (prefillModel) {
      ensureOption(modelSelect, prefillModel);
      modelSelect.value = prefillModel;
    }
  };

  yearSelect.addEventListener('change', async function() {
    const year = this.value;
    await loadMakes(year);
  });

  makeSelect.addEventListener('change', async function() {
    const year = yearSelect.value;
    const make = this.value;
    await loadModels(year, make);
  });

  const initializeYears = async () => {
    resetSelects();
    const resp = await fetch(API_URL + '?action=vehicles.years');
    const json = await resp.json();
    const years = (json && json.years) || [];

    yearSelect.innerHTML = '<option value="">Year</option>' +
      years.map((y) => `<option value="${y}">${y}</option>`).join('');

    if (initialValues.year) {
      ensureOption(yearSelect, initialValues.year);
      yearSelect.value = initialValues.year;
      await loadMakes(initialValues.year, initialValues.make, initialValues.model);
      if (initialValues.make && !makeSelect.value) {
        ensureOption(makeSelect, initialValues.make);
        makeSelect.value = initialValues.make;
      }
      if (initialValues.model && !modelSelect.value) {
        ensureOption(modelSelect, initialValues.model);
        modelSelect.value = initialValues.model;
      }
    }
  };

  return initializeYears().then(() => ({
    setValues: async ({ year, make, model } = {}) => {
      if (!year) {
        resetSelects();
        await initializeYears();
        return;
      }
      ensureOption(yearSelect, year);
      yearSelect.value = year;
      await loadMakes(year, make, model);
      if (make) {
        ensureOption(makeSelect, make);
        makeSelect.value = make;
        if (model) {
          await loadModels(year, make, model);
          ensureOption(modelSelect, model);
          modelSelect.value = model;
        }
      }
    }
  }));
}

window.initVehicleDropdowns = initVehicleDropdowns;
