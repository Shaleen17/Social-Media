(function () {
  "use strict";

  const DONATION_CAMPAIGNS = [
    {
      key: "annadanam-seva",
      title: "Annadanam Seva",
      description: "Prasad meals and food seva for yatris and devotees.",
      accent: "#a35c1d",
    },
    {
      key: "gau-seva",
      title: "Gau Seva",
      description: "Daily fodder, shelter support and veterinary care.",
      accent: "#8f6b22",
    },
    {
      key: "mandir-renovation",
      title: "Mandir Renovation",
      description: "Cleaning, restoration and sacred upkeep for mandir spaces.",
      accent: "#70442a",
    },
    {
      key: "daily-aarti",
      title: "Daily Aarti",
      description: "Flowers, diyas, bhog and daily puja samagri.",
      accent: "#b26b3d",
    },
  ];

  const LIVE_DARSHAN_STREAMS = [
    {
      id: "live-radharaman-morning",
      profileName: "Radharaman",
      avatar: "images/sants/Radharaman.jpg",
      heading: "Radharamanji Live darshans from vrindavan",
      subheading: "Vrindavan dham • Morning darshan • Sacred temple ambience",
      src: "https://videos-jjun.vercel.app/live1.mp4",
      viewers: 18400,
      started: "Started 8 min ago",
      comments: [
        { user: "premsevak108", text: "Radhe Radhe 🙏 What a peaceful darshan." },
        { user: "vrindavanvasi", text: "The morning bells feel so divine today." },
        { user: "bhaktiras", text: "Offering pranam from Mumbai." },
      ],
    },
    {
      id: "live-radhavallabh",
      profileName: "Radhavallabhji",
      avatar: "images/sants/Radhavallabhji.jpg",
      heading: "Radhavallabh Live darshans from vrindavan",
      subheading: "Vrindavan dham • Midday darshan • Temple courtyard live",
      src: "https://videos-jjun.vercel.app/live2.mp4",
      viewers: 13200,
      started: "Started 21 min ago",
      comments: [
        { user: "gopibhav", text: "Jai Jai Shri Radhe 💐" },
        { user: "hari_smriti", text: "The darshan quality looks beautiful." },
        { user: "manasiseva", text: "Listening quietly and soaking in the atmosphere." },
      ],
    },
    {
      id: "live-radharaman-sandhya",
      profileName: "Radharaman",
      avatar: "images/sants/Radharaman.jpg",
      heading: "Radharamanji Sandhya Live darshans from vrindavan",
      subheading: "Vrindavan dham • Sandhya aarti • Evening seva live",
      src: "https://videos-jjun.vercel.app/live3.mp4",
      viewers: 21900,
      started: "Started 4 min ago",
      comments: [
        { user: "sevakrishna", text: "Sandhya vibes are unmatched today ✨" },
        { user: "bhajanpremi", text: "Jai Shri Radhe, joining from Delhi." },
        { user: "yamunatat", text: "Evening darshan from Vrindavan feels magical." },
      ],
    },
  ];

  const DEFAULT_DONATION_AMOUNT = 251;
  const GUEST_DONATIONS_STORAGE_KEY = "ts_guest_donation_history";
  const DASHBOARD_REFRESH_MS = 30000;

  const state = {
    amount: DEFAULT_DONATION_AMOUNT,
    busy: false,
    dashboardBusy: false,
    dashboardIntervalId: null,
    selectedCampaignKey: DONATION_CAMPAIGNS[0].key,
    latestDonation: null,
    dashboardData: null,
    menuContext: "community",
    socketBound: false,
    activeLiveDarshanId: LIVE_DARSHAN_STREAMS[0].id,
    liveDarshanMuted: false,
    liveDarshanComments: {},
    liveDarshanSwipeBound: false,
    liveDarshanKeyboardBound: false,
    liveDarshanTouchStartX: 0,
    liveDarshanTouchStartY: 0,
    liveDarshanTouchOffsetX: 0,
  };

  const originalCloseOvl =
    typeof closeOvl === "function"
      ? closeOvl.bind(window)
      : function fallbackCloseOvl() {};

  window.closeOvl = function wrappedCloseOvl(id) {
    if (id === "donationDashboardOvl") {
      stopDonationDashboardRefresh();
    }
    if (id === "liveDarshanOvl") {
      pauseLiveDarshanPlayback();
    }
    return originalCloseOvl(id);
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getById(id) {
    return document.getElementById(id);
  }

  function formatInr(amountInPaise) {
    const amount = Math.max(0, Math.round(Number(amountInPaise || 0))) / 100;
    return `Rs ${amount.toLocaleString("en-IN")}`;
  }

  function formatDateTime(value) {
    if (!value) return "Now";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Now";
    return date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatViewerCount(value) {
    const count = Math.max(0, Number(value) || 0);
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
    }
    return String(Math.round(count));
  }

  function formatRelativeTime(value) {
    if (!value) return "No updates yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No updates yet";
    const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diffSeconds < 60) return "Just now";
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getSelectedCampaign() {
    return (
      DONATION_CAMPAIGNS.find((campaign) => campaign.key === state.selectedCampaignKey) ||
      DONATION_CAMPAIGNS[0]
    );
  }

  function findCampaignByInput(input) {
    const normalized = normalizeKey(input);
    return (
      DONATION_CAMPAIGNS.find((campaign) => {
        return campaign.key === normalized || normalizeKey(campaign.title) === normalized;
      }) || DONATION_CAMPAIGNS[0]
    );
  }

  function getStoredUser() {
    if (typeof API !== "undefined" && API && typeof API.getStoredUser === "function") {
      return API.getStoredUser();
    }
    return null;
  }

  function hasSignedInUser() {
    return Boolean(
      typeof API !== "undefined" &&
        API &&
        typeof API.getToken === "function" &&
        API.getToken()
    );
  }

  function setDonationStatus(text) {
    const chip = getById("donateStatusChip");
    if (chip) chip.textContent = text;
  }

  function setDashboardLivePill(text) {
    const pill = getById("donationDashboardLivePill");
    if (pill) pill.textContent = text;
  }

  function renderDonationCampaignGrid() {
    const host = getById("donateCampaignGrid");
    if (!host) return;

    host.innerHTML = DONATION_CAMPAIGNS.map((campaign) => {
      const selected = campaign.key === state.selectedCampaignKey ? " selected" : "";
      return `
        <button
          class="donate-campaign-card${selected}"
          type="button"
          onclick="selectDonationCampaign('${campaign.key}')"
        >
          <div class="donate-campaign-top">
            <strong>${escapeHtml(campaign.title)}</strong>
            <span class="donate-campaign-dot" style="background:${campaign.accent}"></span>
          </div>
          <p>${escapeHtml(campaign.description)}</p>
        </button>
      `;
    }).join("");
  }

  function seedDonationIdentity() {
    const user = getStoredUser() || (typeof CU !== "undefined" ? CU : null);
    const nameInput = getById("donateNameInput");
    const emailInput = getById("donateEmailInput");

    if (nameInput) {
      nameInput.value = user && user.name ? user.name : "";
    }
    if (emailInput) {
      emailInput.value = user && user.email ? user.email : "";
    }
  }

  function syncDonationAmountButtons(selectedButton) {
    document.querySelectorAll("#donateOvl .donate-amt").forEach((button) => {
      button.classList.toggle("selected", button === selectedButton);
    });
  }

  function updateDonationPreview() {
    const amountText = formatInr(state.amount * 100);
    const selectedCampaign = getSelectedCampaign();
    const payAmount = getById("donatePayAmount");
    const previewAmount = getById("donatePreviewAmount");
    const previewPurpose = getById("donatePreviewPurpose");
    const payLabel = getById("donatePayBtnLabel");
    const button = getById("donatePayBtn");

    if (payAmount) payAmount.textContent = amountText;
    if (previewAmount) previewAmount.textContent = amountText;
    if (previewPurpose) previewPurpose.textContent = selectedCampaign.title;
    if (payLabel) payLabel.textContent = state.busy ? "Processing" : "Verify and pay";
    if (button) {
      button.disabled = state.busy || !Number.isFinite(state.amount) || state.amount < 10;
      button.style.opacity = state.busy ? "0.75" : "";
      button.style.cursor = state.busy ? "wait" : "";
    }
  }

  function resetDonationViews() {
    const formView = getById("donateFormView");
    const successView = getById("donateSuccessView");
    const customAmount = getById("donateCustomAmt");

    state.amount = DEFAULT_DONATION_AMOUNT;
    state.busy = false;
    state.selectedCampaignKey = DONATION_CAMPAIGNS[0].key;

    if (formView) formView.style.display = "";
    if (successView) successView.classList.remove("show");
    if (customAmount) customAmount.value = "";

    const amountButtons = document.querySelectorAll("#donateOvl .donate-amt");
    amountButtons.forEach((button, index) => {
      button.classList.toggle("selected", index === 2);
    });

    renderDonationCampaignGrid();
    updateDonationPreview();
    setDonationStatus("Secure Razorpay checkout");

    const title = document.querySelector("#donateOvl .mhdr h3");
    if (title) title.textContent = "Real Seva";
  }

  function openDonateModalWithState() {
    closeMandirActionMenu();
    if (getById("liveDarshanOvl")?.classList.contains("show")) {
      closeLiveDarshanModal();
    }
    if (getById("donationDashboardOvl")?.classList.contains("show")) {
      closeDashboardModal();
    }
    resetDonationViews();
    seedDonationIdentity();
    if (typeof openOvl === "function") {
      openOvl("donateOvl");
    }
  }

  function closeDonateModalWithState() {
    state.busy = false;
    updateDonationPreview();
    if (typeof closeOvl === "function") {
      closeOvl("donateOvl");
    }
  }

  function setDonationCampaign(key) {
    state.selectedCampaignKey = findCampaignByInput(key).key;
    renderDonationCampaignGrid();
    updateDonationPreview();
  }

  function selectDonationAmount(amount, button) {
    state.amount = Math.max(10, Number(amount) || DEFAULT_DONATION_AMOUNT);
    const customAmount = getById("donateCustomAmt");
    if (customAmount) customAmount.value = "";
    syncDonationAmountButtons(button || null);
    updateDonationPreview();
  }

  function handleCustomDonationInput(input) {
    const value = Number.parseInt(input && input.value ? input.value : "", 10);
    if (!Number.isFinite(value) || value < 1) {
      updateDonationPreview();
      return;
    }
    state.amount = value;
    syncDonationAmountButtons(null);
    updateDonationPreview();
  }

  function buildReceiptRecord(donation) {
    if (!donation) return null;
    return donation.receipt || {
      number: donation.receiptNumber || "",
      issuedAt: donation.receiptIssuedAt || donation.paidAt || donation.createdAt || null,
      donorName: donation.donorName || "Guest Devotee",
      donorEmail: donation.donorEmail || "",
      amount: donation.amount || 0,
      currency: donation.currency || "INR",
      purpose: donation.purpose || getSelectedCampaign().title,
      paymentId: donation.paymentId || "",
      orderId: donation.orderId || "",
      paymentMethod: donation.paymentMethod || "",
    };
  }

  function persistGuestDonation(donation) {
    if (!donation || !donation.receiptNumber) return;
    try {
      const existing = readGuestDonationHistory().filter((item) => {
        return (
          (item.receiptNumber || "") !== donation.receiptNumber &&
          (item.paymentId || "") !== (donation.paymentId || "") &&
          (item.id || "") !== (donation.id || "")
        );
      });
      existing.unshift(donation);
      localStorage.setItem(
        GUEST_DONATIONS_STORAGE_KEY,
        JSON.stringify(existing.slice(0, 25))
      );
    } catch {}
  }

  function readGuestDonationHistory() {
    try {
      const raw = localStorage.getItem(GUEST_DONATIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function mergeDonationHistory(serverHistory, guestHistory) {
    const seen = new Set();
    const merged = [];

    [...(serverHistory || []), ...(guestHistory || [])].forEach((item) => {
      const dedupeKey =
        item.receiptNumber || item.paymentId || item.id || `${item.purpose}_${item.amount}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      merged.push(item);
    });

    return merged.sort((left, right) => {
      const leftTime = new Date(left.paidAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.paidAt || right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
  }

  function populateSuccessView(donation) {
    const formView = getById("donateFormView");
    const successView = getById("donateSuccessView");
    const receipt = buildReceiptRecord(donation);

    if (formView) formView.style.display = "none";
    if (successView) successView.classList.add("show");

    const successAmount = getById("donateSuccessAmt");
    const successMessage = getById("donateSuccessMessage");
    const receiptPurpose = getById("donateReceiptPurpose");
    const receiptNumber = getById("donateReceiptNumber");
    const receiptIssuedAt = getById("donateReceiptIssuedAt");
    const receiptMethod = getById("donateReceiptMethod");
    const receiptDonor = getById("donateReceiptDonor");
    const receiptOrder = getById("donateReceiptOrder");
    const receiptPayment = getById("donateReceiptPayment");

    if (successAmount) successAmount.textContent = formatInr(donation.amount || state.amount * 100);
    if (successMessage) {
      successMessage.textContent = `Your ${donation.purpose || getSelectedCampaign().title} donation has been verified and added to the live dashboard.`;
    }
    if (receiptPurpose) receiptPurpose.textContent = receipt.purpose || donation.purpose || "";
    if (receiptNumber) receiptNumber.textContent = receipt.number || donation.receiptNumber || "-";
    if (receiptIssuedAt) receiptIssuedAt.textContent = formatDateTime(receipt.issuedAt);
    if (receiptMethod) receiptMethod.textContent = donation.paymentMethod || receipt.paymentMethod || "Online";
    if (receiptDonor) receiptDonor.textContent = receipt.donorName || donation.donorName || "Guest Devotee";
    if (receiptOrder) receiptOrder.textContent = receipt.orderId || donation.orderId || "-";
    if (receiptPayment) receiptPayment.textContent = receipt.paymentId || donation.paymentId || "-";

    setDonationStatus("Receipt ready");
  }

  async function beginDonationPayment() {
    if (state.busy) return;

    if (!Number.isFinite(state.amount) || state.amount < 10) {
      if (typeof MC !== "undefined") MC.warn("Please select an amount of at least Rs 10.");
      return;
    }

    if (
      typeof API === "undefined" ||
      !API ||
      typeof API.createDonationOrder !== "function" ||
      typeof API.verifyDonationPayment !== "function"
    ) {
      if (typeof MC !== "undefined") MC.error("Payment API is unavailable right now.");
      return;
    }

    if (typeof Razorpay !== "function") {
      if (typeof MC !== "undefined") {
        MC.error("Razorpay checkout could not load. Please refresh and try again.");
      }
      return;
    }

    const donorName = (getById("donateNameInput")?.value || "").trim();
    const donorEmail = (getById("donateEmailInput")?.value || "").trim();
    const selectedCampaign = getSelectedCampaign();

    state.busy = true;
    updateDonationPreview();
    setDonationStatus("Creating secure Razorpay order...");

    let order;
    try {
      order = await API.createDonationOrder(
        state.amount,
        selectedCampaign.title,
        donorName,
        donorEmail
      );
    } catch (error) {
      state.busy = false;
      updateDonationPreview();
      setDonationStatus("Could not create order");
      if (typeof MC !== "undefined") {
        MC.error(error.message || "Could not create the donation order. Please try again.");
      }
      return;
    }

    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency || "INR",
      name: order.name || "Tirth Sutra",
      description: order.description || `${selectedCampaign.title} via Tirth Sutra`,
      image: "Brand_Logo.jpg",
      order_id: order.orderId,
      prefill: {
        name: (order.prefill && order.prefill.name) || donorName,
        email: (order.prefill && order.prefill.email) || donorEmail,
      },
      notes: order.notes || {},
      theme: {
        color: "#4a2e2a",
        backdrop_color: "rgba(74, 46, 42, 0.82)",
      },
      modal: {
        ondismiss: function onDismiss() {
          state.busy = false;
          updateDonationPreview();
          setDonationStatus("Payment window closed");
          if (typeof MC !== "undefined") MC.info("Payment cancelled");
        },
      },
      handler: async function onPaymentSuccess(response) {
        setDonationStatus("Verifying payment with Razorpay...");
        try {
          const verification = await API.verifyDonationPayment(response);
          const donation = verification && verification.donation ? verification.donation : null;
          if (!donation) {
            throw new Error("Verification completed but no receipt data was returned.");
          }
          state.latestDonation = donation;
          persistGuestDonation(donation);
          populateSuccessView(donation);
          if (typeof MC !== "undefined") {
            MC.success(`${formatInr(donation.amount)} verified successfully.`);
          }
          refreshDonationDashboard({ silent: true, fromPayment: true }).catch(function ignore() {});
        } catch (error) {
          setDonationStatus("Verification failed");
          if (typeof MC !== "undefined") {
            MC.error(error.message || "Payment verification failed. Please contact support.");
          }
        } finally {
          state.busy = false;
          updateDonationPreview();
        }
      },
    };

    try {
      const checkout = new Razorpay(options);
      checkout.on("payment.failed", function onPaymentFailed(event) {
        state.busy = false;
        updateDonationPreview();
        const reason =
          event && event.error
            ? event.error.description ||
              event.error.reason ||
              event.error.source ||
              "Payment failed. Please try again."
            : "Payment failed. Please try again.";
        setDonationStatus("Payment failed");
        if (typeof MC !== "undefined") MC.error(reason);
      });
      checkout.open();
    } catch (error) {
      state.busy = false;
      updateDonationPreview();
      setDonationStatus("Could not open checkout");
      if (typeof MC !== "undefined") {
        MC.error(error.message || "Could not start the payment. Please try again.");
      }
    }
  }

  function buildReceiptHtml(donation) {
    const receipt = buildReceiptRecord(donation);
    const amount = formatInr(receipt.amount || donation.amount || 0);
    const issuedAt = formatDateTime(receipt.issuedAt);
    const donorName = escapeHtml(receipt.donorName || "Guest Devotee");
    const donorEmail = escapeHtml(receipt.donorEmail || "Not provided");
    const purpose = escapeHtml(receipt.purpose || donation.purpose || "Real Seva");
    const orderId = escapeHtml(receipt.orderId || donation.orderId || "-");
    const paymentId = escapeHtml(receipt.paymentId || donation.paymentId || "-");
    const paymentMethod = escapeHtml(receipt.paymentMethod || donation.paymentMethod || "Online");
    const receiptNumber = escapeHtml(receipt.number || donation.receiptNumber || "-");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tirth Sutra Receipt ${receiptNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 32px; background: #f7f1eb; color: #2c211d; }
    .card { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 18px; padding: 28px; box-shadow: 0 18px 40px rgba(44, 33, 29, 0.1); }
    .top { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
    .brand { font-size: 26px; font-weight: 800; color: #4a2e2a; }
    .muted { color: #7b6961; font-size: 13px; }
    .amount { font-size: 34px; font-weight: 800; color: #4a2e2a; text-align: right; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
    .cell { border: 1px solid #eadcd0; border-radius: 14px; padding: 14px; background: #fcfaf8; }
    .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8f7b71; margin-bottom: 6px; }
    .value { font-size: 15px; font-weight: 700; color: #2c211d; word-break: break-word; }
    .footer { margin-top: 24px; padding-top: 18px; border-top: 1px solid #eadcd0; font-size: 13px; color: #6d5b55; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="top">
      <div>
        <div class="brand">Tirth Sutra</div>
        <div class="muted">Mandir Community donation receipt</div>
        <div class="muted">Receipt number: ${receiptNumber}</div>
      </div>
      <div class="amount">${amount}</div>
    </div>

    <div class="grid">
      <div class="cell"><div class="label">Purpose</div><div class="value">${purpose}</div></div>
      <div class="cell"><div class="label">Issued at</div><div class="value">${escapeHtml(issuedAt)}</div></div>
      <div class="cell"><div class="label">Donor</div><div class="value">${donorName}</div></div>
      <div class="cell"><div class="label">Email</div><div class="value">${donorEmail}</div></div>
      <div class="cell"><div class="label">Payment method</div><div class="value">${paymentMethod}</div></div>
      <div class="cell"><div class="label">Order ID</div><div class="value">${orderId}</div></div>
      <div class="cell"><div class="label">Payment ID</div><div class="value">${paymentId}</div></div>
      <div class="cell"><div class="label">Verification</div><div class="value">Verified on the server using Razorpay signature and payment capture.</div></div>
    </div>

    <div class="footer">
      Thank you for contributing through Tirth Sutra. This receipt was generated after the payment was verified successfully.
    </div>
  </div>
</body>
</html>`;
  }

  function downloadDonationReceipt(donation) {
    if (!donation) {
      if (typeof MC !== "undefined") MC.error("No donation receipt is available yet.");
      return;
    }

    const receipt = buildReceiptRecord(donation);
    const blob = new Blob([buildReceiptHtml(donation)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${receipt.number || "tirth-sutra-receipt"}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function revoke() {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function buildDashboardFallback() {
    return {
      summary: {
        totalRaised: 0,
        totalDonations: 0,
        averageDonation: 0,
        latestDonationAt: null,
        latestDonationLabel: "No verified donations yet",
      },
      recentDonations: [],
      myHistory: [],
      myStats: {
        totalDonated: 0,
        donationsCount: 0,
        latestReceiptNumber: "",
        latestDonationAt: null,
      },
      impactUpdates: DONATION_CAMPAIGNS.map((campaign) => {
        return {
          key: campaign.key,
          title: campaign.title,
          description: campaign.description,
          accent: campaign.accent,
          amount: 0,
          donations: 0,
          goalAmount: 0,
          progressPercent: 0,
          helpedCount: 0,
          helpedLabel: "Awaiting the first verified donation",
          latestDonationAt: null,
          timelineLabel: "No updates yet",
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  function renderSummaryCards(data) {
    const summary = data.summary || {};
    const myStats = data.myStats || {};
    const latestLabel =
      summary.latestDonationLabel ||
      formatRelativeTime(summary.latestDonationAt) ||
      "No verified donations yet";

    if (getById("donationSummaryRaised")) {
      getById("donationSummaryRaised").textContent = formatInr(summary.totalRaised || 0);
    }
    if (getById("donationSummaryCount")) {
      getById("donationSummaryCount").textContent = String(summary.totalDonations || 0);
    }
    if (getById("donationSummaryAverage")) {
      getById("donationSummaryAverage").textContent = formatInr(summary.averageDonation || 0);
    }
    if (getById("donationSummaryLatest")) {
      getById("donationSummaryLatest").textContent = latestLabel;
    }
    if (getById("donationSummaryRaisedHint")) {
      getById("donationSummaryRaisedHint").textContent = hasSignedInUser()
        ? `${formatInr(myStats.totalDonated || 0)} from your verified receipts`
        : "Verified community total";
    }
    if (getById("donationSummaryLatestHint")) {
      getById("donationSummaryLatestHint").textContent = `Dashboard updated ${formatRelativeTime(data.generatedAt)}`;
    }
  }

  function renderImpactCards(items) {
    const host = getById("donationImpactGrid");
    if (!host) return;

    if (!Array.isArray(items) || !items.length) {
      host.innerHTML = `<div class="donation-empty-state">Impact updates will appear here after the first verified donation.</div>`;
      return;
    }

    host.innerHTML = items.map((item) => {
      const amount = formatInr(item.amount || 0);
      return `
        <div class="donation-impact-card">
          <div class="donation-impact-top">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.description || "")}</p>
            </div>
            <span class="donation-impact-amount" style="color:${item.accent || "#4a2e2a"}">${amount}</span>
          </div>
          <div class="donation-impact-bar">
            <div class="donation-impact-fill" style="width:${Math.max(0, Math.min(100, Number(item.progressPercent || 0)))}%;background:${item.accent || "#4a2e2a"}"></div>
          </div>
          <div class="donation-impact-meta">
            <span>${escapeHtml(item.helpedLabel || "Awaiting the first verified donation")}</span>
            <span>${escapeHtml(item.timelineLabel || "No updates yet")}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderHistoryItems(data) {
    const host = getById("donationHistoryList");
    const meta = getById("donationHistoryMeta");
    if (!host) return;

    const guestHistory = readGuestDonationHistory();
    const mergedHistory = mergeDonationHistory(
      Array.isArray(data.myHistory) ? data.myHistory : [],
      guestHistory
    );

    if (meta) {
      meta.textContent = hasSignedInUser()
        ? `${mergedHistory.length} verified receipts are synced to this account.`
        : mergedHistory.length
          ? "Showing receipts saved on this device. Sign in to sync across devices."
          : "Sign in to sync receipts across devices. Device receipts will also appear here.";
    }

    if (!mergedHistory.length) {
      host.innerHTML = `<div class="donation-empty-state">No receipts yet. Your next verified donation will appear here.</div>`;
      return;
    }

    host.innerHTML = mergedHistory.map((item) => {
      return `
        <div class="donation-history-item">
          <div class="donation-history-top">
            <div>
              <strong>${escapeHtml(item.purpose || "Real Seva")}</strong>
              <span>${escapeHtml(formatDateTime(item.paidAt || item.createdAt))}</span>
            </div>
            <div class="donation-history-amount">${formatInr(item.amount || 0)}</div>
          </div>
          <div class="donation-history-meta">
            <span>${escapeHtml(item.receiptNumber || "Receipt pending")}</span>
            <span>${escapeHtml(item.paymentMethod || "Online payment")}</span>
            <span>${escapeHtml(item.verificationLabel || "Verified")}</span>
          </div>
          <div class="donation-history-actions">
            <button class="donation-inline-btn" type="button" onclick="downloadStoredDonationReceipt('${escapeHtml(item.id || item.receiptNumber || "")}')">
              Download receipt
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderRecentDonations(items) {
    const host = getById("donationRecentList");
    if (!host) return;

    if (!Array.isArray(items) || !items.length) {
      host.innerHTML = `<div class="donation-empty-state">Community donations will appear here after the first verified payment.</div>`;
      return;
    }

    host.innerHTML = items.map((item) => {
      return `
        <div class="donation-recent-item">
          <div class="donation-recent-top">
            <div>
              <strong>${escapeHtml(item.donorName || "Devotee")}</strong>
              <span>${escapeHtml(item.purpose || "Real Seva")}</span>
            </div>
            <div class="donation-recent-amount">${formatInr(item.amount || 0)}</div>
          </div>
          <div class="donation-recent-meta">
            <span>${escapeHtml(item.timelineLabel || "Just now")}</span>
            <span>${escapeHtml(item.verificationLabel || "Verified")}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderDonationDashboard(data) {
    renderSummaryCards(data);
    renderImpactCards(data.impactUpdates || []);
    renderHistoryItems(data);
    renderRecentDonations(data.recentDonations || []);
  }

  async function refreshDonationDashboard(options = {}) {
    if (state.dashboardBusy) return;

    const loading = getById("donationDashboardLoading");
    const content = getById("donationDashboardContent");

    state.dashboardBusy = true;
    setDashboardLivePill(options.fromSocket ? "Live update received" : "Refreshing...");

    if (!options.silent && loading) loading.style.display = "block";
    if (!options.silent && content) content.classList.add("hide");

    let data = null;
    let error = null;

    try {
      if (typeof API !== "undefined" && API && typeof API.getDonationDashboard === "function") {
        data = await API.getDonationDashboard();
      }
    } catch (err) {
      error = err;
    }

    if (!data) {
      data = buildDashboardFallback();
    }

    state.dashboardData = data;
    renderDonationDashboard(data);

    if (loading) loading.style.display = "none";
    if (content) content.classList.remove("hide");
    setDashboardLivePill(error ? "Showing local fallback" : "Live updates active");

    if (error && !options.silent && typeof MC !== "undefined") {
      MC.error(error.message || "Could not refresh the donation dashboard right now.");
    }

    state.dashboardBusy = false;
  }

  function startDonationDashboardRefresh() {
    stopDonationDashboardRefresh();
    state.dashboardIntervalId = window.setInterval(function refreshIfOpen() {
      if (getById("donationDashboardOvl")?.classList.contains("show")) {
        refreshDonationDashboard({ silent: true }).catch(function ignore() {});
      }
    }, DASHBOARD_REFRESH_MS);
  }

  function stopDonationDashboardRefresh() {
    if (state.dashboardIntervalId) {
      clearInterval(state.dashboardIntervalId);
      state.dashboardIntervalId = null;
    }
  }

  function openDashboardModal() {
    closeMandirActionMenu();
    if (getById("liveDarshanOvl")?.classList.contains("show")) {
      closeLiveDarshanModal();
    }
    if (getById("donateOvl")?.classList.contains("show")) {
      closeDonateModalWithState();
    }
    if (typeof openOvl === "function") {
      openOvl("donationDashboardOvl");
    }
    refreshDonationDashboard().catch(function ignore() {});
    startDonationDashboardRefresh();
  }

  function closeDashboardModal() {
    stopDonationDashboardRefresh();
    if (typeof closeOvl === "function") {
      closeOvl("donationDashboardOvl");
    }
  }

  function getLiveDarshanStream(streamId) {
    return (
      LIVE_DARSHAN_STREAMS.find((stream) => stream.id === streamId) ||
      LIVE_DARSHAN_STREAMS[0]
    );
  }

  function getLiveDarshanIndex(streamId) {
    const targetId = streamId || state.activeLiveDarshanId;
    const index = LIVE_DARSHAN_STREAMS.findIndex((stream) => stream.id === targetId);
    return index >= 0 ? index : 0;
  }

  function isLiveDarshanMobileViewport() {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  function setLiveDarshanSwipeOffset(offset) {
    state.liveDarshanTouchOffsetX = offset;

    const frame = document.querySelector(".live-darshan-media-frame");
    const heading = document.querySelector(".live-darshan-heading-wrap");
    const axis = isLiveDarshanMobileViewport() ? "Y" : "X";
    const headingOffset = Math.round(offset * 0.18);

    if (frame) {
      frame.style.transform = offset ? `translate${axis}(${offset}px)` : "";
    }
    if (heading) {
      heading.style.transform = offset ? `translate${axis}(${headingOffset}px)` : "";
    }
  }

  function resetLiveDarshanSwipeOffset() {
    const frame = document.querySelector(".live-darshan-media-frame");
    const heading = document.querySelector(".live-darshan-heading-wrap");

    if (frame) {
      frame.style.transition = "transform 0.18s ease";
    }
    if (heading) {
      heading.style.transition = "transform 0.18s ease";
    }

    setLiveDarshanSwipeOffset(0);

    window.setTimeout(function clearLiveDarshanSwipeTransition() {
      if (frame) frame.style.transition = "";
      if (heading) heading.style.transition = "";
    }, 200);
  }

  function stepLiveDarshan(direction) {
    const total = LIVE_DARSHAN_STREAMS.length;
    if (!total) return;

    const currentIndex = getLiveDarshanIndex();
    const nextIndex = (currentIndex + Number(direction) + total) % total;
    const nextStream = LIVE_DARSHAN_STREAMS[nextIndex];
    if (!nextStream) return;

    state.activeLiveDarshanId = nextStream.id;
    renderActiveLiveDarshan();
  }

  function seedLiveDarshanComments() {
    if (Object.keys(state.liveDarshanComments).length) return;

    LIVE_DARSHAN_STREAMS.forEach((stream) => {
      state.liveDarshanComments[stream.id] = Array.isArray(stream.comments)
        ? stream.comments.map((comment) => ({ ...comment }))
        : [];
    });
  }

  function getActiveLiveDarshanComments() {
    const stream = getLiveDarshanStream(state.activeLiveDarshanId);
    return state.liveDarshanComments[stream.id] || [];
  }

  function pauseLiveDarshanPlayback() {
    const video = getById("liveDarshanVideo");
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    delete video.dataset.streamId;
    video.load();
  }

  function getLiveDarshanMuteIconMarkup(isMuted) {
    if (isMuted) {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 9.5V14.5H8.5L13 18V6L8.5 9.5H5Z"></path>
          <line x1="16.5" y1="8" x2="21" y2="16"></line>
          <line x1="21" y1="8" x2="16.5" y2="16"></line>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 9.5V14.5H8.5L13 18V6L8.5 9.5H5Z"></path>
        <path d="M16 9C17.3 10.2 18 11.9 18 13.5C18 15.1 17.3 16.8 16 18"></path>
        <path d="M18.5 6.5C20.6 8.4 21.75 10.9 21.75 13.5C21.75 16.1 20.6 18.6 18.5 20.5"></path>
      </svg>
    `;
  }

  function syncLiveDarshanMuteUi() {
    const muteButton = getById("liveDarshanMuteBtn");
    if (muteButton) {
      const soundState = state.liveDarshanMuted ? "Sound off" : "Sound on";
      muteButton.innerHTML = getLiveDarshanMuteIconMarkup(state.liveDarshanMuted);
      muteButton.setAttribute("aria-label", soundState);
      muteButton.setAttribute("title", soundState);
    }
  }

  function syncLiveDarshanNavigationUi() {
    const indicator = getById("liveDarshanStreamIndicator");
    const bottom = document.querySelector(".live-darshan-bottom");
    let mobileHint = getById("liveDarshanMobileHint");
    const streamNumber = getLiveDarshanIndex() + 1;
    const total = LIVE_DARSHAN_STREAMS.length;

    if (!mobileHint && bottom) {
      mobileHint = document.createElement("div");
      mobileHint.id = "liveDarshanMobileHint";
      mobileHint.className = "live-darshan-mobile-hint";
      bottom.appendChild(mobileHint);
    }

    if (indicator) {
      indicator.textContent = `Stream ${streamNumber} of ${total}`;
    }
    if (mobileHint) {
      mobileHint.textContent =
        total > 1
          ? isLiveDarshanMobileViewport()
            ? `Stream ${streamNumber} of ${total} - swipe up or down`
            : `Stream ${streamNumber} of ${total} - use arrows or swipe`
          : "Live darshan is ready";
    }
  }

  function renderLiveDarshanComments() {
    const host = getById("liveDarshanComments");
    if (!host) return;

    const comments = getActiveLiveDarshanComments().slice(-6);
    host.innerHTML = comments
      .map((comment) => {
        return `
          <div class="live-darshan-comment">
            <strong>${escapeHtml(comment.user || "Devotee")}</strong>
            <span>${escapeHtml(comment.text || "Jai Shri Radhe 🙏")}</span>
          </div>
        `;
      })
      .join("");

    host.scrollTop = host.scrollHeight;
  }

  function renderLiveDarshanList() {
    const host = getById("liveDarshanList");
    if (!host) return;

    host.innerHTML = LIVE_DARSHAN_STREAMS.map((stream) => {
      const active = stream.id === state.activeLiveDarshanId ? " active" : "";
      return `
        <button class="live-darshan-card${active}" type="button" onclick="selectLiveDarshanStream('${stream.id}')">
          <div class="live-darshan-card-top">
            <img src="${escapeHtml(stream.avatar)}" alt="${escapeHtml(stream.profileName)}" />
            <div>
              <strong>${escapeHtml(stream.profileName)}</strong>
              <span>${escapeHtml(stream.started)}</span>
            </div>
          </div>
          <div class="live-darshan-card-title">${escapeHtml(stream.heading)}</div>
          <div class="live-darshan-card-meta">
            <span class="live-badge">LIVE</span>
            <span>${escapeHtml(formatViewerCount(stream.viewers))} watching</span>
          </div>
        </button>
      `;
    }).join("");
  }

  function renderActiveLiveDarshan() {
    seedLiveDarshanComments();

    const stream = getLiveDarshanStream(state.activeLiveDarshanId);
    const video = getById("liveDarshanVideo");
    const avatar = getById("liveDarshanAvatar");
    const profileName = getById("liveDarshanProfileName");
    const viewers = getById("liveDarshanViewers");
    const started = getById("liveDarshanStarted");
    const heading = getById("liveDarshanHeading");
    const subheading = getById("liveDarshanSubheading");
    const summaryTitle = getById("liveDarshanSummaryTitle");
    const summaryMeta = getById("liveDarshanSummaryMeta");

    if (avatar) avatar.src = stream.avatar;
    if (profileName) profileName.textContent = stream.profileName;
    if (viewers) viewers.textContent = `${formatViewerCount(stream.viewers)} watching`;
    if (started) started.textContent = stream.started;
    if (heading) heading.textContent = stream.heading;
    if (subheading) subheading.textContent = stream.subheading;
    if (summaryTitle) summaryTitle.textContent = stream.heading;
    if (summaryMeta) {
      summaryMeta.textContent =
        `Profile: ${stream.profileName} • Vrindavan • Tap any card below to switch streams instantly.`;
    }

    syncLiveDarshanMuteUi();
    syncLiveDarshanNavigationUi();
    renderLiveDarshanComments();
    renderLiveDarshanList();
    resetLiveDarshanSwipeOffset();

    if (!video) return;

    if (video.dataset.streamId !== stream.id) {
      video.pause();
      video.dataset.streamId = stream.id;
      video.poster = stream.avatar;
      video.src = stream.src;
      video.load();
    }

    video.muted = state.liveDarshanMuted;
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(function recoverAutoPlay() {
        if (!state.liveDarshanMuted) {
          state.liveDarshanMuted = true;
          video.muted = true;
          syncLiveDarshanMuteUi();
          video.play().catch(function ignore() {});
        }
      });
    }
  }

  function selectLiveDarshanStream(streamId) {
    const stream = getLiveDarshanStream(streamId);
    state.activeLiveDarshanId = stream.id;
    renderActiveLiveDarshan();
  }

  function bindLiveDarshanKeyboard() {
    if (state.liveDarshanKeyboardBound) return;

    state.liveDarshanKeyboardBound = true;
    document.addEventListener("keydown", function onLiveDarshanKeydown(event) {
      const modal = getById("liveDarshanOvl");
      if (!modal || !modal.classList.contains("show")) return;

      const activeTag = document.activeElement?.tagName;
      const isEditable =
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        document.activeElement?.isContentEditable;

      if (isEditable) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepLiveDarshan(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepLiveDarshan(1);
      }
    });
  }

  function bindLiveDarshanSwipe() {
    if (state.liveDarshanSwipeBound) return;

    const stage = getById("liveDarshanStage");
    if (!stage) return;

    state.liveDarshanSwipeBound = true;

    stage.addEventListener(
      "touchstart",
      function onLiveDarshanTouchStart(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;

        const frame = document.querySelector(".live-darshan-media-frame");
        const heading = document.querySelector(".live-darshan-heading-wrap");
        if (frame) frame.style.transition = "none";
        if (heading) heading.style.transition = "none";

        state.liveDarshanTouchStartX = touch.clientX;
        state.liveDarshanTouchStartY = touch.clientY;
        state.liveDarshanTouchOffsetX = 0;
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchmove",
      function onLiveDarshanTouchMove(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;

        const dx = touch.clientX - state.liveDarshanTouchStartX;
        const dy = touch.clientY - state.liveDarshanTouchStartY;
        const mobileViewport = isLiveDarshanMobileViewport();

        if (mobileViewport) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
            setLiveDarshanSwipeOffset(Math.max(-58, Math.min(58, dy * 0.18)));
          }
          return;
        }

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) {
          setLiveDarshanSwipeOffset(Math.max(-52, Math.min(52, dx * 0.22)));
        }
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchend",
      function onLiveDarshanTouchEnd(event) {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;

        const dx = touch.clientX - state.liveDarshanTouchStartX;
        const dy = touch.clientY - state.liveDarshanTouchStartY;
        const mobileViewport = isLiveDarshanMobileViewport();

        resetLiveDarshanSwipeOffset();

        if (mobileViewport) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 62) {
            stepLiveDarshan(dy < 0 ? 1 : -1);
          }
          return;
        }

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 54) {
          stepLiveDarshan(dx < 0 ? 1 : -1);
        }
      },
      { passive: true }
    );
  }

  function openLiveDarshanModal(streamId) {
    closeMandirActionMenu();
    if (getById("donateOvl")?.classList.contains("show")) {
      closeDonateModalWithState();
    }
    if (getById("donationDashboardOvl")?.classList.contains("show")) {
      closeDashboardModal();
    }

    seedLiveDarshanComments();
    state.activeLiveDarshanId = getLiveDarshanStream(streamId).id;

    if (typeof openOvl === "function") {
      openOvl("liveDarshanOvl");
    }

    bindLiveDarshanKeyboard();
    bindLiveDarshanSwipe();
    renderActiveLiveDarshan();
  }

  function closeLiveDarshanModal() {
    resetLiveDarshanSwipeOffset();
    pauseLiveDarshanPlayback();
    if (typeof closeOvl === "function") {
      closeOvl("liveDarshanOvl");
    }
  }

  function toggleLiveDarshanMute() {
    state.liveDarshanMuted = !state.liveDarshanMuted;
    const video = getById("liveDarshanVideo");
    if (video) {
      video.muted = state.liveDarshanMuted;
      if (!state.liveDarshanMuted) {
        video.play().catch(function ignore() {});
      }
    }
    syncLiveDarshanMuteUi();
  }

  function getLiveDarshanPranamIconMarkup() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3.2c.76 0 1.38.62 1.38 1.38v8.88h-2.76V4.58c0-.76.62-1.38 1.38-1.38Z"></path>
        <path d="M9.1 3.95c.5.24.86.69.97 1.22l1.08 5.38-1.82 1.88-2.77-4.56c-.44-.72-.31-1.66.31-2.23l1.12-1.03c.34-.31.83-.39 1.11-.66Z"></path>
        <path d="M14.9 3.95c-.5.24-.86.69-.97 1.22l-1.08 5.38 1.82 1.88 2.77-4.56c.44-.72.31-1.66-.31-2.23l-1.12-1.03c-.34-.31-.83-.39-1.11-.66Z"></path>
        <path d="M9.27 12.52 5.3 16.4a1.25 1.25 0 0 0 0 1.79l2.55 2.5c.5.49 1.3.49 1.8 0l2.35-2.3-2.73-5.87Z"></path>
        <path d="m14.73 12.52 3.97 3.88a1.25 1.25 0 0 1 0 1.79l-2.55 2.5c-.5.49-1.3.49-1.8 0L12 18.39l2.73-5.87Z"></path>
      </svg>
    `;
  }

  function spawnLiveDarshanPranam() {
    const lane = getById("liveDarshanReactionLane");
    if (!lane) return;

    const pranam = document.createElement("span");
    const shades = ["#0f4f2b", "#18673a", "#2f7c48", "#8d6a25", "#b88932"];
    pranam.className = "live-darshan-float-pranam";
    pranam.innerHTML = getLiveDarshanPranamIconMarkup();
    pranam.style.color = shades[Math.floor(Math.random() * shades.length)];
    pranam.style.right = `${Math.round(Math.random() * 16)}px`;
    pranam.style.setProperty("--pranam-drift", `${Math.round(Math.random() * 26 - 13)}px`);
    lane.appendChild(pranam);

    window.setTimeout(function removePranam() {
      pranam.remove();
    }, 1700);
  }

  function sendLiveDarshanReaction() {
    for (let index = 0; index < 4; index += 1) {
      window.setTimeout(spawnLiveDarshanPranam, index * 120);
    }
  }

  async function copyTextToClipboard(text) {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    textarea.remove();
    return copied;
  }

  async function shareActiveLiveDarshan() {
    const stream = getLiveDarshanStream(state.activeLiveDarshanId);
    const shareText = `${stream.heading}\n${stream.src}`;

    try {
      const copied = await copyTextToClipboard(shareText);
      if (copied && typeof MC !== "undefined") {
        MC.success("Live darshan link copied.");
      } else if (typeof MC !== "undefined") {
        MC.info("Share this live darshan: " + stream.src);
      }
    } catch {
      if (typeof MC !== "undefined") {
        MC.info("Share link ready: " + stream.src);
      }
    }
  }

  function submitLiveDarshanComment(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    const input = getById("liveDarshanCommentInput");
    const stream = getLiveDarshanStream(state.activeLiveDarshanId);
    if (!input || !stream) return false;

    const rawValue = String(input.value || "").trim();
    const text = rawValue || "Jai Shri Radhe 🙏";
    const user = getStoredUser() || (typeof CU !== "undefined" ? CU : null);
    const userName = user && user.name ? String(user.name).split(/\s+/)[0] : "You";

    state.liveDarshanComments[stream.id] = [
      ...(state.liveDarshanComments[stream.id] || []),
      { user: userName, text },
    ].slice(-12);

    input.value = "";
    renderLiveDarshanComments();
    sendLiveDarshanReaction();
    return false;
  }

  function downloadStoredDonationReceipt(id) {
    const mergedHistory = mergeDonationHistory(
      state.dashboardData?.myHistory || [],
      readGuestDonationHistory()
    );
    const donation =
      (state.latestDonation &&
      (state.latestDonation.id === id || state.latestDonation.receiptNumber === id))
        ? state.latestDonation
        : mergedHistory.find((item) => item.id === id || item.receiptNumber === id);
    downloadDonationReceipt(donation || null);
  }

  function bindDonationRealtime() {
    if (state.socketBound) return;
    if (typeof SocketClient === "undefined" || !SocketClient || !SocketClient.onSocketReady) {
      return;
    }

    state.socketBound = true;
    SocketClient.onSocketReady(function onReady(socket) {
      if (!socket || socket.__tsDonationBound) return;
      socket.__tsDonationBound = true;
      socket.on("donation:update", function onDonationUpdate() {
        setDashboardLivePill("Live update received");
        if (getById("donationDashboardOvl")?.classList.contains("show")) {
          refreshDonationDashboard({ silent: true, fromSocket: true }).catch(function ignore() {});
        }
      });
    });
  }

  function canOpenMandirCompose() {
    const user = getStoredUser();
    return Boolean(
      user &&
        user.mandirId &&
        typeof currentMandirSlug !== "undefined" &&
        currentMandirSlug &&
        user.mandirId === currentMandirSlug &&
        typeof openMandirCompose === "function"
    );
  }

  function setMandirMenuAnchor(trigger) {
    const overlay = getById("mandirActionMenuOvl");
    if (!overlay || !trigger) return;

    const preferredWidth = Math.min(320, window.innerWidth - 24);
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(Math.round(rect.right - preferredWidth), window.innerWidth - preferredWidth - 12)
    );
    const top = Math.round(rect.bottom + 10);

    overlay.style.setProperty("--mandir-menu-left", `${left}px`);
    overlay.style.setProperty("--mandir-menu-top", `${top}px`);
    overlay.style.setProperty("--mandir-menu-width", `${preferredWidth}px`);
  }

  function openMandirActionMenu(trigger, context) {
    state.menuContext = context || "community";
    setMandirMenuAnchor(trigger);
    if (typeof openOvl === "function") {
      openOvl("mandirActionMenuOvl");
    }
  }

  function closeMandirActionMenu() {
    if (typeof closeOvl === "function") {
      closeOvl("mandirActionMenuOvl");
    }
  }

  function handleMandirActionMenu(action) {
    const context = state.menuContext;
    closeMandirActionMenu();

    if (action === "post") {
      if (context === "detail" && canOpenMandirCompose()) {
        openMandirCompose();
        return;
      }
      if (typeof auth === "function") {
        auth(function openExistingPostFlow() {
          if (context === "detail" && canOpenMandirCompose()) {
            openMandirCompose();
            return;
          }
          if (typeof openOvl === "function") {
            openOvl("compOvl");
          }
        });
      }
      return;
    }

    if (action === "live") {
      openLiveDarshanModal();
      return;
    }

    if (action === "seva") {
      openDonateModalWithState();
      return;
    }

    if (action === "dashboard") {
      openDashboardModal();
    }
  }

  function initialiseDonationUi() {
    renderDonationCampaignGrid();
    updateDonationPreview();
    seedDonationIdentity();
    seedLiveDarshanComments();
    renderLiveDarshanList();
    syncLiveDarshanMuteUi();
    syncLiveDarshanNavigationUi();
    bindDonationRealtime();
  }

  window.openDonateModal = openDonateModalWithState;
  window.closeDonateModal = closeDonateModalWithState;
  window.selectDonation = selectDonationAmount;
  window.handleCustomDonation = handleCustomDonationInput;
  window.selectDonationCampaign = setDonationCampaign;
  window.startPayment = beginDonationPayment;
  window.openDonationDashboard = openDashboardModal;
  window.closeDonationDashboard = closeDashboardModal;
  window.refreshDonationDashboard = function refreshDashboardFromUi() {
    return refreshDonationDashboard();
  };
  window.downloadLatestDonationReceipt = function downloadLatestReceipt() {
    downloadDonationReceipt(state.latestDonation);
  };
  window.downloadStoredDonationReceipt = downloadStoredDonationReceipt;
  window.openLiveDarshans = openLiveDarshanModal;
  window.closeLiveDarshans = closeLiveDarshanModal;
  window.selectLiveDarshanStream = selectLiveDarshanStream;
  window.stepLiveDarshan = stepLiveDarshan;
  window.toggleLiveDarshanMute = toggleLiveDarshanMute;
  window.sendLiveDarshanReaction = sendLiveDarshanReaction;
  window.submitLiveDarshanComment = submitLiveDarshanComment;
  window.shareActiveLiveDarshan = shareActiveLiveDarshan;
  window.openMandirActionMenu = openMandirActionMenu;
  window.closeMandirActionMenu = closeMandirActionMenu;
  window.handleMandirActionMenu = handleMandirActionMenu;

  window.addEventListener("load", initialiseDonationUi, { once: true });
  window.addEventListener("focus", function onWindowFocus() {
    if (getById("donationDashboardOvl")?.classList.contains("show")) {
      refreshDonationDashboard({ silent: true }).catch(function ignore() {});
    }
  });
})();
