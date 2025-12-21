/* Shared API client with debug logging + safe JSON parsing */
async function fetchJsonDebug(url, options = {}) {
  const token = typeof getStoredToken === "function" ? getStoredToken() : null;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(token && !(options.headers && options.headers.Authorization)
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...(options.headers || {}),
    },
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text(); // read raw first so we can log even on parse failures

  console.log("[API]", url, "status=", res.status, res.statusText, "content-type=", contentType);

  if (!res.ok) {
    console.error("[API] Non-OK response body (first 500 chars):", text.slice(0, 500));
    const err = new Error(`API request failed ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  // Parse JSON safely
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    console.error("[API] Failed to parse JSON. Raw body (first 500 chars):", text.slice(0, 500));
    throw e;
  }
}

/* Normalize list payload shapes into an array */
function normalizeList(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === "object") {
    for (const k of preferredKeys) {
      if (Array.isArray(payload[k])) return payload[k];
    }
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.result)) return payload.result;
    if (Array.isArray(payload.items)) return payload.items;
  }
  return [];
}

/* Normalize "single object" payload shapes */
function normalizeObject(payload, preferredKeys = []) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const k of preferredKeys) {
      if (payload[k] && typeof payload[k] === "object" && !Array.isArray(payload[k])) return payload[k];
    }
  }
  return null;
}

/* Small helper to show empty states without crashing */
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/* Build a full API URL from path or absolute URL */
function buildApiUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = (typeof window !== "undefined" && window.API_BASE_URL) || "";
  if (!base) return pathOrUrl;
  const needsSlash = pathOrUrl && pathOrUrl[0] !== "/";
  return needsSlash ? `${base}/${pathOrUrl}` : `${base}${pathOrUrl}`;
}

/* Fetch a list resource with normalization + logging */
async function fetchListResource(pathOrUrl, label, preferredKeys = []) {
  const url = buildApiUrl(pathOrUrl);
  try {
    const payload = await fetchJsonDebug(url);
    console.log(`${label} raw payload:`, payload);
    const list = normalizeList(payload, preferredKeys);
    if (!Array.isArray(list) || list.length === 0) {
      console.warn(`Normalized empty list for ${label}:`, payload && typeof payload === "object" ? Object.keys(payload) : payload);
    }
    return safeArray(list);
  } catch (err) {
    console.error(`Failed to fetch ${label}:`, err);
    return [];
  }
}
