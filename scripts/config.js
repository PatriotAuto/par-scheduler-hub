(function enforceHttps() {
  if (typeof window === "undefined") return;

  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const usingHttp = window.location.protocol === "http:";

  if (usingHttp && !isLocal) {
    const targetUrl = `https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(targetUrl);
  }
})();

function resolveApiBaseUrl() {
  if (typeof window === "undefined") return "https://api.patriotautorestyling.com";

  const hostname = window.location.hostname;
  const isLocal = ["localhost", "127.0.0.1"].includes(hostname);

  // When served from the production domain, use a same-origin "/api" path so we
  // avoid cross-origin requests that are blocked by CORS policy.
  if (!isLocal && hostname.endsWith("patriotautorestyling.com")) {
    return `${window.location.origin}/api`;
  }

  return "https://api.patriotautorestyling.com";
}

const API_BASE_URL = resolveApiBaseUrl();
window.API_BASE_URL = API_BASE_URL;

console.log("API_BASE_URL =", API_BASE_URL);
