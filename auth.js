// auth.js - shared auth & API helpers for Patriot Scheduler

function getApiBaseUrl() {
  if (typeof window === 'undefined') return '';
  return window.API_BASE_URL || '';
}

// ====== SHARED AUTH HELPERS ======
const PS_TOKEN_KEY = 'ps_token';
const PS_USER_KEY = 'ps_user';
const LOGIN_PAGE = 'login.html';

function getStoredToken() {
  try {
    const stored = localStorage.getItem(PS_TOKEN_KEY);
    return stored || null;
  } catch (e) {
    return null;
  }
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem(PS_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Backwards-compatible helpers
function getAuthToken() {
  return getStoredToken();
}

function getAuthUser() {
  return getStoredUser();
}

// Redirect to login if no token
function ensureLoggedIn() {
  const token = getStoredToken();
  if (!token) {
    window.location.href = LOGIN_PAGE;
    return false;
  }
  return true;
}

// Build headers for authenticated POST requests
function buildAuthHeaders(extra) {
  const token = getStoredToken();
  const base = {
    'Content-Type': 'application/json'
  };
  if (token) {
    base['Authorization'] = 'Bearer ' + token;
  }
  if (extra) {
    Object.keys(extra).forEach(function (k) {
      base[k] = extra[k];
    });
  }
  return base;
}

// Append token to URL for GET requests
function withAuthQuery(url) {
  const token = getStoredToken();
  if (!token) return url;
  const joinChar = url.indexOf('?') === -1 ? '?' : '&';
  return url + joinChar + 'token=' + encodeURIComponent(token);
}

// Clear auth info and send user to login
function logoutAndRedirect() {
  try {
    localStorage.removeItem(PS_TOKEN_KEY);
    localStorage.removeItem(PS_USER_KEY);
  } catch (e) {
    // ignore
  }
  window.location.href = LOGIN_PAGE;
}

// Keep logout behavior consistent across the app
function logout() {
  logoutAndRedirect();
}

function handleAuthFailure(json, status) {
  const err = json && (json.error || json.code);

  const authErrors = [
    'LOGIN_FAILED',
    'LOGIN_INACTIVE',
    'INVALID_TOKEN',
    'SESSION_EXPIRED',
    'AUTH_REQUIRED',
    'UNAUTHORIZED',
  ];

  if (status === 401 || authErrors.includes(err)) {
    logout();
    return true;
  }

  return false;
}

// Generic POST helper: adds action + token; handles auth errors
function apiPost(action, body) {
  if (!ensureLoggedIn()) {
    return Promise.reject('Not logged in');
  }

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return Promise.reject('API base URL is not configured');
  }

  const url = withAuthQuery(baseUrl + '?action=' + encodeURIComponent(action));

  return fetchJsonDebug(url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify(body || {})
  })
    .then(function (json) {
      if (!json || json.success === false || json.ok === false) {
        const handled = handleAuthFailure(json, 400);
        if (!handled) {
          console.error('API POST error:', action, json);
        }
        throw json || new Error('API POST failed');
      }

      return json;
    })
    .catch(function (err) {
      const handled = handleAuthFailure({}, err && err.status);
      if (!handled) {
        console.error('API POST error:', action, err);
      }
      throw err;
    });
}

/**
 * Simple GET helper to call Apps Script without CORS headaches.
 * Supports both apiGet({ action: '...' }) and apiGet('action', { extra })
 */
async function apiGet(paramsOrAction, maybeExtraParams = {}) {
  const params = typeof paramsOrAction === 'string'
    ? Object.assign({ action: paramsOrAction }, maybeExtraParams || {})
    : Object.assign({}, paramsOrAction || {});

  const token = getStoredToken();
  const merged = Object.assign({}, params);
  if (token) {
    merged.token = token;
  }

  const qs = new URLSearchParams(merged);
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error('API base URL is not configured');
  }

  const url = baseUrl + '?' + qs.toString();

  try {
    const json = await fetchJsonDebug(url, {
      method: 'GET'
    });

    if (!json || json.success === false || json.ok === false) {
      const handled = handleAuthFailure(json, 400);
      if (!handled) {
        console.error('API GET error:', url, json);
      }
      throw json || new Error('API GET failed');
    }

    return json;
  } catch (err) {
    const handled = handleAuthFailure({}, err && err.status);
    if (!handled) {
      console.error('API GET error:', url, err);
    }
    throw err;
  }
}
