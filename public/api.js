/**
 * API Client — replaces LocalStorage data layer with real HTTP calls
 * All functions return promises. JWT token is stored in localStorage.
 */
const API = (() => {
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

  async function request(path, options = {}) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }

    try {
      const endpoint = /^https?:\/\//i.test(path) ? path : getApiBase() + path;
      const res = await fetch(endpoint, {
        ...options,
        headers,
      });
      // Read as text first to avoid "Unexpected token" on non-JSON responses
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
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
      console.error("API error:", path, err.message);
      throw err;
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
      timezone = ""
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

    logout() {
      removeToken();
      removeUser();
    },

    // Posts
    async getPosts(tab = "forYou", page = 1) {
      return request(`/posts?tab=${tab}&page=${page}`);
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

    async toggleFollow(userId) {
      return request(`/users/${userId}/follow`, { method: "PUT" });
    },

    async searchUsers(query) {
      return request(`/users/search?q=${encodeURIComponent(query)}`);
    },

    async getAllUsers() {
      return request("/users/all");
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
      return request(`/messages/${convId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
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
    async getVideos(category, tab, page = 1) {
      let q = `?page=${page}`;
      if (category && category !== "All") q += `&category=${category}`;
      if (tab) q += `&tab=${tab}`;
      return request(`/videos${q}`);
    },

    async getVideo(id) {
      return request(`/videos/${id}`);
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

    // Upload
    uploadFile,
    uploadBase64,

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
