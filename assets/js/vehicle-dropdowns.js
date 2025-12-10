// Vehicle dropdown helpers powered by Apps Script
const VEHICLE_BACKEND_URL = typeof BACKEND_URL !== 'undefined'
  ? BACKEND_URL
  : (typeof GOOGLE_BACKEND_URL !== 'undefined'
    ? GOOGLE_BACKEND_URL
    : (typeof API_URL !== 'undefined'
      ? API_URL
      : '<<REPLACE_WITH_YOUR_APPS_SCRIPT_EXEC_URL>>'));

function buildBackendUrl(action, params) {
  const url = new URL(VEHICLE_BACKEND_URL);
  url.searchParams.set('action', action);
  if (params) {
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.set(key, params[key]);
      }
    });
  }
  return url.toString();
}

async function apiGetJson(action, params) {
  const url = buildBackendUrl(action, params);
  const resp = await fetch(url, { method: 'GET', credentials: 'include' });
  const data = await resp.json();
  return data;
}

function populateSelect(selectEl, items, placeholder) {
  if (!selectEl) return;

  selectEl.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = placeholder || 'Select...';
  selectEl.appendChild(opt);

  (items || []).forEach(item => {
    const o = document.createElement('option');
    o.value = item;
    o.textContent = item;
    selectEl.appendChild(o);
  });
}

function initVehicleDropdowns(options = {}) {
  const {
    yearSelectId = 'vehicleYear',
    makeSelectId = 'vehicleMake',
    modelSelectId = 'vehicleModel',
    initialValues = {}
  } = options;

  return new Promise(resolve => {
    const runInit = () => {
      const yearSelect = document.getElementById(yearSelectId) || document.getElementById('vehicleYearSelect');
      const makeSelect = document.getElementById(makeSelectId) || document.getElementById('vehicleMakeSelect');
      const modelSelect = document.getElementById(modelSelectId) || document.getElementById('vehicleModelSelect');

      if (!yearSelect || !makeSelect || !modelSelect) {
        resolve(null);
        return;
      }

      const resetMakeModel = () => {
        populateSelect(makeSelect, [], 'Make');
        makeSelect.disabled = true;
        populateSelect(modelSelect, [], 'Model');
        modelSelect.disabled = true;
      };

      const currentYear = new Date().getFullYear();
      const startYear = 1985;
      const years = [];
      for (let y = currentYear; y >= startYear; y--) {
        years.push(y);
      }
      populateSelect(yearSelect, years, 'Year');
      resetMakeModel();

      const loadModels = async (yearVal, makeVal, prefillModel) => {
        populateSelect(modelSelect, [], 'Model');
        modelSelect.disabled = true;

        if (!yearVal || !makeVal) {
          return;
        }

        try {
          modelSelect.classList.add('loading');
          const data = await apiGetJson('getVehicleModels', { year: yearVal, make: makeVal });
          if (!data || !data.ok) {
            console.error('Error loading models:', data);
            return;
          }

          populateSelect(modelSelect, data.models || [], 'Model');
          modelSelect.disabled = false;

          if (prefillModel) {
            modelSelect.value = prefillModel;
          }
        } catch (err) {
          console.error('Failed to load models:', err);
        } finally {
          modelSelect.classList.remove('loading');
        }
      };

      const loadMakes = async (yearVal, prefillMake, prefillModel) => {
        resetMakeModel();
        if (!yearVal) {
          return;
        }

        try {
          makeSelect.disabled = true;
          makeSelect.classList.add('loading');

          const data = await apiGetJson('getVehicleMakes', { year: yearVal });
          if (!data || !data.ok) {
            console.error('Error loading makes:', data);
            return;
          }

          populateSelect(makeSelect, data.makes || [], 'Make');
          makeSelect.disabled = false;

          if (prefillMake) {
            makeSelect.value = prefillMake;
            await loadModels(yearVal, prefillMake, prefillModel);
          }
        } catch (err) {
          console.error('Failed to load makes:', err);
        } finally {
          makeSelect.classList.remove('loading');
        }
      };

      yearSelect.addEventListener('change', async function () {
        const yearVal = this.value;
        await loadMakes(yearVal);
      });

      makeSelect.addEventListener('change', async function () {
        const yearVal = yearSelect.value;
        const makeVal = this.value;
        await loadModels(yearVal, makeVal);
      });

      const controller = {
        setValues: async ({ year, make, model } = {}) => {
          if (!year) {
            yearSelect.value = '';
            resetMakeModel();
            return;
          }

          yearSelect.value = year;
          await loadMakes(year, make, model);

          if (make) {
            makeSelect.value = make;
            if (model) {
              await loadModels(year, make, model);
              modelSelect.value = model;
            }
          }
        }
      };

      if (initialValues && (initialValues.year || initialValues.make || initialValues.model)) {
        controller.setValues(initialValues);
      }

      resolve(controller);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runInit);
    } else {
      runInit();
    }
  });
}

window.initVehicleDropdowns = initVehicleDropdowns;
