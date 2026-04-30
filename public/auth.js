(function initAuthSupport(global) {
  "use strict";

  const LEGACY_TOKEN_KEY = "ts_token";
  const SESSION_HINT_KEY = "ts_session";
  const USER_KEY = "ts_currentUser";

  function clearLegacyTokenArtifacts() {
    try {
      global.localStorage?.removeItem(LEGACY_TOKEN_KEY);
    } catch {}
  }

  function hasStoredSession() {
    try {
      return !!(
        global.localStorage?.getItem(SESSION_HINT_KEY) ||
        global.localStorage?.getItem(USER_KEY)
      );
    } catch {
      return false;
    }
  }

  function clearStoredSession() {
    try {
      global.localStorage?.removeItem(SESSION_HINT_KEY);
      global.localStorage?.removeItem(LEGACY_TOKEN_KEY);
      global.localStorage?.removeItem(USER_KEY);
    } catch {}
  }

  global.TSAuthSupport = {
    clearLegacyTokenArtifacts,
    clearStoredSession,
    hasStoredSession,
  };
})(window);
