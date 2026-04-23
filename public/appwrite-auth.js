/**
 * Appwrite Google OAuth bridge.
 * Appwrite owns the Google OAuth session; our backend exchanges the Appwrite JWT
 * for the existing Tirth Sutra API token so the rest of the app stays unchanged.
 */
(function initAppwriteAuthBridge(global) {
  const APPWRITE_AUTH_SOURCE = "appwrite-google";
  const APPWRITE_AUTH_PARAM = "appwriteAuth";
  const APPWRITE_CONFIG = {
    endpoint: "https://nyc.cloud.appwrite.io/v1",
    projectId: "69ea1b4e000d4e4e2b20",
  };

  let appwriteClient = null;
  let appwriteAccount = null;
  let completionPromise = null;

  function getSdk() {
    return global.Appwrite || null;
  }

  function getAccount() {
    const sdk = getSdk();
    if (!sdk?.Client || !sdk?.Account) {
      throw new Error("Appwrite SDK is not loaded yet.");
    }

    if (!appwriteAccount) {
      appwriteClient = new sdk.Client()
        .setEndpoint(APPWRITE_CONFIG.endpoint)
        .setProject(APPWRITE_CONFIG.projectId);
      appwriteAccount = new sdk.Account(appwriteClient);
    }

    return appwriteAccount;
  }

  function getGoogleProvider() {
    const sdk = getSdk();
    return sdk?.OAuthProvider?.Google || sdk?.OAuthProvider?.GOOGLE || "google";
  }

  function getCleanAppUrl() {
    const url = new URL(global.location.href);
    url.hash = "";
    url.search = "";
    return url;
  }

  function getActiveReferralCode() {
    if (typeof global.getActiveReferralCode === "function") {
      return global.getActiveReferralCode() || "";
    }
    return new URLSearchParams(global.location.search || "").get("ref") || "";
  }

  function getMarketingConsent() {
    return (
      !!global.document.getElementById("suMarketingConsent")?.checked ||
      new URLSearchParams(global.location.search || "").get("marketing") === "1"
    );
  }

  function getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    } catch {
      return "Asia/Kolkata";
    }
  }

  function normalizeAuthMode(mode) {
    return mode === "signup" ? "signup" : "login";
  }

  function buildReturnUrl(status, authMode = "login", signupIntent = "") {
    const url = getCleanAppUrl();
    const referralCode = getActiveReferralCode();
    const marketingConsent = getMarketingConsent();

    url.searchParams.set(APPWRITE_AUTH_PARAM, status);
    url.searchParams.set("authSource", APPWRITE_AUTH_SOURCE);
    url.searchParams.set("authMode", normalizeAuthMode(authMode));
    if (signupIntent) {
      url.searchParams.set("signupIntent", signupIntent);
    }

    if (referralCode) {
      url.searchParams.set("ref", referralCode);
    }

    if (marketingConsent) {
      url.searchParams.set("marketing", "1");
      url.searchParams.set("tz", getTimezone());
    }

    return url.toString();
  }

  function readAuthParams() {
    const query = new URLSearchParams(global.location.search || "");
    const rawHash = global.location.hash?.startsWith("#")
      ? global.location.hash.slice(1)
      : "";
    const hash = rawHash ? new URLSearchParams(rawHash) : new URLSearchParams();
    const params = query.get(APPWRITE_AUTH_PARAM) ? query : hash;
    const status = params.get(APPWRITE_AUTH_PARAM);

    if (!status) return null;

    return {
      status,
      authSource: params.get("authSource"),
      referralCode: params.get("ref") || "",
      authMode: normalizeAuthMode(params.get("authMode")),
      signupIntent: params.get("signupIntent") || "",
      marketingConsent: params.get("marketing") === "1",
      timezone: params.get("tz") || getTimezone(),
    };
  }

  function clearAuthParams() {
    const url = new URL(global.location.href);
    [
      APPWRITE_AUTH_PARAM,
      "authSource",
      "authError",
      "authMode",
      "signupIntent",
      "status",
      "marketing",
      "tz",
    ].forEach((key) => url.searchParams.delete(key));

    if (url.hash?.includes(APPWRITE_AUTH_PARAM)) {
      url.hash = "";
    }

    global.history.replaceState(
      null,
      global.document.title,
      url.pathname + (url.search ? url.search : "") + (url.hash || "")
    );
  }

  function stopLoader(loaderToken) {
    if (loaderToken && typeof global.stopAppTopLoader === "function") {
      global.stopAppTopLoader(loaderToken, { delay: 0, minVisible: 120 });
    }
  }

  function getBackendBase() {
    if (typeof global.getBackendBaseUrl === "function") {
      return global.getBackendBaseUrl();
    }

    if (global.CONFIG?.BACKEND_URL) {
      return String(global.CONFIG.BACKEND_URL).replace(/\/+$/, "");
    }

    const isLocal =
      global.location.hostname === "localhost" ||
      global.location.hostname === "127.0.0.1";
    return isLocal ? "http://localhost:5000" : "https://tirth-sutra-backend.onrender.com";
  }

  function saveBackendSession(data) {
    if (!data?.token || !data?.user) return;

    if (typeof global.API?.setToken === "function") {
      global.API.setToken(data.token);
    } else {
      global.localStorage?.setItem("ts_token", data.token);
    }

    if (typeof global.API?.setUser === "function") {
      global.API.setUser(data.user);
    } else {
      global.localStorage?.setItem("ts_currentUser", JSON.stringify(data.user));
    }
  }

  async function createSignupIntent(authMode) {
    if (normalizeAuthMode(authMode) !== "signup") return "";

    const response = await fetch(`${getBackendBase()}/api/auth/appwrite/google-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authMode: "signup" }),
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Invalid server response while starting Google signup.");
    }

    if (!response.ok || !data?.intentToken) {
      throw new Error(data?.error || "Could not start secure Google signup.");
    }

    return data.intentToken;
  }

  async function exchangeAppwriteJwt(appwriteJwt, authParams) {
    if (typeof global.API?.appwriteGoogleAuth === "function") {
      return global.API.appwriteGoogleAuth(
        appwriteJwt,
        authParams.referralCode,
        authParams.authMode,
        authParams.signupIntent,
        authParams.marketingConsent,
        authParams.timezone
      );
    }

    const response = await fetch(`${getBackendBase()}/api/auth/appwrite/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jwt: appwriteJwt,
        referralCode: authParams.referralCode,
        authMode: authParams.authMode,
        signupIntent: authParams.signupIntent,
        marketingConsent: authParams.marketingConsent,
        timezone: authParams.timezone,
      }),
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Invalid server response while finishing Google Sign-In.");
    }

    if (!response.ok) {
      const err = new Error(data?.error || "Could not finish Google Sign-In.");
      err.details = data?.details || null;
      throw err;
    }

    saveBackendSession(data);
    return data;
  }

  async function startGoogleAuth(authMode = "login") {
    const safeAuthMode = normalizeAuthMode(authMode);
    const loaderToken =
      typeof global.startAppTopLoader === "function"
        ? global.startAppTopLoader({ initialProgress: 0.22 })
        : "";

    try {
      const account = getAccount();
      const signupIntent = await createSignupIntent(safeAuthMode);
      const request = {
        provider: getGoogleProvider(),
        success: buildReturnUrl("success", safeAuthMode, signupIntent),
        failure: buildReturnUrl("failure", safeAuthMode, signupIntent),
        scopes: ["openid", "email", "profile"],
      };

      const result = account.createOAuth2Session(request);
      if (result && typeof result.catch === "function") {
        result.catch((error) => {
          stopLoader(loaderToken);
          if (typeof global.MC !== "undefined") {
            global.MC.error(error.message || "Could not start Google Sign-In.");
          }
        });
      }
    } catch (error) {
      stopLoader(loaderToken);
      if (typeof global.MC !== "undefined") {
        global.MC.error(error.message || "Could not start Google Sign-In.");
      }
    }
  }

  async function consumePendingAppwriteAuth() {
    const authParams = readAuthParams();
    if (!authParams) return null;

    if (completionPromise) return completionPromise;

    completionPromise = (async () => {
      if (authParams.status !== "success") {
        clearAuthParams();
        return {
          authError: "Google Sign-In was canceled or failed.",
          authSource: APPWRITE_AUTH_SOURCE,
        };
      }

      try {
        const account = getAccount();
        const jwtResult = await account.createJWT();
        const appwriteJwt = jwtResult?.jwt;
        if (!appwriteJwt) {
          throw new Error("Appwrite did not return a session JWT.");
        }

        const data = await exchangeAppwriteJwt(appwriteJwt, authParams);

        clearAuthParams();
        return {
          ...data,
          authSource: APPWRITE_AUTH_SOURCE,
        };
      } catch (error) {
        clearAuthParams();
        return {
          authError:
            error.message ||
            "Could not finish Google Sign-In. Please try again.",
          authDetails: error.details || null,
          authMode: authParams.authMode,
          authSource: APPWRITE_AUTH_SOURCE,
        };
      }
    })();

    return completionPromise;
  }

  global.startAppwriteGoogleAuth = startGoogleAuth;
  global.consumePendingAppwriteAuth = consumePendingAppwriteAuth;
  global.APPWRITE_AUTH_CONFIG = { ...APPWRITE_CONFIG };
})(window);
