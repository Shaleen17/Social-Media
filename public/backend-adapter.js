/**
 * Backend Adapter — Monkey-patches the original Script.js functions
 * to use the real backend API instead of LocalStorage.
 *
 * This file loads AFTER Script.js, api.js, and socket-client.js.
 * It overrides specific functions to wire them to the backend,
 * keeping all UI logic and rendering functions intact.
 */

(function () {
  "use strict";

  // =============================================
  // CACHE: In-memory cache of data from the API
  // =============================================
  let _cachedUsers = [];
  let _cachedPosts = [];
  let _cachedVideos = [];
  let _cachedLiveStreams = [];
  let _cachedVidStories = [];
  let _dataLoaded = false;

  function getAppBaseUrl() {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
    }
    return url.toString();
  }

  function consumeAuthRedirectHash() {
    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const params = rawHash
      ? new URLSearchParams(rawHash)
      : new URLSearchParams(window.location.search);
    const authToken = params.get("authToken");
    const authError = params.get("authError");
    const authSource = params.get("authSource");
    const status = params.get("status");

    if (!authToken && !authError && !status) {
      return null;
    }

    history.replaceState(
      null,
      document.title,
      window.location.pathname
    );

    return {
      authToken,
      authError,
      authSource,
      status,
      verified: params.get("verified"),
    };
  }

  function consumeOpenChatParam() {
    const url = new URL(window.location.href);
    const convId = url.searchParams.get("openChat");
    if (!convId) return "";
    url.searchParams.delete("openChat");
    history.replaceState(null, document.title, url.toString());
    return convId;
  }

  let _chatPushSetupPromise = null;
  let _pendingOpenChatId = consumeOpenChatParam();

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function disableChatPushNotifications() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) return;
      await API.deletePushSubscription(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    } catch {}
  }

  async function ensureChatPushNotifications(askPermission) {
    if (
      _chatPushSetupPromise &&
      (Notification.permission === "granted" || !askPermission)
    ) {
      return _chatPushSetupPromise;
    }

    if (
      !CU ||
      !API.getToken() ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return null;
    }

    _chatPushSetupPromise = (async () => {
      let permission = Notification.permission;
      if (permission === "default" && askPermission) {
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") return null;

      const reg = await navigator.serviceWorker.register("/sw.js");
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await API.savePushSubscription(existing.toJSON()).catch(() => {});
        return existing;
      }

      const { publicKey } = await API.getPushPublicKey();
      if (!publicKey) return null;

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await API.savePushSubscription(subscription.toJSON());
      return subscription;
    })();

    try {
      return await _chatPushSetupPromise;
    } catch (err) {
      console.warn("Push setup skipped:", err.message);
      _chatPushSetupPromise = null;
      return null;
    }
  }

  function openPendingChatIfNeeded() {
    const convId = _pendingOpenChatId;
    if (!convId || !CU) return;
    _pendingOpenChatId = "";
    gp("chats");
    setTimeout(() => {
      loadConversations().then(() => {
        openChatWindow(convId).catch(() => {});
      });
    }, 160);
  }

  // =============================================
  // Override getUsers/getPosts/etc to use cache
  // =============================================
  window.getUsers = function () {
    return _cachedUsers;
  };
  window.getPosts = function () {
    return _cachedPosts;
  };
  window.getVideos = function () {
    return _cachedVideos;
  };
  window.getLiveStreams = function () {
    return _cachedLiveStreams;
  };
  window.getVidStories = function () {
    return _cachedVidStories;
  };

  window.getUser = function (id) {
    if (!id) return null;
    const idStr = id.toString();
    return _cachedUsers.find((u) => {
      const uid = (u.id || u._id || "").toString();
      return uid === idStr;
    }) || null;
  };

  window.getPost = function (id) {
    if (!id) return null;
    const idStr = id.toString();
    return _cachedPosts.find((p) => {
      const pid = (p.id || p._id || "").toString();
      return pid === idStr;
    }) || null;
  };

  window.getVideo = function (id) {
    if (!id) return null;
    const idStr = id.toString();
    return _cachedVideos.find((v) => {
      const vid = (v.id || v._id || "").toString();
      return vid === idStr;
    }) || null;
  };

  // =============================================
  // Override seedData — load from API instead
  // =============================================
  window.seedData = function () {
    // No-op — data comes from the database
  };

  // =============================================
  // Override savePost/saveVideo/updateUser
  // =============================================
  window.savePost = function (id, data) {
    const i = _cachedPosts.findIndex(
      (x) => (x.id || x._id || "").toString() === id.toString()
    );
    if (i > -1) Object.assign(_cachedPosts[i], data);
  };

  window.saveVideo = function (id, data) {
    const i = _cachedVideos.findIndex(
      (x) => (x.id || x._id || "").toString() === id.toString()
    );
    if (i > -1) Object.assign(_cachedVideos[i], data);
  };

  window.updateUser = function (id, data) {
    const i = _cachedUsers.findIndex(
      (x) => (x.id || x._id || "").toString() === id.toString()
    );
    if (i > -1) Object.assign(_cachedUsers[i], data);
    if (CU && (CU.id || CU._id || "").toString() === id.toString()) {
      Object.assign(CU, data);
      API.setUser(CU);
    }
    // Also push to backend (fire and forget)
    if (API.getToken()) {
      API.updateUser(id, data).catch(() => {});
    }
  };

  // =============================================
  // Override avHTML for ObjectId compatibility
  // =============================================
  window.avHTML = function (uid, cls) {
    cls = cls || "av40";
    const u = getUser(uid);
    if (!u) return '<div class="av ' + cls + '">?</div>';
    const ini = getIni(u.name);
    return (
      '<div class="av ' +
      cls +
      '">' +
      (u.avatar ? '<img src="' + u.avatar + '" alt="">' : ini) +
      "</div>"
    );
  };

  // =============================================
  // Override Auth (doLogin, doSignup, logout)
  // =============================================
  window.doLogin = async function () {
    const em = (document.getElementById("liEml")?.value || "").trim();
    const pw = document.getElementById("liPw")?.value || "";
    let ok = true;
    const se = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle("show", show);
        el.style.display = show ? "block" : "none";
      }
    };
    se("liEE", !em || !em.includes("@"));
    if (!em || !em.includes("@")) ok = false;
    se("liPE", !pw);
    if (!pw) ok = false;
    if (!ok) return;

    try {
      const data = await API.login(em, pw);
      const e = document.getElementById("liErr");
      const resendBtn = document.getElementById("resendVerificationBtn");
      if (e) e.style.display = "none";
      if (resendBtn) resendBtn.style.display = "none";
      CU = data.user;
      ["liEml", "liPw"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      closeOvl("authOvl");
      // Connect socket
      SocketClient.connect((CU.id || CU._id).toString());
      ensureChatPushNotifications(true).catch(() => {});
      await loadAllData();
      initUI();
      MC.success("Welcome back, " + CU.name.split(" ")[0] + "! 🙏");
      gp("home");
    } catch (err) {
      const e = document.getElementById("liErr");
      const resendBtn = document.getElementById("resendVerificationBtn");
      if (e) {
        e.textContent = "❌ " + (err.message || "Invalid email or password");
        e.style.display = "block";
      }
      if (resendBtn) {
        resendBtn.style.display =
          err?.message && err.message.toLowerCase().includes("verify your email")
            ? "inline-block"
            : "none";
      }
      MC.error(err.message || "Invalid email or password. Please try again.");
    }
  };

  window.doSignup = async function () {
    const nm = (document.getElementById("suNm")?.value || "").trim();
    const em = (document.getElementById("suEml")?.value || "").trim();
    const hdl = (document.getElementById("suHdl")?.value || "")
      .trim()
      .replace("@", "")
      .toLowerCase()
      .replace(/\s+/g, "");
    const pw = document.getElementById("suPw")?.value || "";
    const se = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle("show", show);
        el.style.display = show ? "block" : "none";
      }
    };
    let ok = true;
    se("suNE", !nm);
    if (!nm) ok = false;
    se("suEE", !em || !em.includes("@"));
    if (!em || !em.includes("@")) ok = false;
    se("suHE", !hdl || hdl.length < 3);
    if (!hdl || hdl.length < 3) ok = false;
    se("suPE", !pw || pw.length < 6);
    if (!pw || pw.length < 6) ok = false;
    if (!ok) return;

    try {
      // API.signup() returns {success, message} — NO user/token until email is verified.
      const data = await API.signup(nm, hdl, em, pw, getAppBaseUrl());
      ["suNm", "suEml", "suHdl", "suPw"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      closeOvl("authOvl");
      // Do NOT set CU, connect socket, or call loadAllData here.
      // The user must verify their email before they can log in.
      MC.success(data.message || "Account created! 🧱 Please check your email to verify your account.");
      const loginEmail = document.getElementById("liEml");
      if (loginEmail) loginEmail.value = em;
      authToggle("login");
    } catch (err) {
      const e = document.getElementById("suErr");
      if (e) {
        e.textContent = "❌ " + (err.message || "Signup failed");
        e.style.display = "block";
      }
      MC.error(err.message || "Signup failed.");
    }
  };

  window.logout = function () {
    disableChatPushNotifications().catch(() => {});
    CU = null;
    API.logout();
    SocketClient.disconnect();
    _cachedUsers = [];
    _cachedPosts = [];
    initUI();
    gp("home");
    // Reload data as guest
    loadAllData();
    MC.info("Signed out. Jai Shri Ram 🙏");
  };

  window.resendVerificationEmail = async function () {
    const email =
      (document.getElementById("liEml")?.value || "").trim() ||
      (document.getElementById("suEml")?.value || "").trim();

    if (!email || !email.includes("@")) {
      MC.warn("Enter your email address first so we can resend the verification link.");
      return;
    }

    const resendBtn = document.getElementById("resendVerificationBtn");
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = "Sending verification email...";
    }

    try {
      const data = await API.resendVerification(email, getAppBaseUrl());
      MC.success(data.message || "A new verification email has been sent.");
    } catch (err) {
      MC.error(err.message || "Could not resend the verification email.");
    } finally {
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend verification email";
      }
    }
  };

  window.doGoogleLogin = function () {
    const backendBase = (typeof CONFIG !== "undefined" ? CONFIG.BACKEND_URL : "");
    const returnTo = getAppBaseUrl();
    window.location.href =
      backendBase +
      "/api/auth/google/start?returnTo=" +
      encodeURIComponent(returnTo);
  };

  // =============================================
  // Override toggleLike for API
  // =============================================
  const _origToggleLike = window.toggleLike;
  window.toggleLike = async function (id, btn, e) {
    if (e) e.stopPropagation();
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    try {
      const result = await API.toggleLike(id);
      // Update cache
      const p = getPost(id);
      if (p) p.likes = result.likes;
      const liked = result.liked;
      if (btn) {
        btn.className = "pa" + (liked ? " liked" : "");
        const sv = btn.querySelector("svg");
        if (sv) {
          sv.style.fill = liked ? "#e53935" : "";
          sv.style.stroke = liked ? "#e53935" : "";
        }
      }
      const sp = document.getElementById("lc_" + id);
      if (sp) sp.textContent = result.likes.length;
    } catch (err) {
      // Fallback to original
      _origToggleLike(id, btn, e);
    }
  };

  // =============================================
  // Override submitCmt for API
  // =============================================
  window.submitCmt = async function (id) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    const inp =
      document.getElementById("ci_" + id) ||
      document.getElementById("pdc_" + id);
    const text = inp?.value?.trim() || "";
    if (!text) return;

    try {
      const result = await API.addComment(id, text);
      // Update cache
      const p = getPost(id);
      if (p) {
        p.cmts = p.cmts || [];
        p.cmts.push(result);
      }
      const cm = document.getElementById("cm_" + id);
      if (cm) {
        const d = document.createElement("div");
        d.className = "cmt";
        d.innerHTML =
          avHTML(CU.id || CU._id, "av28") +
          '<div class="cmt-body" style="margin-left:8px"><span class="cmt-name">' +
          CU.name +
          "</span><br>" +
          esc(text) +
          "</div>";
        cm.insertBefore(d, cm.lastElementChild);
      }
      if (inp) inp.value = "";
      MC.success("Reply posted 🙏");
    } catch (err) {
      MC.error("Failed to post comment");
    }
  };

  // =============================================
  // Override toggleRepost/Bookmark for API
  // =============================================
  window.doRepost = async function () {
    if (!CU || !activeRP) return;
    try {
      const result = await API.toggleRepost(activeRP);
      const p = getPost(activeRP);
      if (p) p.reposts = result.reposts;
      MC.success(result.reposted ? "Reposted! 🔁" : "Repost removed");
    } catch {
      MC.error("Repost failed");
    }
    closeRP();
    renderFeed();
  };

  const _origToggleBM = window.toggleBM;
  window.toggleBM = async function (id, btn, e) {
    if (e) e.stopPropagation();
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    try {
      const result = await API.toggleBookmark(id);
      const p = getPost(id);
      if (p) p.bm = result.bookmarks;
      const saved = result.bookmarked;
      if (btn) {
        btn.className = "pa" + (saved ? " saved" : "");
        const sv = btn.querySelector("svg");
        if (sv) {
          sv.style.fill = saved ? "var(--ad)" : "";
          sv.style.stroke = saved ? "var(--ad)" : "";
        }
      }
      MC.info(saved ? "Saved to bookmarks 🔖" : "Removed from bookmarks");
    } catch {
      _origToggleBM(id, btn, e);
    }
  };

  // =============================================
  // Override castVote for API
  // =============================================
  window.castVote = async function (id, opt) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    try {
      const result = await API.castVote(id, opt);
      const p = getPost(id);
      if (p && result.poll) p.poll = result.poll;
      renderFeed();
      MC.success("Vote cast! 🗳");
    } catch (err) {
      MC.error(err.message || "Already voted");
    }
  };

  // =============================================
  // Override submitPost for API
  // =============================================
  window.submitPost = async function () {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    const txt = document.getElementById("compTxt")?.value?.trim() || "";
    if (!txt && !compImg && !compYTId) {
      MC.warn("Please write something or add a YouTube video to share 🙏");
      return;
    }

    let poll = null;
    const pa = document.getElementById("pollArea");
    if (pa && !pa.classList.contains("hide")) {
      const o1 = document.getElementById("p1")?.value?.trim() || "";
      const o2 = document.getElementById("p2")?.value?.trim() || "";
      const o3 = document.getElementById("p3")?.value?.trim() || "";
      if (o1 && o2) poll = { opts: [o1, o2, ...(o3 ? [o3] : [])] };
    }

    // Upload image if present
    let imageUrl = compImg;
    if (compImg && compImg.startsWith("data:")) {
      try {
        const uploadResult = await API.uploadBase64(compImg);
        imageUrl = uploadResult.url;
      } catch {
        // Use data URL as fallback
      }
    }

    try {
      const newPost = await API.createPost(txt, imageUrl, compYTId, poll);
      _cachedPosts.unshift(newPost);

      const ta = document.getElementById("compTxt");
      if (ta) ta.value = "";
      removeCompImg();
      clearYTLink();
      const ytRow = document.getElementById("ytLinkRow");
      if (ytRow) ytRow.classList.add("hide");
      const ytBtn = document.getElementById("ytBtn");
      if (ytBtn) ytBtn.style.color = "";
      document.getElementById("pollArea")?.classList.add("hide");
      document.getElementById("emojiArea")?.classList.add("hide");
      closeOvl("compOvl");
      renderFeed();
      MC.success("Posted! 🙏");
      if (curPage !== "home") gp("home");
    } catch (err) {
      MC.error("Failed to create post: " + err.message);
    }
  };

  // =============================================
  // Override delPost for API
  // =============================================
  window.delPost = async function (id) {
    if (!CU) return;
    try {
      await API.deletePost(id);
      _cachedPosts = _cachedPosts.filter(
        (p) => (p.id || p._id || "").toString() !== id.toString()
      );
      closeMore();
      const el = document.getElementById("pt_" + id);
      if (el) el.remove();
      MC.info("Post deleted");
    } catch {
      MC.error("Failed to delete post");
    }
  };

  // =============================================
  // Override toggleFollow for API
  // =============================================
  window.toggleFollow = async function (uid, btn) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    if (uid === (CU.id || CU._id || "").toString()) return;

    try {
      const result = await API.toggleFollow(uid);
      // Update local state
      CU.following = result.myFollowing;
      API.setUser(CU);

      const tu = getUser(uid);
      if (tu) tu.followers = result.targetFollowers;

      const now = result.following;
      if (btn) {
        btn.textContent = now ? "Following" : "Follow";
        btn.className = "btn btn-sm " + (now ? "btn-w" : "btn-p");
      }
      MC.info(
        now
          ? "Following @" + (tu?.handle || "user") + " 🙏"
          : "Unfollowed"
      );
      renderWidgets();
      if (curProfId === uid) renderProfile(uid);
    } catch {
      MC.error("Failed to follow/unfollow");
    }
  };

  // =============================================
  // Override renderNotifs for API
  // =============================================
  const _origRenderNotifs = window.renderNotifs;
  window.renderNotifs = async function (filter) {
    if (!API.getToken()) {
      _origRenderNotifs(filter);
      return;
    }
    try {
      const notifs = await API.getNotifications();
      const c = document.getElementById("notifsWrap");
      if (!c) return;

      let filtered = notifs;
      if (filter === "mentions")
        filtered = notifs.filter((n) => n.type === "comment");
      if (filter === "pranams")
        filtered = notifs.filter((n) => n.type === "like");

      const icons = {
        like: "❤️",
        comment: "💬",
        repost: "🔁",
        follow: "👤",
      };

      if (!filtered.length) {
        c.innerHTML =
          '<div class="empty"><div class="empty-ico">🔔</div><div class="empty-ttl">No notifications yet</div></div>';
        return;
      }

      c.innerHTML = filtered
        .map((n) => {
          const u = n.sender || {};
          const ini = getIni(u.name || "U");
          const avH = u.avatar
            ? '<img src="' + u.avatar + '" alt="">'
            : ini;
          return (
            '<div class="notif' +
            (n.unread ? " unread" : "") +
            '" onclick="handleNC(\'' +
            (n.pid || "") +
            "','" +
            ((n.from || n.sender?._id || "") + "") +
            "')\">" +
            '<div class="notif-ico" style="background:var(--a)">' +
            (icons[n.type] || "🔔") +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:8px;flex:1">' +
            '<div class="av av36">' +
            avH +
            "</div>" +
            "<div>" +
            '<div class="notif-txt"><strong>' +
            (u.name || "Someone") +
            "</strong> " +
            n.txt +
            "</div>" +
            '<div class="notif-tm">' +
            n.t +
            "</div>" +
            "</div></div></div>"
          );
        })
        .join("");

      // Mark read
      API.markNotificationsRead().catch(() => {});
      const d = document.getElementById("ndot");
      if (d) d.style.display = "none";
      const bd = document.getElementById("bnNotifBadge");
      if (bd) bd.style.display = "none";
    } catch {
      _origRenderNotifs(filter);
    }
  };

  // =============================================
  // Override addNotif — notifications now handled by backend
  // =============================================
  window.addNotif = function () {
    // No-op — the API routes create notifications automatically
  };

  // =============================================
  // Override handleAvUp/handleBanner — upload to Cloudinary
  // =============================================
  window.handleAvUp = async function (e) {
    const f = e.target?.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      const src = ev.target.result;
      const epAv = document.getElementById("epAv");
      if (epAv) epAv.innerHTML = '<img src="' + src + '" alt="">';

      // Try uploading to Cloudinary
      let url = src;
      if (API.getToken()) {
        try {
          const result = await API.uploadBase64(src, "tirth-sutra/avatars");
          url = result.url;
        } catch {}
      }
      updateUser(CU.id || CU._id, { avatar: url });
      syncAvatars();
    };
    r.readAsDataURL(f);
  };

  window.handleBanner = async function (e) {
    const f = e.target?.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      const src = ev.target.result;
      const bi = document.getElementById("epBanner");
      if (bi) {
        bi.src = src;
        bi.style.display = "block";
      }
      let url = src;
      if (API.getToken()) {
        try {
          const result = await API.uploadBase64(src, "tirth-sutra/banners");
          url = result.url;
        } catch {}
      }
      updateUser(CU.id || CU._id, { banner: url });
    };
    r.readAsDataURL(f);
  };

  // =============================================
  // Override saveEP for API
  // =============================================
  window.saveEP = async function () {
    if (!CU) return;
    const nm = document.getElementById("epNm")?.value?.trim() || "";
    if (!nm) {
      MC.error("Name is required");
      return;
    }
    const updates = {
      name: nm,
      bio: document.getElementById("epBio")?.value?.trim() || "",
      location: document.getElementById("epLoc")?.value?.trim() || "",
      website: document.getElementById("epWeb")?.value?.trim() || "",
    };

    updateUser(CU.id || CU._id, updates);
    closeOvl("epOvl");
    renderProfile(CU.id || CU._id);
    syncAvatars();
    MC.success("Profile updated! 🙏");
  };

  // =============================================
  // Override trackVidView for API
  // =============================================
  window.trackVidView = function (id) {
    const v = getVideo(id);
    if (v) v.views = (v.views || 0) + 1;
    if (API.getToken()) {
      API.viewVideo(id).catch(() => {});
    }
  };

  // =============================================
  // Data Loading from Backend
  // =============================================
  async function loadAllData() {
    try {
      const [users, posts, videos] = await Promise.all([
        API.getAllUsers().catch(() => []),
        API.getPosts().catch(() => []),
        API.getVideos().catch(() => []),
      ]);

      _cachedUsers = users || [];
      _cachedPosts = posts || [];

      _cachedVideos = (videos || []).filter((v) => !v.live);
      _cachedLiveStreams = (videos || [])
        .filter((v) => v.live)
        .map((v) => ({
          id: v.id,
          uid: v.uid,
          title: v.title,
          src: v.src,
          viewers: v.viewers || 0,
          started: v.started || "recently",
        }));

      try {
        _cachedVidStories = await API.getVideoStories();
      } catch {
        _cachedVidStories = [];
      }

      _dataLoaded = true;
    } catch (err) {
      console.error("Failed to load data from backend:", err);
    }
  }

  // =============================================
  // Load notification badge count
  // =============================================
  async function checkNotifications() {
    if (!API.getToken()) return;
    try {
      const { count } = await API.getUnreadCount();
      if (count > 0) {
        const d = document.getElementById("ndot");
        if (d) d.style.display = "block";
        const bd = document.getElementById("bnNotifBadge");
        if (bd) bd.style.display = "block";
      }
    } catch {}
  }

  // =============================================
  // ======= REAL-TIME CHAT MODULE =======
  // Overrides all chat functions from Script.js
  // to use backend API + Socket.io
  // =============================================

  // In-memory cache of conversations from the backend
  let _cachedConversations = []; // from GET /api/messages
  let _conversationMessages = {}; // convId -> messages array
  let _currentConvId = null; // currently open conversation
  let _typingIndicatorTimer = null;

  // ── Helper: get userId string ──
  function myId() {
    if (!CU) return "";
    return (CU.id || CU._id || "").toString();
  }

  // ── Helper: format chat timestamp ──
  function fmtChatTs(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // e.g. "Just now"
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }

  function fmtMsgTs(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ── Load conversations from API ──
  async function loadConversations() {
    if (!API.getToken()) return [];
    try {
      _cachedConversations = await API.getConversations();
      return _cachedConversations;
    } catch (err) {
      console.error("Failed to load conversations:", err);
      return [];
    }
  }

  // ── Load messages for a conversation ──
  async function loadMessages(convId) {
    if (!API.getToken() || !convId) return [];
    try {
      const data = await API.getMessages(convId);
      _conversationMessages[convId] = data.messages || [];
      return data;
    } catch (err) {
      console.error("Failed to load messages:", err);
      return { messages: [] };
    }
  }

  // =============================================
  // Override renderChatsPage
  // =============================================
  window.renderChatsPage = async function () {
    if (!CU) {
      const c = document.getElementById("chatsList");
      if (c)
        c.innerHTML =
          '<div class="empty" style="padding:40px 20px"><div class="empty-ico">💬</div><div class="empty-sub">Sign in to chat</div><button class="btn btn-p" style="margin-top:12px" onclick="openOvl(\'authOvl\')">Sign In</button></div>';
      return;
    }
    await loadConversations();
    renderChatsList();
    if (window.innerWidth >= 641) {
      const win = document.getElementById("chatWindow");
      if (win) win.classList.remove("hide");
      const bar = document.getElementById("chatWinBar");
      if (bar) bar.style.display = "none";
      const empty = document.getElementById("chatEmptyState");
      if (empty) {
        empty.style.display = "flex";
        empty.style.flexDirection = "column";
      }
    } else {
      const win = document.getElementById("chatWindow");
      if (win) win.classList.add("hide");
      activeChatId = null;
    }
  };

  // =============================================
  // Override renderChatsList — uses backend data
  // =============================================
  window.renderChatsList = function () {
    const c = document.getElementById("chatsList");
    if (!c) return;

    let items = _cachedConversations.map((conv) => {
      const isGroup = conv.isGroup;
      const uid = conv.uid ? conv.uid.toString() : "";
      const user = conv.user || {};
      const online = uid ? SocketClient.isUserOnline(uid) : false;
      return {
        id: (conv.id || conv._id || "").toString(),
        type: isGroup ? "group" : "direct",
        name: isGroup ? conv.groupName : user.name || "Unknown",
        online: online,
        uid: uid,
        avatar: user.avatar || null,
        verified: user.verified || false,
        lastMsg: conv.lastMessage || "",
        lastTime: conv.lastMessageTime || "",
        unread: conv.unreadCount || 0,
        participants: conv.participants || [],
      };
    });

    // Apply filters
    const q = (
      document.getElementById("chatsSearchIn")?.value || ""
    ).toLowerCase();
    if (chatFilter === "direct") items = items.filter((i) => i.type === "direct");
    if (chatFilter === "groups") items = items.filter((i) => i.type === "group");
    if (chatFilter === "unread") items = items.filter((i) => i.unread > 0);
    if (q) items = items.filter((i) => i.name.toLowerCase().includes(q));

    if (!items.length) {
      c.innerHTML =
        '<div class="empty" style="padding:40px 20px"><div class="empty-ico">💬</div><div class="empty-sub">No chats yet — start a conversation!</div></div>';
      return;
    }

    c.innerHTML = items
      .map((item) => {
        const isActive = item.id === activeChatId;
        const ini = getIni(item.name);
        const avHtml = item.type === "group"
          ? `<div style="width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--pl));display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0">👥</div>`
          : `<div style="width:46px;height:46px;border-radius:50%;overflow:hidden;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:600;flex-shrink:0">${item.avatar ? '<img src="' + item.avatar + '" style="width:100%;height:100%;object-fit:cover">' : ini}</div>`;

        return `<div class="chat-item${isActive ? " active" : ""}" id="ci_${item.id}" onclick="openChatWindow('${item.id}')">
        <div class="chat-item-av">
          ${avHtml}
          ${item.online ? '<div class="chat-item-online" data-online-uid="' + item.uid + '"></div>' : '<div class="chat-item-online" data-online-uid="' + item.uid + '" style="display:none"></div>'}
        </div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <span class="chat-item-name">${esc(item.name)}${item.verified ? " 🔱" : ""} ${item.type === "group" ? '<span class="chat-group-badge">Group</span>' : ""}</span>
            <span class="chat-item-time${item.unread ? " unread-time" : ""}">${item.lastTime}</span>
          </div>
          <div class="chat-item-bottom">
            <span class="chat-item-prev${item.unread ? " bold" : ""}">${esc((item.lastMsg || "Tap to start chatting").substring(0, 55))}</span>
            ${item.unread ? '<span class="chat-unread-badge">' + (item.unread > 9 ? "9+" : item.unread) + "</span>" : ""}
          </div>
        </div>
      </div>`;
      })
      .join("");
  };

  // =============================================
  // Override openChatWindow — loads real messages
  // =============================================
  window.openChatWindow = async function (chatId) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }

    // Leave previous conversation room
    if (_currentConvId && _currentConvId !== chatId) {
      SocketClient.leaveConversation(_currentConvId);
      SocketClient.emitStopTyping(_currentConvId);
    }

    activeChatId = chatId;
    _currentConvId = chatId;

    // Join this conversation's Socket.io room
    SocketClient.joinConversation(chatId);

    // Mark active in UI
    document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));
    const el = document.getElementById("ci_" + chatId);
    if (el) el.classList.add("active");

    // Show chat window
    const win = document.getElementById("chatWindow");
    const bar = document.getElementById("chatWinBar");
    const empty = document.getElementById("chatEmptyState");
    if (win) win.classList.remove("hide");
    if (bar) bar.style.display = "flex";
    if (empty) empty.style.display = "none";

    // On mobile, go fullscreen (hide top/bottom nav)
    if (window.innerWidth < 641) {
      document.body.classList.add('chat-fullscreen');
    }

    // Find conversation info
    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === chatId
    );

    const winAv = document.getElementById("chatWinAv");
    const winName = document.getElementById("chatWinName");
    const winSub = document.getElementById("chatWinSub");

    if (conv?.isGroup) {
      if (winAv)
        winAv.innerHTML =
          '<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--pl));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">👥</div>';
      if (winName) winName.textContent = conv.groupName || "Group";
      if (winSub)
        winSub.textContent = (conv.participants?.length || 0) + " members";
    } else {
      const u = conv?.user || {};
      const uid = conv?.uid ? conv.uid.toString() : "";
      const online = uid ? SocketClient.isUserOnline(uid) : false;
      const ini = getIni(u.name || "U");
      if (winAv)
        winAv.innerHTML = `<div style="width:38px;height:38px;border-radius:50%;overflow:hidden;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:600;flex-shrink:0">${u.avatar ? '<img src="' + u.avatar + '" style="width:100%;height:100%;object-fit:cover">' : ini}</div>`;
      if (winName) winName.textContent = (u.name || "Unknown") + (u.verified ? " 🔱" : "");
      if (winSub) winSub.textContent = online ? "🟢 online" : "last seen recently";
      // Store uid for online status updates
      if (winSub) winSub.setAttribute("data-chat-uid", uid);
    }

    // Load messages from API
    const data = await loadMessages(chatId);
    renderChatMessages(chatId, data.messages || []);

    // Emit read receipt
    SocketClient.emitMessageRead(chatId);

    // Update unread count in list
    if (conv) conv.unreadCount = 0;
    renderChatsList();

    setTimeout(() => document.getElementById("chatMsgInput")?.focus(), 100);
  };

  // =============================================
  // Override renderChatMessages — uses real data
  // =============================================
  window.renderChatMessages = function (chatId, msgs) {
    const c = document.getElementById("chatWinMsgs");
    if (!c) return;

    // If msgs not passed, use cached
    if (!msgs) msgs = _conversationMessages[chatId] || [];

    const conv = _cachedConversations.find(
      (cv) => (cv.id || cv._id || "").toString() === chatId
    );
    const isGroup = conv?.isGroup;

    let html = "";
    let lastDate = "";

    msgs.forEach((m, idx) => {
      // Date separators
      const ts = m.ts || m.t;
      let d;
      try {
        d = new Date(ts);
        if (isNaN(d.getTime())) d = null;
      } catch {
        d = null;
      }

      if (d) {
        const dateStr = d.toDateString();
        if (dateStr !== lastDate) {
          const now = new Date();
          const yest = new Date(now);
          yest.setDate(now.getDate() - 1);
          const label =
            dateStr === now.toDateString()
              ? "Today"
              : dateStr === yest.toDateString()
                ? "Yesterday"
                : d.toLocaleDateString([], {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  });
          html += '<div class="msg-date-sep"><span>' + label + "</span></div>";
          lastDate = dateStr;
        }
      }

      const isOut = m.isMe || (m.from && m.from.toString() === myId());
      const sender = m.sender || {};
      const senderName = sender.name || "Unknown";
      const prev = msgs[idx - 1];
      const showAv = !isOut && isGroup && (!prev || (prev.from?.toString() !== m.from?.toString()));
      const ini = getIni(senderName);

      const avHtml = `<div class="msg-av-small">${sender.avatar ? '<img src="' + sender.avatar + '">' : ini}</div>`;
      const avOrSpacer =
        !isOut && isGroup
          ? showAv
            ? avHtml
            : '<div class="msg-av-placeholder"></div>'
          : "";

      const tickClass = m.read ? "tick-read" : "tick-sent";
      const tickSvg = isOut
        ? `<svg class="msg-tick ${tickClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : "";

      const timeStr = d ? fmtMsgTs(d) : (m.t || "");

      html += `<div class="msg-row ${isOut ? "out" : "in"}">
        ${avOrSpacer}
        <div class="msg-bubble">
          ${showAv ? '<div class="msg-sender-name">' + esc(senderName) + "</div>" : ""}
          ${m.img ? '<img class="msg-bubble-img" src="' + m.img + '" alt="">' : ""}
          ${m.txt ? esc(m.txt) : ""}
          <div class="msg-meta">
            <span class="msg-time">${timeStr}</span>
            ${tickSvg}
          </div>
        </div>
      </div>`;
    });

    c.innerHTML =
      html ||
      '<div class="chat-empty-state"><div style="font-size:36px;margin-bottom:8px">👋</div><div style="font-size:14px;color:var(--t3)">Say hello!</div></div>';

    c.scrollTop = c.scrollHeight;
  };

  // =============================================
  // Override sendChatMessage — sends via API + Socket.io
  // =============================================
  window.sendChatMessage = async function () {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    if (!activeChatId) return;

    const inp = document.getElementById("chatMsgInput");
    const txt = inp?.value?.trim() || "";
    if (!txt) return;

    // Stop typing
    SocketClient.emitStopTyping(activeChatId);

    // Clear input immediately for responsiveness
    inp.value = "";

    try {
      // Send to backend API (which also emits to other users via Socket.io)
      const msg = await API.sendMessage(activeChatId, txt);

      // Add to local cache
      if (!_conversationMessages[activeChatId]) {
        _conversationMessages[activeChatId] = [];
      }
      _conversationMessages[activeChatId].push(msg);

      // Also emit via Socket.io for real-time delivery
      const conv = _cachedConversations.find(
        (c) => (c.id || c._id || "").toString() === activeChatId
      );
      const recipients = conv?.participants?.map((p) =>
        (p._id || p.id || p).toString()
      ) || [];

      SocketClient.sendMessage(activeChatId, {
        id: msg.id,
        from: myId(),
        sender: {
          _id: myId(),
          name: CU.name,
          handle: CU.handle,
          avatar: CU.avatar,
        },
        txt: txt,
        t: "Just now",
        read: false,
        isMe: false, // false for recipients
      }, recipients);

      // Update conversation list data
      if (conv) {
        conv.lastMessage = txt;
        conv.lastMessageTime = "Just now";
      }

      // Fast DOM update instead of full render
      appendChatMessageDOM(msg, activeChatId);
      updateChatItemDOM(activeChatId, txt, "Just now", 0);
    } catch (err) {
      MC.error("Failed to send message: " + (err.message || ""));
      inp.value = txt; // Restore text on error
    }
  };

  // =============================================
  // Override handleChatImgAttach — upload + send
  // =============================================
  window.handleChatImgAttach = async function (e) {
    if (!CU || !activeChatId) {
      openOvl("authOvl");
      return;
    }
    const f = e.target?.files?.[0];
    if (!f) return;

    const r = new FileReader();
    r.onload = async (ev) => {
      let imgUrl = ev.target.result;

      // Upload to Cloudinary
      try {
        const result = await API.uploadBase64(imgUrl, "tirth-sutra/chat");
        imgUrl = result.url;
      } catch {
        // Use data URL as fallback
      }

      // Send as image message
      try {
        const msg = await API.sendMessage(activeChatId, "📷 Photo");
        // The backend stores text, but we display the image locally
        msg.img = imgUrl;
        msg.txt = "";

        if (!_conversationMessages[activeChatId]) {
          _conversationMessages[activeChatId] = [];
        }
        _conversationMessages[activeChatId].push(msg);

        const conv = _cachedConversations.find(
          (c) => (c.id || c._id || "").toString() === activeChatId
        );
        const recipients = conv?.participants?.map((p) =>
          (p._id || p.id || p).toString()
        ) || [];

        SocketClient.sendMessage(activeChatId, Object.assign({}, msg, { isMe: false }), recipients);

        if (conv) {
          conv.lastMessage = "📷 Photo";
          conv.lastMessageTime = "Just now";
        }

        // Fast DOM updates
        appendChatMessageDOM(msg, activeChatId);
        updateChatItemDOM(activeChatId, "📷 Photo", "Just now", 0);
      } catch {
        MC.error("Failed to send image");
      }
    };
    r.readAsDataURL(f);
  };

  // =============================================
  // Override updateChatTyping for Socket.io
  // =============================================
  window.updateChatTyping = function () {
    if (!activeChatId || !CU) return;
    SocketClient.emitTyping(activeChatId);

    // Auto stop after 3 seconds of no typing
    clearTimeout(_typingIndicatorTimer);
    _typingIndicatorTimer = setTimeout(() => {
      SocketClient.emitStopTyping(activeChatId);
    }, 3000);
  };

  // =============================================
  // Override closeChatWindow
  // =============================================
  window.closeChatWindow = function () {
    if (_currentConvId) {
      SocketClient.leaveConversation(_currentConvId);
      SocketClient.emitStopTyping(_currentConvId);
    }
    activeChatId = null;
    _currentConvId = null;

    document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));

    if (window.innerWidth < 641) {
      document.getElementById("chatWindow")?.classList.add("hide");
      document.body.classList.remove('chat-fullscreen');
    } else {
      const bar = document.getElementById("chatWinBar");
      if (bar) bar.style.display = "none";
      const msgs = document.getElementById("chatWinMsgs");
      if (msgs)
        msgs.innerHTML =
          '<div class="chat-empty-state" id="chatEmptyState" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--t3);text-align:center;padding:40px"><div style="font-size:48px;margin-bottom:12px">💬</div><div style="font-size:16px;font-weight:600;margin-bottom:6px">Select a chat</div><div style="font-size:13px">Choose a conversation from the left to start chatting.</div></div>';
      const winAv = document.getElementById("chatWinAv");
      if (winAv) winAv.innerHTML = "";
      const winName = document.getElementById("chatWinName");
      if (winName) winName.textContent = "";
      const winSub = document.getElementById("chatWinSub");
      if (winSub) winSub.textContent = "";
    }
    renderChatsList();
  };

  // =============================================
  // Override startDMWith — creates real conversation
  // =============================================
  window.startDMWith = async function (uid) {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    closeOvl("newDMModal");
    try {
      const result = await API.startConversation(uid);
      const convId = (result.id || result._id || "").toString();

      // Reload conversations to get the new one
      await loadConversations();

      gp("chats");
      setTimeout(() => openChatWindow(convId), 150);
    } catch (err) {
      MC.error("Failed to start conversation: " + (err.message || ""));
    }
  };

  // =============================================
  // Override createGroup — creates real group
  // =============================================
  window.createGroup = async function () {
    const name = document.getElementById("ngName")?.value?.trim() || "";
    if (!name) {
      MC.warn("Please enter a group name");
      return;
    }
    if (selectedGroupMembers.length < 1) {
      MC.warn("Add at least 1 member");
      return;
    }

    try {
      const result = await API.createGroupChat(name, selectedGroupMembers);
      const convId = (result.id || result._id || "").toString();

      await loadConversations();

      closeOvl("newGroupModal");
      renderChatsList();
      openChatWindow(convId);
      MC.success('Group "' + name + '" created! 🎉');
    } catch (err) {
      MC.error("Failed to create group: " + (err.message || ""));
    }
  };

  // =============================================
  // Override openNewDMModal — uses real user list
  // =============================================
  window.filterDMSearch = function (q) {
    const c = document.getElementById("dmUserList");
    if (!c) return;
    const all = getUsers().filter((u) => (u.id || u._id || "").toString() !== myId());
    const filtered = q
      ? all.filter(
          (u) =>
            u.name.toLowerCase().includes(q.toLowerCase()) ||
            u.handle.toLowerCase().includes(q.toLowerCase())
        )
      : all;
    c.innerHTML = filtered
      .map((u) => {
        const uid = (u.id || u._id || "").toString();
        const online = SocketClient.isUserOnline(uid);
        return `<div class="dm-user-item" onclick="startDMWith('${uid}')">
      <div class="av av36">${u.avatar ? '<img src="' + u.avatar + '">' : getIni(u.name)}</div>
      <div><div style="font-weight:600;font-size:14px">${u.name}${u.verified ? " 🔱" : ""} ${online ? '<span style="color:#4caf50;font-size:11px">● online</span>' : ""}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div>
    </div>`;
      })
      .join("");
  };

  // =============================================
  // Override openNewGroupModal — uses real user list
  // =============================================
  window.openNewGroupModal = function () {
    if (!CU) {
      openOvl("authOvl");
      return;
    }
    selectedGroupMembers = [];
    const el = document.getElementById("ngName");
    if (el) el.value = "";
    const ml = document.getElementById("ngMemberList");
    if (!ml) return;
    const users = getUsers().filter((u) => (u.id || u._id || "").toString() !== myId());
    ml.innerHTML = users
      .map((u) => {
        const uid = (u.id || u._id || "").toString();
        return `<div class="ng-member-item" onclick="toggleGroupMember('${uid}')">
      <div class="ng-check" id="ngc_${uid}"></div>
      <div class="av av36">${u.avatar ? '<img src="' + u.avatar + '">' : getIni(u.name)}</div>
      <div><div style="font-weight:600;font-size:14px">${u.name}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div>
    </div>`;
      })
      .join("");
    openOvl("newGroupModal");
  };

  // =============================================
  // Override old Messages page too (pgMessages)
  // =============================================
  window.renderConvs = async function () {
    const cl = document.getElementById("convsList");
    if (!CU) {
      if (cl)
        cl.innerHTML =
          '<div class="empty"><div class="empty-ico">✉️</div><div class="empty-ttl">Sign in to message</div><button class="btn btn-p" style="margin-top:12px" onclick="openOvl(\'authOvl\')">Sign In</button></div>';
      return;
    }
    // Show loading skeleton
    if (cl) cl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">Loading messages…</div>';
    try {
      const data = await API.getConversations();
      const convs = data.conversations || data || [];
      if (!convs.length) {
        if (cl) cl.innerHTML = '<div class="empty"><div class="empty-ico">✉️</div><div class="empty-ttl">No messages yet</div><div class="empty-sub">Start a conversation from someone\'s profile</div></div>';
        return;
      }
      if (cl) {
        cl.innerHTML = convs.map(conv => {
          const other = conv.otherUser || conv.participants?.find(p => p._id !== CU.id) || {};
          const name = other.name || "User";
          const handle = other.handle || "";
          const avatar = other.avatar;
          const ini = name.charAt(0).toUpperCase();
          const avH = avatar ? `<img src="${avatar}" alt="">` : ini;
          const lastMsg = conv.lastMessage || "";
          const time = conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : "";
          const convId = conv._id || conv.id || "";
          return `<div class="conv" onclick="openMsgChat('${convId}')">
            <div class="av av40">${avH}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between">
                <span class="conv-name">${name}</span>
                <span class="conv-tm">${time}</span>
              </div>
              <div class="conv-prev">${lastMsg}</div>
            </div>
          </div>`;
        }).join("");
      }
    } catch (err) {
      console.error("renderConvs error:", err);
      if (cl) cl.innerHTML = '<div class="empty"><div class="empty-ico">✉️</div><div class="empty-ttl">Could not load messages</div><div class="empty-sub">Please check your connection</div></div>';
    }
  };

  // Open a conversation in the Messages page chat view
  window.openMsgChat = async function(convId) {
    const cl = document.getElementById("convsList");
    const cv = document.getElementById("chatView");
    if (cl) cl.style.display = "none";
    if (cv) cv.classList.remove("hide");

    try {
      const data = await API.getMessages(convId);
      const msgs = data.messages || data || [];
      const conv = (await API.getConversations()).conversations?.find(c => c._id === convId) || {};
      const other = conv.otherUser || conv.participants?.find(p => p._id !== CU.id) || {};

      const chatNm = document.getElementById("chatNm");
      const chatAv = document.getElementById("chatAv");
      if (chatNm) chatNm.textContent = other.name || "User";
      if (chatAv) chatAv.innerHTML = other.avatar ? `<img src="${other.avatar}" alt="">` : (other.name || "U").charAt(0).toUpperCase();

      const chatMsgs = document.getElementById("chatMsgs");
      if (chatMsgs) {
        chatMsgs.innerHTML = msgs.map(m => {
          const isMe = m.sender === CU.id || m.sender?._id === CU.id;
          return `<div class="msg ${isMe ? 'msg-me' : 'msg-them'}">${m.text || ""}</div>`;
        }).join("");
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
      }

      // Wire up send button for this conversation
      const msgIn = document.getElementById("msgIn");
      window._msgConvId = convId;
      window.sendMsg = async function() {
        const text = (msgIn?.value || "").trim();
        if (!text) return;
        msgIn.value = "";
        try {
          await API.sendMessage(convId, text);
          const chatMsgs = document.getElementById("chatMsgs");
          if (chatMsgs) {
            chatMsgs.innerHTML += `<div class="msg msg-me">${text}</div>`;
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
          }
        } catch(e) { console.error("Send msg error:", e); }
      };
    } catch(err) {
      console.error("openMsgChat error:", err);
    }
  };

  window.openDM = function (uid) {
    if (!auth(() => openDM(uid))) return;
    gp("chats");
    setTimeout(() => {
      startDMWith(uid);
    }, 200);
  };

  // =============================================
  // Socket.io Real-Time Event Handlers
  // =============================================

  // Handle incoming message from another user
  window.handleIncomingMessage = function (data) {
    const convId = (data.convId || "").toString();
    const msg = data.message;

    // Add to local cache
    if (!_conversationMessages[convId]) {
      _conversationMessages[convId] = [];
    }

    // Avoid duplicates
    const existing = _conversationMessages[convId].find(
      (m) => m.id && msg.id && m.id.toString() === msg.id.toString()
    );
    if (!existing) {
      _conversationMessages[convId].push(msg);
    }

    // If this conversation is currently open, do fast append
    if (activeChatId === convId) {
      appendChatMessageDOM(msg, convId);
      // Send read receipt
      SocketClient.emitMessageRead(convId);
    }

    // Update conversation list data
    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === convId
    );
    if (conv) {
      conv.lastMessage = msg.txt || "📷 Photo";
      conv.lastMessageTime = "Just now";
      let unreadInc = 0;
      if (activeChatId !== convId) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
        unreadInc = 1;
      }
      
      if (curPage === "chats") {
        updateChatItemDOM(convId, conv.lastMessage, conv.lastMessageTime, unreadInc);
      }
    } else {
      // New conversation — reload the list
      loadConversations().then(() => {
        if (curPage === "chats") renderChatsList();
      });
    }
  };

  // High-performance DOM appending for chat messages
  function appendChatMessageDOM(m, convId) {
    const c = document.getElementById("chatWinMsgs");
    if (!c || activeChatId !== convId) return;

    // Remove empty state if present
    const empty = document.getElementById("chatEmptyState");
    if (empty) empty.style.display = "none";

    // Remove typing indicator temporarily to append above it
    const ti = document.getElementById("remoteTypingIndicator");
    if (ti) ti.remove();

    const isOut = m.isMe || (m.from && m.from.toString() === myId());
    const sender = m.sender || {};
    const senderName = sender.name || "Unknown";
    
    // Check previous message to see if we should show avatar
    const msgs = _conversationMessages[convId] || [];
    const prev = msgs.length > 1 ? msgs[msgs.length - 2] : null; // -2 because `m` is already in the array
    
    const isGroup = _cachedConversations.find(c => (c.id || c._id || "").toString() === convId)?.isGroup;
    const showAv = !isOut && isGroup && (!prev || (prev.from?.toString() !== m.from?.toString()));
    const ini = getIni(senderName);

    const avHtml = `<div class="msg-av-small">${sender.avatar ? '<img src="' + sender.avatar + '">' : ini}</div>`;
    const avOrSpacer = !isOut && isGroup ? (showAv ? avHtml : '<div class="msg-av-placeholder"></div>') : "";

    const tickClass = m.read ? "tick-read" : "tick-sent";
    const tickSvg = isOut ? `<svg class="msg-tick ${tickClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : "";
    const timeStr = m.t || "Just now";

    const msgHtml = `<div class="msg-row ${isOut ? "out" : "in"}">
      ${avOrSpacer}
      <div class="msg-bubble">
        ${showAv ? '<div class="msg-sender-name">' + esc(senderName) + "</div>" : ""}
        ${m.img ? '<img class="msg-bubble-img" src="' + m.img + '" alt="">' : ""}
        ${m.txt ? esc(m.txt) : ""}
        <div class="msg-meta">
          <span class="msg-time">${timeStr}</span>
          ${tickSvg}
        </div>
      </div>
    </div>`;

    c.insertAdjacentHTML("beforeend", msgHtml);

    // Re-append typing indicator if it was there
    if (ti && !isOut) c.appendChild(ti);

    // Use smooth scrolling to prevent jank
    c.scroll({ top: c.scrollHeight, behavior: 'smooth' });
  }

  // Fast update of the sidebar chat item position and text
  function updateChatItemDOM(convId, lastMsg, lastTime, unreadInc) {
    const item = document.getElementById("ci_" + convId);
    if (!item) {
      if (curPage === "chats") renderChatsList(); // fallback
      return;
    }
    
    const prevEl = item.querySelector(".chat-item-prev");
    const timeEl = item.querySelector(".chat-item-time");
    if (prevEl) prevEl.textContent = (lastMsg || "Media").substring(0, 55);
    if (timeEl) timeEl.textContent = lastTime;

    // Handle Unread badge
    const bottomRow = item.querySelector(".chat-item-bottom");
    if (bottomRow && unreadInc > 0) {
      item.classList.add("unread-time");
      if (prevEl) prevEl.classList.add("bold");
      
      let badge = item.querySelector(".chat-unread-badge");
      if (!badge) {
        bottomRow.insertAdjacentHTML("beforeend", '<span class="chat-unread-badge">1</span>');
      } else {
        const val = parseInt(badge.textContent) || 0;
        badge.textContent = val + unreadInc > 9 ? "9+" : val + unreadInc;
      }
    } else if (unreadInc === 0 && activeChatId === convId) {
      // If we are currently in the chat, remove unread styling
      const badge = item.querySelector(".chat-unread-badge");
      if (badge) badge.remove();
      if (prevEl) prevEl.classList.remove("bold");
      item.classList.remove("unread-time");
    }

    // Move to top of the list for fresh activity
    const list = document.getElementById("chatsList");
    if (list && list.firstChild !== item) {
      list.prepend(item);
      item.style.animation = "mIn 0.3s ease"; // small nice highlight
    }
  }

  // Handle remote user typing
  window.handleRemoteTyping = function (data) {
    if (data.convId !== activeChatId) return;
    const c = document.getElementById("chatWinMsgs");
    if (!c) return;

    // Show typing indicator
    let ti = document.getElementById("remoteTypingIndicator");
    if (!ti) {
      ti = document.createElement("div");
      ti.className = "msg-row in";
      ti.id = "remoteTypingIndicator";
      ti.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
      c.appendChild(ti);
      c.scrollTop = c.scrollHeight;
    }

    // Update sub-header
    const sub = document.getElementById("chatWinSub");
    if (sub) sub.textContent = (data.userName || "Someone") + " is typing...";
  };

  // Handle remote user stop typing
  window.handleRemoteStopTyping = function (data) {
    if (data.convId !== activeChatId) return;

    const ti = document.getElementById("remoteTypingIndicator");
    if (ti) ti.remove();

    // Restore sub-header
    const sub = document.getElementById("chatWinSub");
    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === activeChatId
    );
    if (sub && conv && !conv.isGroup) {
      const uid = sub.getAttribute("data-chat-uid");
      sub.textContent = uid && SocketClient.isUserOnline(uid) ? "🟢 online" : "last seen recently";
    }
  };

  // Handle read receipt from remote user
  window.handleRemoteRead = function (data) {
    if (data.convId !== activeChatId) return;
    // Mark all outgoing messages as read
    const msgs = _conversationMessages[activeChatId] || [];
    msgs.forEach((m) => {
      if (m.isMe || (m.from && m.from.toString() === myId())) {
        m.read = true;
      }
    });
    renderChatMessages(activeChatId);
  };

  // Handle online status change for chat header
  window.updateChatHeaderOnline = function (userId, online) {
    const sub = document.getElementById("chatWinSub");
    if (!sub) return;
    const uid = sub.getAttribute("data-chat-uid");
    if (uid === userId) {
      sub.textContent = online ? "🟢 online" : "last seen recently";
    }
    // Also update chat list indicators
    if (curPage === "chats") renderChatsList();
  };

  // =============================================
  // Override init — bootstrap from backend
  // =============================================
  const _origInit = window.init;
  window.init = async function () {
    // Restore theme
    const theme = Store.g("theme", "light");
    if (theme === "dark") {
      document.documentElement.setAttribute("data-dark", "");
      const sunPath =
        '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
      ["thIco", "dThemeIco"].forEach((id) => {
        const ico = document.getElementById(id);
        if (ico) ico.innerHTML = sunPath;
      });
    }

    // Wire auth buttons
    const lb = document.getElementById("loginBtn");
    if (lb) lb.addEventListener("click", doLogin);
    const sb2 = document.getElementById("signupBtn");
    if (sb2) sb2.addEventListener("click", doSignup);
    document.getElementById("liPw")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
    document.getElementById("suPw")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSignup();
    });

    const authRedirect = consumeAuthRedirectHash();
    if (authRedirect?.authToken) {
      API.setToken(authRedirect.authToken);
    }

    // Try to restore session from stored token
    const storedToken = API.getToken();
    // Guard: reject stale "undefined" string that may have been written
    // by a previous buggy signup call before this fix was applied.
    if (storedToken && storedToken !== "undefined" && storedToken !== "null") {
      try {
        CU = await API.getMe();
        SocketClient.connect((CU.id || CU._id).toString());
        ensureChatPushNotifications(false).catch(() => {});
      } catch {
        CU = null;
        API.logout();
      }
    } else if (storedToken === "undefined" || storedToken === "null") {
      // Clean up the stale bad value so it doesn't keep breaking
      API.logout();
    }

    // Load data from backend
    await loadAllData();

    // Render UI
    initUI();
    renderFeed();
    renderStories();
    renderWidgets();

    if (authRedirect?.authError) {
      MC.error(authRedirect.authError);
    } else if (authRedirect?.authToken && authRedirect.authSource === "google") {
      MC.success("Google Sign-In completed successfully.");
    }

    // Check notifications
    checkNotifications();
    openPendingChatIfNeeded();
    if (typeof window.hideBrandSplash === "function") {
      window.hideBrandSplash();
    }
  };

  // =============================================
  // WebRTC Call Initiation
  // =============================================
  window.startWebrtcCall = function (isVideo) {
    if (!activeChatId) return MC?.error("No active chat.");

    const conv = _cachedConversations.find(
      (c) => (c.id || c._id || "").toString() === activeChatId
    );

    if (!conv || !conv.uid) {
      return MC?.error("Could not find user details to call.");
    }

    const uid = conv.uid.toString();
    const userName = conv.user ? conv.user.name : "User";
    const avatar = conv.user ? conv.user.avatar : null;

    if (typeof WebRTCClient !== "undefined") {
      WebRTCClient.startCall(uid, userName, avatar, isVideo);
    } else {
      MC?.error("Calling feature is not initialized.");
    }
  };

  // =============================================
  // Mobile Keyboard — keep chat input visible
  // =============================================
  (function setupMobileKeyboardHandler() {
    if (!window.visualViewport) return;

    let chatWindow = null;

    function onViewportResize() {
      chatWindow = chatWindow || document.getElementById("chatWindow");
      if (!chatWindow || chatWindow.classList.contains("hide")) return;
      if (window.innerWidth > 640) return;

      const vvh = window.visualViewport.height;
      const vvTop = window.visualViewport.offsetTop;

      // Set chat window height to match the visible viewport (excludes keyboard)
      chatWindow.style.height = vvh + "px";
      chatWindow.style.top = vvTop + "px";

      // Scroll messages to bottom so latest message stays visible
      const msgs = document.getElementById("chatWinMsgs");
      if (msgs) {
        requestAnimationFrame(() => {
          msgs.scrollTop = msgs.scrollHeight;
        });
      }
    }

    function onViewportScroll() {
      // Prevent the page from scrolling when keyboard pushes the viewport
      chatWindow = chatWindow || document.getElementById("chatWindow");
      if (!chatWindow || chatWindow.classList.contains("hide")) return;
      if (window.innerWidth > 640) return;

      const vvTop = window.visualViewport.offsetTop;
      chatWindow.style.top = vvTop + "px";
    }

    window.visualViewport.addEventListener("resize", onViewportResize);
    window.visualViewport.addEventListener("scroll", onViewportScroll);

    // Also reset when chat window is closed
    const origClose = window.closeChatWindow;
    window.closeChatWindow = function () {
      if (chatWindow) {
        chatWindow.style.height = "";
        chatWindow.style.top = "";
      }
      origClose.apply(this, arguments);
    };
  })();

  // Remove the old DOMContentLoaded listener and re-fire init
  window.init();
})();
