/**
 * API Client — replaces LocalStorage data layer with real HTTP calls
 * All functions return promises. JWT token is stored in localStorage.
 */
const API = (() => {
  // Use the dynamically configured backend URL
  const BASE = (typeof CONFIG !== "undefined" ? CONFIG.BACKEND_URL : "") + "/api";

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
      const res = await fetch(BASE + path, {
        ...options,
        headers,
      });
      // Read as text first to avoid "Unexpected token" on non-JSON responses
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error("Non-JSON response from", path, ":", text.substring(0, 200));
        throw new Error(res.ok ? "Invalid server response" : `Server error (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    } catch (err) {
      console.error("API error:", path, err.message);
      throw err;
    }
  }

  async function uploadFile(file) {
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(BASE + "/upload", {
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
    async signup(name, handle, email, password, clientUrl) {
      // Server returns {success, message} only — no token issued until email is verified.
      // Do NOT call setToken/setUser here; they would store "undefined" in localStorage.
      const data = await request("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, handle, email, password, clientUrl }),
      });
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

    async resendVerification(email, clientUrl) {
      return request("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email, clientUrl }),
      });
    },

    async googleAuth(token, tokenType = "access_token") {
      const data = await request("/auth/google", {
        method: "POST",
        body: JSON.stringify({ token, tokenType }),
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

    async sendMessage(convId, text) {
      return request(`/messages/${convId}`, {
        method: "POST",
        body: JSON.stringify({ text }),
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

    async addVideoComment(videoId, text) {
      return request(`/videos/${videoId}/comment`, {
        method: "PUT",
        body: JSON.stringify({ text }),
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
