// === VEHICLE DROPDOWN HELPERS (Year -> Make -> Model) ===

// Use shared API base URL configured in scripts/config.js
const BACKEND_URL = (typeof window !== 'undefined' && window.API_BASE_URL)
  ? window.API_BASE_URL
  : (typeof globalThis !== 'undefined' && typeof globalThis.BACKEND_URL !== 'undefined')
    ? globalThis.BACKEND_URL
    : '';

let vehicleDropdownsReadyResolver;
const vehicleDropdownsReadyPromise = new Promise((resolve) => {
  vehicleDropdownsReadyResolver = resolve;
});

function initVehicleDropdowns() {
  return vehicleDropdownsReadyPromise;
}

// Generic helper to build backend URLs
function buildBackendUrl(action, params) {
  if (!BACKEND_URL) {
    throw new Error('API base URL is not configured for vehicle dropdowns');
  }
  const url = new URL(BACKEND_URL);
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

// Simple GET JSON wrapper
async function apiGetJson(action, params) {
  const url = buildBackendUrl(action, params);
  console.log('[YMM] Fetching', url);
  const data = await fetchJsonDebug(url, { method: 'GET' });
  console.log('[YMM] Response', action, data);
  return data;
}

// Populate a <select> with options
function populateSelect(selectEl, items, placeholder) {
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

document.addEventListener('DOMContentLoaded', function () {
  const yearSelect  = document.getElementById('vehicleYear');
  const makeSelect  = document.getElementById('vehicleMake');
  const modelSelect = document.getElementById('vehicleModel');

  if (!yearSelect || !makeSelect || !modelSelect) {
    if (typeof vehicleDropdownsReadyResolver === 'function') {
      vehicleDropdownsReadyResolver(null);
    }
    return;
  }

  console.log('[YMM] Initializing Year/Make/Model dropdowns');

  // 1) Populate Year dropdown (e.g. 1985 -> current year)
  const currentYear = new Date().getFullYear();
  const startYear   = 1985;
  const years = [];
  for (let y = currentYear; y >= startYear; y--) {
    years.push(y);
  }
  populateSelect(yearSelect, years, 'Year');

  // Ensure Make/Model are in a known state
  populateSelect(makeSelect, [], 'Make');
  makeSelect.disabled = true;
  populateSelect(modelSelect, [], 'Model');
  modelSelect.disabled = true;

  // 2) When Year changes -> load Makes
  yearSelect.addEventListener('change', async function () {
    const yearVal = this.value;
    console.log('[YMM] Year changed to', yearVal);

    // Reset Make & Model
    populateSelect(makeSelect, [], 'Make');
    makeSelect.disabled = true;
    populateSelect(modelSelect, [], 'Model');
    modelSelect.disabled = true;

    if (!yearVal) {
      console.log('[YMM] No year selected, skipping makes');
      return;
    }

    try {
      makeSelect.disabled = true;
      makeSelect.classList.add('loading');

      const data = await apiGetJson('getVehicleMakes', { year: yearVal });

      if (!data || !data.ok) {
        console.error('[YMM] Error loading makes', data);
        // Still re-enable so user isn't stuck
        makeSelect.disabled = false;
        makeSelect.classList.remove('loading');
        return;
      }

      populateSelect(makeSelect, data.makes || [], 'Make');
      makeSelect.disabled = false;
      makeSelect.classList.remove('loading');
    } catch (err) {
      console.error('[YMM] Failed to load makes', err);
      makeSelect.disabled = false;
      makeSelect.classList.remove('loading');
    }
  });

  // 3) When Make changes -> load Models
  makeSelect.addEventListener('change', async function () {
    const yearVal = yearSelect.value;
    const makeVal = this.value;
    console.log('[YMM] Make changed to', makeVal, 'for year', yearVal);

    populateSelect(modelSelect, [], 'Model');
    modelSelect.disabled = true;

    if (!yearVal || !makeVal) {
      console.log('[YMM] Missing year or make, skipping models');
      return;
    }

    try {
      modelSelect.disabled = true;
      modelSelect.classList.add('loading');

      const data = await apiGetJson('getVehicleModels', {
        year: yearVal,
        make: makeVal
      });

      if (!data || !data.ok) {
        console.error('[YMM] Error loading models', data);
        modelSelect.disabled = false;
        modelSelect.classList.remove('loading');
        return;
      }

      populateSelect(modelSelect, data.models || [], 'Model');
      modelSelect.disabled = false;
      modelSelect.classList.remove('loading');
    } catch (err) {
      console.error('[YMM] Failed to load models', err);
      modelSelect.disabled = false;
      modelSelect.classList.remove('loading');
    }
  });

  const controller = {
    setValues({ year, make, model }) {
      if (yearSelect) {
        yearSelect.value = year || '';
        yearSelect.dispatchEvent(new Event('change'));
      }
      if (makeSelect && make) {
        makeSelect.value = make;
        makeSelect.dispatchEvent(new Event('change'));
      }
      if (modelSelect && model) {
        modelSelect.value = model;
      }
    }
  };

  if (typeof vehicleDropdownsReadyResolver === 'function') {
    vehicleDropdownsReadyResolver(controller);
  }
});
