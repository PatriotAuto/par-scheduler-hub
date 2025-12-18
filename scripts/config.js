(function enforceHttps() {
  if (typeof window === "undefined") return;

  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const usingHttp = window.location.protocol === "http:";

  if (usingHttp && !isLocal) {
    const targetUrl = `https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(targetUrl);
  }
})();

const API_BASE_URL = "https://api.patriotautorestyling.com";
window.API_BASE_URL = API_BASE_URL;

console.log("API_BASE_URL =", API_BASE_URL);
