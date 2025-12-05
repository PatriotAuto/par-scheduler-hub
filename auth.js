// auth.js - shared auth & API helpers for Patriot Scheduler

// Main backend URL (Google Apps Script web app)
const API_URL = 'https://script.google.com/macros/s/AKfycbw-g4GC3jVfLUc6RVkPfC5lbNCPHAeH9k-5JkdRnOwvk_vr0Q5ErmMAuTUrZl8r70mK/exec';

// Storage keys
const PS_TOKEN_KEY = 'ps_auth_token';
const PS_USER_KEY  = 'ps_auth_user';

// Read token from localStorage
function getAuthToken() {
  return localStorage.getItem(PS_TOKEN_KEY);
}

// Read current user from localStorage
function getAuthUser() {
  const raw = localStorage.getItem(PS_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Force user to be logged in; otherwise redirect to login page
function ensureLoggedIn() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = 'login.html';
  }
}

// Clear auth info and send user to login
function logoutAndRedirect() {
  localStorage.removeItem(PS_TOKEN_KEY);
  localStorage.removeItem(PS_USER_KEY);
  window.location.href = 'login.html';
}

// Generic GET helper: adds action, token, params; handles auth errors
function apiGet(action, params) {
  const token = getAuthToken();
  if (!token) {
    logoutAndRedirect();
    return Promise.reject('No auth token');
  }

  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', token);

  if (params) {
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) {
        url.searchParams.set(k, params[k]);
      }
    });
  }

  return fetch(url.toString())
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.error === 'AUTH') {
        logoutAndRedirect();
        throw new Error('Unauthorized');
      }
      return data;
    });
}

// Generic POST helper: adds action & token in query, JSON body; handles auth errors
function apiPost(action, body) {
  const token = getAuthToken();
  if (!token) {
    logoutAndRedirect();
    return Promise.reject('No auth token');
  }

  const url = API_URL + '?action=' +
    encodeURIComponent(action) +
    '&token=' + encodeURIComponent(token);

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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
