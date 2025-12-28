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

  // In production we want to talk directly to the API domain. Some of the
  // static hosting environments under *.patriotautorestyling.com (e.g.
  // parhub.patriotautorestyling.com) don't proxy "/api" routes, which leads to
  // 405 responses when we try to POST to endpoints like /auth/login. Always use
  // the dedicated API host instead of relying on same-origin routing.
  if (!isLocal && hostname.endsWith("patriotautorestyling.com")) {
    return "https://api.patriotautorestyling.com";
  }

  return "https://api.patriotautorestyling.com";
}

const API_BASE_URL = resolveApiBaseUrl();
window.API_BASE_URL = API_BASE_URL;

console.log("API_BASE_URL =", API_BASE_URL);
