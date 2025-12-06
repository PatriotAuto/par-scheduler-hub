// auth.js - shared auth & API helpers for Patriot Scheduler

// Main backend URL (Google Apps Script web app)
const API_URL = 'https://script.google.com/macros/s/AKfycbw-g4GC3jVfLUc6RVkPfC5lbNCPHAeH9k-5JkdRnOwvk_vr0Q5ErmMAuTUrZl8r70mK/exec';

// ====== SHARED AUTH HELPERS ======
const PS_TOKEN_KEY = 'ps_token';
const PS_USER_KEY = 'ps_user';
const LOGIN_PAGE = 'login.html';

function getStoredToken() {
  try {
    return localStorage.getItem(PS_TOKEN_KEY) || '';
  } catch (e) {
    return '';
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

// Generic POST helper: adds action + token; handles auth errors
function apiPost(action, body) {
  if (!ensureLoggedIn()) {
    return Promise.reject('Not logged in');
  }

  const url = withAuthQuery(API_URL + '?action=' + encodeURIComponent(action));

  return fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify(body || {})
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.error === 'AUTH') {
        logoutAndRedirect();
        throw new Error('Unauthorized');
      }
      return data;
    });
}

/**
 * Simple GET helper to call Apps Script without CORS headaches.
 * Sends ?action=...&token=...&extra=params
 */
function apiGet(action, extraParams = {}) {
  const token = getStoredToken ? getStoredToken() : null;

  const search = new URLSearchParams();
  search.set('action', action);
  if (token) {
    search.set('token', token);
  }

  Object.keys(extraParams).forEach((key) => {
    const value = extraParams[key];
    if (value !== undefined && value !== null) {
      search.set(key, value);
    }
  });

  return fetch(API_URL + '?' + search.toString(), {
    method: 'GET'
  }).then((res) => {
    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  });
}
