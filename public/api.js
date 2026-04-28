/**
 * API Client — replaces LocalStorage data layer with real HTTP calls
 * All functions return promises. JWT token is stored in localStorage.
 */
const API = (() => {
  const PENDING_CHAT_QUEUE_KEY = "ts_pending_chat_messages";
  const MAX_PENDING_CHAT_MESSAGES = 40;
  const CSRF_COOKIE_NAME = "ts_csrf";
  let csrfBootstrapPromise = null;

  function getBackendBase() {
    if (typeof window.getBackendBaseUrl === "function") {
      return window.getBackendBaseUrl();
    }

    if (typeof CONFIG !== "undefined" && CONFIG && CONFIG.BACKEND_URL) {
      return String(CONFIG.BACKEND_URL).replace(/\/+$/, "");
    }

    return window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      : "https://tirth-sutra-backend.onrender.com";
  }

  function getApiBase() {
    return getBackendBase() + "/api";
  }

  function getSameOriginApiBase() {
    if (!window.location || window.location.protocol === "file:") {
      return "";
    }

    return window.location.origin.replace(/\/+$/, "") + "/api";
  }

  function getToken() {
    return localStorage.getItem("ts_token");
  }

  function setToken(token) {
    localStorage.setItem("ts_token", token);
  }

  function removeToken() {
    localStorage.removeItem("ts_token");
  }

  function setUser(user) {
    localStorage.setItem("ts_currentUser", JSON.stringify(user));
  }

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem("ts_currentUser"));
    } catch {
      return null;
    }
  }

  function removeUser() {
    localStorage.removeItem("ts_currentUser");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getCookie(name) {
    const needle = `${name}=`;
    return document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(needle))
      ?.slice(needle.length) || "";
  }

  async function ensureCsrfToken() {
    const existing = getCookie(CSRF_COOKIE_NAME);
    if (existing) return existing;
    if (csrfBootstrapPromise) return csrfBootstrapPromise;

    csrfBootstrapPromise = fetch(getApiBase() + "/auth/csrf", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    })
      .then(async (res) => {
        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {}
        if (!res.ok) {
          throw new Error(data.error || "Could not initialize security token");
        }
        return data.csrfToken || getCookie(CSRF_COOKIE_NAME) || "";
      })
      .finally(() => {
        csrfBootstrapPromise = null;
      });

    return csrfBootstrapPromise;
  }

  function dispatchBrowserEvent(name, detail) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {}
  }

  function readPendingChatQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_CHAT_QUEUE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writePendingChatQueue(entries) {
    const safeEntries = Array.isArray(entries)
      ? entries.slice(-MAX_PENDING_CHAT_MESSAGES)
      : [];
    localStorage.setItem(PENDING_CHAT_QUEUE_KEY, JSON.stringify(safeEntries));
    return safeEntries;
  }

  function makeClientMessageId() {
    return [
      "msg",
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 10),
    ].join("_");
  }

  function isRetriableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  function shouldQueueChatMessage(err) {
    if (!err) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    return !err.status || err.status >= 500 || err.name === "AbortError";
  }

  function enqueuePendingChatMessage(convId, payload) {
    if (!convId || !payload) return null;
    const clientId = payload.clientId || makeClientMessageId();
    const queue = readPendingChatQueue().filter(
      (item) => (item?.payload?.clientId || item?.clientId) !== clientId
    );
    const entry = {
      convId,
      clientId,
      payload: { ...payload, clientId },
      queuedAt: Date.now(),
    };
    writePendingChatQueue([...queue, entry]);
    dispatchBrowserEvent("ts:pending-message-queued", entry);
    return entry;
  }

  async function flushPendingChatMessages() {
    const queue = readPendingChatQueue();
    if (!queue.length || !getToken()) return [];

    const sent = [];
    const remaining = [];

    for (const entry of queue) {
      try {
        const message = await request(`/messages/${entry.convId}`, {
          method: "POST",
          body: JSON.stringify(entry.payload),
          retry: 1,
          retryDelayMs: 500,
          timeoutMs: 15000,
        });
        sent.push({ convId: entry.convId, clientId: entry.clientId, message });
        dispatchBrowserEvent("ts:pending-message-sent", {
          convId: entry.convId,
          clientId: entry.clientId,
          message,
        });
      } catch (err) {
        if (shouldQueueChatMessage(err)) {
          remaining.push(entry);
        } else {
          dispatchBrowserEvent("ts:pending-message-failed", {
            convId: entry.convId,
            clientId: entry.clientId,
            error: err,
          });
        }
      }
    }

    writePendingChatQueue(remaining);
    if (sent.length) {
      dispatchBrowserEvent("ts:pending-message-flush", {
        sent,
        remaining: remaining.length,
      });
    }
    return sent;
  }

  async function request(path, options = {}) {
    const token = getToken();
    const {
      retry = 0,
      retryDelayMs = 650,
      timeoutMs = 0,
      ...fetchOptions
    } = options || {};
    const method = String(fetchOptions.method || "GET").toUpperCase();
    const headers = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    };
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      !headers["x-csrf-token"] &&
      !headers["X-CSRF-Token"]
    ) {
      const csrfToken = await ensureCsrfToken().catch(() => "");
      if (csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }
    }

    const endpoint = /^https?:\/\//i.test(path) ? path : getApiBase() + path;

    for (let attempt = 0; attempt <= retry; attempt += 1) {
      let timeoutHandle = null;
      try {
        const controller =
          timeoutMs > 0 && typeof AbortController !== "undefined"
            ? new AbortController()
            : null;
        if (controller) {
          timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
        }

        const res = await fetch(endpoint, {
          ...fetchOptions,
          headers,
          credentials: "include",
          ...(controller ? { signal: controller.signal } : {}),
        });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          console.error("Non-JSON response from", endpoint, ":", text.substring(0, 200));
          const error = new Error(res.ok ? "Invalid server response" : `Server error (${res.status})`);
          error.status = res.status;
          error.responseText = text;
          throw error;
        }
        if (!res.ok) {
          const error = new Error(data.error || "Request failed");
          error.status = res.status;
          error.details = data.details || null;
          error.data = data;
          throw error;
        }
        return data;
      } catch (err) {
        const canRetry =
          attempt < retry &&
          (isRetriableStatus(Number(err?.status)) ||
            err?.name === "AbortError" ||
            !err?.status);

        if (canRetry) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }

        console.error("API error:", path, err.message);
        throw err;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }
  }

  function isRouteMissingError(err) {
    return Boolean(err && (err.status === 404 || /\b404\b/.test(err.message || "")));
  }

  async function requestWithRouteFallback(paths, options = {}) {
    let lastError;
    for (const path of paths.filter(Boolean)) {
      try {
        return await request(path, options);
      } catch (err) {
        lastError = err;
        if (!isRouteMissingError(err)) {
          throw err;
        }
      }
    }
    throw lastError;
  }

  function mergeUniqueById(existing, incoming) {
    const map = new Map();
    [...(existing || []), ...(incoming || [])].forEach((item) => {
      const key = (item?.id || item?._id || "").toString();
      if (!key) return;
      map.set(key, { ...(map.get(key) || {}), ...(item || {}) });
    });
    return Array.from(map.values());
  }

  async function fetchAllPagedResults(fetchPage, options = {}) {
    const pageSize = Math.max(1, Number(options.pageSize) || 50);
    const maxPages = Math.max(1, Number(options.maxPages) || 50);
    let page = 1;
    let combined = [];

    while (page <= maxPages) {
      let items;
      try {
        items = await fetchPage(page, pageSize);
      } catch (err) {
        if (combined.length) break;
        throw err;
      }
      const list = Array.isArray(items) ? items : [];
      if (!list.length) break;
      combined = mergeUniqueById(combined, list);
      if (list.length < pageSize) break;
      page += 1;
    }

    return combined;
  }

  async function uploadFile(file) {
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(getApiBase() + "/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
      },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  }

  async function uploadBase64(data64, folder) {
    return request("/upload/base64", {
      method: "POST",
      body: JSON.stringify({ data: data64, folder }),
    });
  }

  return {
    getToken,
    setToken,
    removeToken,
    setUser,
    getStoredUser,
    removeUser,

    // Auth
    async signup(
      name,
      handle,
      email,
      password,
      referralCode = "",
      marketingConsent = false,
      timezone = ""
    ) {
      const data = await request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name,
          handle,
          email,
          password,
          referralCode,
          marketingConsent,
          timezone,
        }),
      });
      return data;
    },

    async verifySignupOtp(email, otp) {
      const data = await request("/auth/verify-signup-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp }),
      });
      setToken(data.token);
      setUser(data.user);
      return data;
    },

    async login(email, password) {
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      setUser(data.user);
      return data;
    },

    async resendSignupOtp(email) {
      return request("/auth/resend-signup-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },

    async requestPasswordReset(email) {
      const sameOriginApi = getSameOriginApiBase();
      return requestWithRouteFallback([
        "/auth/forgot-password",
        "/auth/password/forgot",
        sameOriginApi && `${sameOriginApi}/auth/forgot-password`,
        sameOriginApi && `${sameOriginApi}/auth/password/forgot`,
      ], {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },

    async resetPassword(email, otp, password) {
      const sameOriginApi = getSameOriginApiBase();
      return requestWithRouteFallback([
        "/auth/reset-password",
        "/auth/password/reset",
        sameOriginApi && `${sameOriginApi}/auth/reset-password`,
        sameOriginApi && `${sameOriginApi}/auth/password/reset`,
      ], {
        method: "POST",
        body: JSON.stringify({ email, otp, password }),
      });
    },

    async googleAuth(
      token,
      tokenType = "access_token",
      referralCode = "",
      marketingConsent = false,
      timezone = ""
    ) {
      const data = await request("/auth/google", {
        method: "POST",
        body: JSON.stringify({
          token,
          tokenType,
          referralCode,
          marketingConsent,
          timezone,
        }),
      });
      setToken(data.token);
      setUser(data.user);
      return data;
    },

    async appwriteGoogleAuth(
      jwt,
      referralCode = "",
      authMode = "login",
      signupIntent = "",
      marketingConsent = false,
      timezone = "",
      provider = "google"
    ) {
      const data = await request("/auth/appwrite/google", {
        method: "POST",
        body: JSON.stringify({
          jwt,
          referralCode,
          authMode,
          signupIntent,
          marketingConsent,
          timezone,
          provider,
        }),
      });
      setToken(data.token);
      setUser(data.user);
      return data;
    },

    async getMe() {
      const data = await request("/auth/me");
      setUser(data.user);
      return data.user;
    },

    async getCsrfToken() {
      return ensureCsrfToken();
    },

    async logoutRemote() {
      try {
        await request("/auth/logout", {
          method: "POST",
          body: JSON.stringify({}),
        });
      } catch {}
    },

    logout() {
      this.logoutRemote().catch(() => {});
      removeToken();
      removeUser();
    },

    // Posts
    async getPosts(tab = "forYou", page = 1, limit) {
      const params = new URLSearchParams();
      if (tab) params.set("tab", tab);
      params.set("page", String(page || 1));
      if (limit) params.set("limit", String(limit));
      return request(`/posts?${params.toString()}`);
    },

    async getAllPosts(tab = "forYou") {
      return fetchAllPagedResults(
        (page, pageSize) => this.getPosts(tab, page, pageSize),
        {
          pageSize: 50,
          maxPages: 80,
        }
      );
    },

    async getPost(id) {
      return request(`/posts/${id}`);
    },

    async createPost(text, image, ytId, poll) {
      return request("/posts", {
        method: "POST",
        body: JSON.stringify({ text, image, ytId, poll }),
      });
    },

    async toggleLike(postId) {
      return request(`/posts/${postId}/like`, { method: "PUT" });
    },

    async addComment(postId, text) {
      return request(`/posts/${postId}/comment`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      });
    },

    async toggleRepost(postId) {
      return request(`/posts/${postId}/repost`, { method: "PUT" });
    },

    async toggleBookmark(postId) {
      return request(`/posts/${postId}/bookmark`, { method: "PUT" });
    },

    async castVote(postId, option) {
      return request(`/posts/${postId}/vote`, {
        method: "PUT",
        body: JSON.stringify({ option }),
      });
    },

    async deletePost(postId) {
      return request(`/posts/${postId}`, { method: "DELETE" });
    },

    async getBookmarkedPosts() {
      return request("/posts/bookmarked/me");
    },

    // Users
    async getUser(id) {
      return request(`/users/${id}`);
    },

    async updateUser(id, data) {
      const result = await request(`/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      // Update stored user if it's the current user
      const stored = getStoredUser();
      if (stored && stored.id === id) {
        setUser({ ...stored, ...data });
      }
      return result;
    },

    async exportMyData() {
      const token = getToken();
      const headers = {};
      if (token) headers.Authorization = "Bearer " + token;
      const csrfToken = await ensureCsrfToken().catch(() => "");
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const res = await fetch(getApiBase() + "/users/account/export", {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not export your data");
      }
      return res.json();
    },

    async deleteMyAccount(confirmation = "DELETE") {
      return request("/users/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
    },

    async toggleFollow(userId) {
      return request(`/users/${userId}/follow`, { method: "PUT" });
    },

    async searchUsers(query) {
      return request(`/users/search?q=${encodeURIComponent(query)}`);
    },

    async getAllUsers() {
      return fetchAllPagedResults(
        (page, pageSize) => request(`/users/all?page=${page}&limit=${pageSize}`),
        {
          pageSize: 100,
          maxPages: 50,
        }
      );
    },

    async getBootstrapFeed() {
      return request("/bootstrap/feed", {
        retry: 1,
        retryDelayMs: 500,
        timeoutMs: 30000,
      });
    },

    async getFollowers(userId) {
      return request(`/users/${userId}/followers`);
    },

    async getFollowing(userId) {
      return request(`/users/${userId}/following`);
    },

    // Messages
    async getConversations() {
      return request("/messages");
    },

    async getMessages(convId) {
      return request(`/messages/${convId}`);
    },

    async sendMessage(convId, textOrPayload, extra = {}) {
      const payload =
        textOrPayload && typeof textOrPayload === "object"
          ? textOrPayload
          : { text: textOrPayload, ...extra };
      const safePayload = {
        ...payload,
        clientId: payload.clientId || makeClientMessageId(),
      };
      try {
        return await request(`/messages/${convId}`, {
          method: "POST",
          body: JSON.stringify(safePayload),
          retry: 2,
          retryDelayMs: 700,
          timeoutMs: 15000,
        });
      } catch (err) {
        if (shouldQueueChatMessage(err)) {
          enqueuePendingChatMessage(convId, safePayload);
          err.queued = true;
          err.clientId = safePayload.clientId;
        }
        throw err;
      }
    },

    async forwardMessage(sourceConvId, messageId, targetConvId) {
      return request("/messages/forward/message", {
        method: "POST",
        body: JSON.stringify({ sourceConvId, messageId, targetConvId }),
      });
    },

    async deleteMessage(convId, messageId, scope = "me") {
      return request(`/messages/${convId}/${messageId}/delete`, {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
    },

    async startConversation(userId) {
      return request(`/messages/new/${userId}`, { method: "POST" });
    },

    async createGroup(name, participants) {
      return request("/messages/group", {
        method: "POST",
        body: JSON.stringify({ name, participants }),
      });
    },

    // Alias for backend-adapter compatibility
    async createGroupChat(name, participants) {
      return this.createGroup(name, participants);
    },

    // Stories
    async getStories() {
      return request("/stories");
    },

    async createStory(type, src, caption, emoji) {
      return request("/stories", {
        method: "POST",
        body: JSON.stringify({ type, src, caption, emoji }),
      });
    },

    async viewStory(storyId) {
      return request(`/stories/${storyId}/view`, { method: "PUT" });
    },

    // Videos
    async getVideos(category, tab, page = 1, limit) {
      const params = new URLSearchParams();
      params.set("page", String(page || 1));
      if (limit) params.set("limit", String(limit));
      if (category && category !== "All") params.set("category", category);
      if (tab) params.set("tab", tab);
      return request(`/videos?${params.toString()}`);
    },

    async getAllVideos(category, tab) {
      return fetchAllPagedResults(
        (page, pageSize) => this.getVideos(category, tab, page, pageSize),
        {
          pageSize: 50,
          maxPages: 60,
        }
      );
    },

    async getVideo(id) {
      return request(`/videos/${id}`);
    },

    async getVideoChannel(userId) {
      return request(`/videos/channel/${userId}`);
    },

    async getVideoStories() {
      return request("/videos/stories");
    },

    async createVideo(data) {
      return request("/videos", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    async toggleVideoLike(videoId) {
      return request(`/videos/${videoId}/like`, { method: "PUT" });
    },

    async toggleVideoDislike(videoId) {
      return request(`/videos/${videoId}/dislike`, { method: "PUT" });
    },

    async addVideoComment(videoId, text) {
      return request(`/videos/${videoId}/comment`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      });
    },

    async addVideoReply(videoId, commentId, text) {
      return request(`/videos/${videoId}/comment/${commentId}/reply`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      });
    },

    async pinVideoComment(videoId, commentId) {
      return request(`/videos/${videoId}/comment/${commentId}/pin`, {
        method: "PUT",
      });
    },

    async viewVideo(videoId) {
      return request(`/videos/${videoId}/view`, { method: "PUT" });
    },

    async startLiveStream(data) {
      return request("/videos/live", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // Notifications
    async getNotifications() {
      return request("/notifications");
    },

    async markNotificationsRead() {
      return request("/notifications/read", { method: "PUT" });
    },

    async getUnreadCount() {
      return request("/notifications/unread-count");
    },

    async searchAll(query, tab = "all", limit = 12) {
      return request(
        `/search?q=${encodeURIComponent(query)}&tab=${encodeURIComponent(tab)}&limit=${encodeURIComponent(limit)}`
      );
    },

    async getTrendingHashtags(limit = 18) {
      return request(`/search/hashtags/trending?limit=${encodeURIComponent(limit)}`);
    },

    // Push subscriptions
    async getPushPublicKey() {
      return request("/push-subscriptions/public-key");
    },

    async savePushSubscription(subscription) {
      return request("/push-subscriptions", {
        method: "POST",
        body: JSON.stringify({ subscription }),
      });
    },

    async deletePushSubscription(endpoint) {
      return request("/push-subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      });
    },

    // Payments
    async createDonationOrder(amount, purpose, name = "", email = "") {
      return request("/payments/razorpay/order", {
        method: "POST",
        body: JSON.stringify({ amount, purpose, name, email }),
      });
    },

    async verifyDonationPayment(paymentPayload) {
      return request("/payments/razorpay/verify", {
        method: "POST",
        body: JSON.stringify(paymentPayload),
      });
    },

    async getDonationDashboard() {
      return request("/payments/donations/dashboard");
    },

    async getDonationHistory() {
      return request("/payments/donations/history");
    },

    // Translation
    async translateTexts(texts, target, source = "auto", format = "text") {
      return request("/translate/batch", {
        method: "POST",
        body: JSON.stringify({ texts, target, source, format }),
      });
    },

    async getTranslationLanguages() {
      return request("/translate/languages");
    },

    async submitSupportReport(payload) {
      return request("/support/report", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    async trackEvent(type, name, meta = {}) {
      return request("/analytics/events", {
        method: "POST",
        body: JSON.stringify({
          type,
          name,
          page: meta.page || "",
          path: meta.path || window.location.pathname || "/",
          sessionId: meta.sessionId || "",
          anonymousId: meta.anonymousId || "",
          meta,
        }),
        retry: 1,
        retryDelayMs: 350,
        timeoutMs: 8000,
      });
    },

    // Upload
    uploadFile,
    uploadBase64,
    flushPendingChatMessages,
    getPendingChatMessages: readPendingChatQueue,

    // Mandir Community
    async getMandirPosts(mandirId, page = 1) {
      return request(`/mandir/${mandirId}/posts?page=${page}`);
    },

    async createMandirPost(mandirId, text, image, video) {
      return request(`/mandir/${mandirId}/posts`, {
        method: "POST",
        body: JSON.stringify({ text, image, video }),
      });
    },

    async toggleMandirLike(mandirId, postId) {
      return request(`/mandir/${mandirId}/posts/${postId}/like`, {
        method: "PUT",
      });
    },

    async addMandirComment(mandirId, postId, text) {
      return request(`/mandir/${mandirId}/posts/${postId}/comment`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      });
    },

    async deleteMandirPost(mandirId, postId) {
      return request(`/mandir/${mandirId}/posts/${postId}`, {
        method: "DELETE",
      });
    },
  };
})();
