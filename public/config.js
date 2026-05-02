// Configuration for Frontend
(function initFrontendConfig(global) {
  const LOCAL_BACKEND_PORT = "5000";
  const DEFAULT_LOCAL_BACKEND_URL = `http://localhost:${LOCAL_BACKEND_PORT}`;
  const PROD_BACKEND_URL = "https://tirth-sutra-backend.onrender.com";
  const BACKEND_OVERRIDE_STORAGE_KEY = "ts_backend_url_override";

  function normalizeBackendUrl(value) {
    if (!value || typeof value !== "string") return "";
    return value.trim().replace(/\/+$/, "");
  }

  function isLoopbackHost(hostname = "") {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  }

  function isPrivateIpv4(hostname = "") {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      return false;
    }

    const [first, second] = hostname.split(".").map((part) => Number(part));
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  function isLikelyLanHost(hostname = "") {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    return (
      isLoopbackHost(lower) ||
      isPrivateIpv4(lower) ||
      lower.endsWith(".local") ||
      lower.endsWith(".lan") ||
      (!lower.includes(".") && /^[a-z0-9-]+$/.test(lower))
    );
  }

  function getLocationObject() {
    return global.location || { protocol: "http:", hostname: "" };
  }

  function isLocalDevContext() {
    const location = getLocationObject();
    if (location.protocol === "file:") {
      return true;
    }

    return isLikelyLanHost(location.hostname);
  }

  function buildLocalBackendUrl() {
    const location = getLocationObject();
    const hostname = location.hostname || "localhost";

    if (!hostname || location.protocol === "file:") {
      return DEFAULT_LOCAL_BACKEND_URL;
    }

    return `http://${hostname}:${LOCAL_BACKEND_PORT}`;
  }

  function readStoredOverride() {
    try {
      return normalizeBackendUrl(global.localStorage?.getItem(BACKEND_OVERRIDE_STORAGE_KEY));
    } catch {
      return "";
    }
  }

  function persistOverride(value) {
    try {
      if (!value) {
        global.localStorage?.removeItem(BACKEND_OVERRIDE_STORAGE_KEY);
      } else {
        global.localStorage?.setItem(BACKEND_OVERRIDE_STORAGE_KEY, value);
      }
    } catch {
      // Ignore storage issues and fall back to defaults.
    }
  }

  function getQueryOverride() {
    try {
      const params = new URLSearchParams(global.location.search || "");
      const raw = params.get("backend");
      if (!raw) return "";
      const normalized = normalizeBackendUrl(raw);
      if (normalized) {
        persistOverride(normalized);
      }
      return normalized;
    } catch {
      return "";
    }
  }

  function resolveConfiguredBackendUrl() {
    const queryOverride = getQueryOverride();
    if (queryOverride) return queryOverride;

    const storedOverride = readStoredOverride();
    if (storedOverride) return storedOverride;

    return isLocalDevContext() ? buildLocalBackendUrl() : PROD_BACKEND_URL;
  }

  const configuredBackendUrl = normalizeBackendUrl(resolveConfiguredBackendUrl());

  global.CONFIG = {
    BACKEND_URL: configuredBackendUrl,
  };

  global.getBackendBaseUrl = function getBackendBaseUrl() {
    const configured = normalizeBackendUrl(global.CONFIG && global.CONFIG.BACKEND_URL);
    return configured || resolveConfiguredBackendUrl();
  };

  global.setBackendBaseUrlOverride = function setBackendBaseUrlOverride(value) {
    const normalized = normalizeBackendUrl(value);
    persistOverride(normalized);
    if (global.CONFIG) {
      global.CONFIG.BACKEND_URL = normalized || resolveConfiguredBackendUrl();
    }
    return global.getBackendBaseUrl();
  };

  global.clearBackendBaseUrlOverride = function clearBackendBaseUrlOverride() {
    persistOverride("");
    if (global.CONFIG) {
      global.CONFIG.BACKEND_URL = resolveConfiguredBackendUrl();
    }
    return global.getBackendBaseUrl();
  };

  global.getBackendDebugInfo = function getBackendDebugInfo() {
    const location = getLocationObject();
    return {
      frontendOrigin: location.origin || `${location.protocol}//${location.host || ""}`,
      frontendProtocol: location.protocol,
      frontendHostname: location.hostname,
      backendBaseUrl: global.getBackendBaseUrl(),
      usingLocalDevBackend: isLocalDevContext(),
      storedOverride: readStoredOverride(),
    };
  };
})(window);
