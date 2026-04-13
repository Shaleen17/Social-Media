// Configuration for Frontend
(function initFrontendConfig(global) {
  const LOCAL_BACKEND_URL = "http://localhost:5000";
  const PROD_BACKEND_URL = "https://tirth-sutra-backend.onrender.com";

  function isLocalHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  function normalizeBackendUrl(value) {
    if (!value || typeof value !== "string") return "";
    return value.replace(/\/+$/, "");
  }

  function getDefaultBackendUrl() {
    return isLocalHost(global.location.hostname)
      ? LOCAL_BACKEND_URL
      : PROD_BACKEND_URL;
  }

  const configuredBackendUrl = normalizeBackendUrl(getDefaultBackendUrl());

  global.CONFIG = {
    BACKEND_URL: configuredBackendUrl,
  };

  global.getBackendBaseUrl = function getBackendBaseUrl() {
    const configured = normalizeBackendUrl(global.CONFIG && global.CONFIG.BACKEND_URL);
    return configured || getDefaultBackendUrl();
  };
})(window);
