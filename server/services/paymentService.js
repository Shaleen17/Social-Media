const crypto = require("crypto");
const Donation = require("../models/Donation");
const AppError = require("../utils/appError");

const DONATION_CAMPAIGNS = [
  {
    key: "annadanam-seva",
    title: "Annadanam Seva",
    description: "Prasad meals and food seva for yatris and devotees.",
    goalAmount: 2500000,
    unitAmount: 5100,
    unitLabel: "meal kits funded",
    accent: "#a35c1d",
  },
  {
    key: "gau-seva",
    title: "Gau Seva",
    description: "Daily fodder, shelter support and veterinary care.",
    goalAmount: 1800000,
    unitAmount: 15000,
    unitLabel: "care days funded",
    accent: "#8f6b22",
  },
  {
    key: "mandir-renovation",
    title: "Mandir Renovation",
    description: "Cleaning, restoration and sacred upkeep for mandir spaces.",
    goalAmount: 4500000,
    unitAmount: 30000,
    unitLabel: "upkeep tasks funded",
    accent: "#70442a",
  },
  {
    key: "daily-aarti",
    title: "Daily Aarti",
    description: "Flowers, diyas, bhog and daily puja samagri.",
    goalAmount: 1200000,
    unitAmount: 2100,
    unitLabel: "aarti kits funded",
    accent: "#b26b3d",
  },
];

const DEFAULT_CAMPAIGN_KEY = DONATION_CAMPAIGNS[0].key;
const CAMPAIGN_KEY_LOOKUP = new Map();

DONATION_CAMPAIGNS.forEach((campaign) => {
  CAMPAIGN_KEY_LOOKUP.set(campaign.key, campaign.key);
  CAMPAIGN_KEY_LOOKUP.set(normalizeValue(campaign.key), campaign.key);
  CAMPAIGN_KEY_LOOKUP.set(normalizeValue(campaign.title), campaign.key);
});

function normalizeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getCampaignByKey(key) {
  return (
    DONATION_CAMPAIGNS.find((campaign) => campaign.key === key) ||
    DONATION_CAMPAIGNS[0]
  );
}

function resolveCampaign(input) {
  const normalized = normalizeValue(input);
  const key = CAMPAIGN_KEY_LOOKUP.get(normalized) || DEFAULT_CAMPAIGN_KEY;
  return getCampaignByKey(key);
}

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new AppError(
      "Online donations are not configured yet. Add Razorpay keys on the server.",
      503
    );
  }

  return { keyId, keySecret };
}

function getBasicAuthHeader(keyId, keySecret) {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

function buildRazorpayReceipt() {
  return `don_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildReceiptNumber(donation) {
  const issuedOn = donation.receiptIssuedAt || donation.paidAt || donation.updatedAt || donation.createdAt;
  const date = new Date(issuedOn || Date.now());
  const stamp =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const suffix = String(donation._id || donation.id || "")
    .slice(-6)
    .toUpperCase();
  return `TS-${stamp}-${suffix || "DONATE"}`;
}

function normalizeAmountToPaise(amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 10) {
    throw new AppError("Donation amount must be at least Rs 10.", 400);
  }

  return Math.round(numericAmount * 100);
}

function formatRelativeTime(date) {
  if (!date) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (diffSeconds < 60) return "Just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function maskDonorName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "Devotee";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase() + parts[0].slice(1, 2) + "***";
  }
  return `${parts[0]} ${parts.slice(1).map((part) => `${part.slice(0, 1).toUpperCase()}.`).join(" ")}`.trim();
}

function maskEmail(email) {
  const trimmed = String(email || "").trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return "";
  const [user, domain] = trimmed.split("@");
  if (!user || !domain) return "";
  const start = user.slice(0, 2);
  return `${start}${"*".repeat(Math.max(1, user.length - start.length))}@${domain}`;
}

function buildReceiptPayload(donation, campaign) {
  if (!donation || !donation.receiptNumber) return null;

  return {
    number: donation.receiptNumber,
    issuedAt: donation.receiptIssuedAt || donation.paidAt || donation.updatedAt,
    donorName: donation.donorName || "Guest Devotee",
    donorEmail: donation.donorEmail || "",
    donorContact: donation.donorContact || "",
    amount: donation.amount,
    currency: donation.currency || "INR",
    purpose: campaign.title,
    campaignKey: campaign.key,
    paymentId: donation.paymentId || "",
    orderId: donation.orderId || "",
    paymentMethod: donation.paymentMethod || "",
    verificationNote: "Verified on the server using Razorpay signature and payment capture.",
    lineItems: [
      {
        label: campaign.title,
        amount: donation.amount,
      },
    ],
  };
}

function serializeDonation(donation, { maskSensitive = false, includeReceipt = true } = {}) {
  const campaign = resolveCampaign(donation.campaignKey || donation.purpose);

  return {
    id: String(donation._id || donation.id || ""),
    purpose: campaign.title,
    campaignKey: campaign.key,
    campaign: {
      key: campaign.key,
      title: campaign.title,
      description: campaign.description,
      goalAmount: campaign.goalAmount,
      unitAmount: campaign.unitAmount,
      unitLabel: campaign.unitLabel,
      accent: campaign.accent,
    },
    amount: donation.amount || 0,
    currency: donation.currency || "INR",
    status: donation.status || "created",
    donorName: maskSensitive
      ? maskDonorName(donation.donorName)
      : donation.donorName || "Guest Devotee",
    donorEmail: maskSensitive ? maskEmail(donation.donorEmail) : donation.donorEmail || "",
    donorContact: maskSensitive ? "" : donation.donorContact || "",
    orderId: donation.orderId || "",
    paymentId: donation.paymentId || "",
    paymentMethod: donation.paymentMethod || "",
    receiptNumber: donation.receiptNumber || "",
    receiptIssuedAt: donation.receiptIssuedAt || null,
    paidAt: donation.paidAt || null,
    createdAt: donation.createdAt || null,
    updatedAt: donation.updatedAt || null,
    timelineLabel: formatRelativeTime(donation.paidAt || donation.updatedAt || donation.createdAt),
    verificationLabel:
      donation.status === "captured"
        ? "Verified and captured"
        : donation.status === "authorized"
          ? "Authorized"
          : "Pending verification",
    receipt:
      includeReceipt && !maskSensitive
        ? buildReceiptPayload(donation, campaign)
        : null,
  };
}

function buildImpactUpdates(campaignTotals = []) {
  const totalsByKey = new Map(
    campaignTotals.map((item) => [String(item._id || ""), item])
  );

  return DONATION_CAMPAIGNS.map((campaign) => {
    const aggregate = totalsByKey.get(campaign.key);
    const amount = aggregate ? aggregate.amount : 0;
    const donations = aggregate ? aggregate.donations : 0;
    const latestDonationAt = aggregate ? aggregate.latestDonationAt : null;
    const progressPercent =
      campaign.goalAmount > 0
        ? Math.min(100, Math.round((amount / campaign.goalAmount) * 100))
        : 0;
    const helpedCount =
      campaign.unitAmount > 0 ? Math.floor(amount / campaign.unitAmount) : 0;

    return {
      key: campaign.key,
      title: campaign.title,
      description: campaign.description,
      accent: campaign.accent,
      amount,
      donations,
      goalAmount: campaign.goalAmount,
      progressPercent,
      helpedCount,
      helpedLabel:
        helpedCount > 0
          ? `${helpedCount} ${campaign.unitLabel}`
          : "Awaiting the first verified donation",
      latestDonationAt,
      timelineLabel: formatRelativeTime(latestDonationAt),
    };
  });
}

async function razorpayRequest(method, path, body) {
  const { keyId, keySecret } = getRazorpayCredentials();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: getBasicAuthHeader(keyId, keySecret),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new AppError(
      data.error && data.error.description
        ? data.error.description
        : "Razorpay request failed.",
      response.status || 502,
      data
    );
  }

  return data;
}

function signatureMatches(orderId, paymentId, signature) {
  const { keySecret } = getRazorpayCredentials();
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(String(signature || ""));

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function fetchPayment(paymentId) {
  return razorpayRequest("GET", `/payments/${paymentId}`);
}

async function captureAuthorizedPayment(payment) {
  if (payment.status === "captured") {
    return payment;
  }

  if (payment.status !== "authorized") {
    throw new AppError(
      `Payment is in "${payment.status}" state and cannot be completed.`,
      400
    );
  }

  try {
    return await razorpayRequest("POST", `/payments/${payment.id}/capture`, {
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (error) {
    const refreshedPayment = await fetchPayment(payment.id).catch(() => null);
    if (refreshedPayment && refreshedPayment.status === "captured") {
      return refreshedPayment;
    }
    throw error;
  }
}

async function buildDashboardPayload(userId = null) {
  const [summaryRows, recentRows, campaignRows, myHistoryRows] = await Promise.all([
    Donation.aggregate([
      { $match: { status: "captured" } },
      {
        $group: {
          _id: null,
          totalRaised: { $sum: "$amount" },
          totalDonations: { $sum: 1 },
          averageDonation: { $avg: "$amount" },
          latestDonationAt: { $max: "$paidAt" },
        },
      },
    ]),
    Donation.find({ status: "captured" })
      .sort({ paidAt: -1, createdAt: -1 })
      .limit(8)
      .lean(),
    Donation.aggregate([
      { $match: { status: "captured" } },
      {
        $group: {
          _id: "$campaignKey",
          amount: { $sum: "$amount" },
          donations: { $sum: 1 },
          latestDonationAt: { $max: "$paidAt" },
        },
      },
    ]),
    userId
      ? Donation.find({ user: userId, status: "captured" })
          .sort({ paidAt: -1, createdAt: -1 })
          .limit(20)
          .lean()
      : Promise.resolve([]),
  ]);

  const summary = summaryRows[0] || {};
  const myTotalDonated = myHistoryRows.reduce((sum, item) => sum + (item.amount || 0), 0);

  return {
    summary: {
      totalRaised: summary.totalRaised || 0,
      totalDonations: summary.totalDonations || 0,
      averageDonation: summary.averageDonation ? Math.round(summary.averageDonation) : 0,
      latestDonationAt: summary.latestDonationAt || null,
      latestDonationLabel: formatRelativeTime(summary.latestDonationAt),
    },
    recentDonations: recentRows.map((item) =>
      serializeDonation(item, { maskSensitive: true, includeReceipt: false })
    ),
    impactUpdates: buildImpactUpdates(campaignRows),
    myHistory: myHistoryRows.map((item) => serializeDonation(item)),
    myStats: {
      totalDonated: myTotalDonated,
      donationsCount: myHistoryRows.length,
      latestReceiptNumber: myHistoryRows[0]?.receiptNumber || "",
      latestDonationAt: myHistoryRows[0]?.paidAt || null,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function createDonationOrder({
  amount,
  purpose = "Annadanam Seva",
  donorName = "",
  donorEmail = "",
  userId = "",
  userObjectId = null,
}) {
  const { keyId } = getRazorpayCredentials();
  const amountInPaise = normalizeAmountToPaise(amount);
  const campaign = resolveCampaign(purpose);
  const donation = await Donation.create({
    user: userObjectId || null,
    purpose: campaign.title,
    campaignKey: campaign.key,
    donorName: donorName || "Guest Devotee",
    donorEmail: donorEmail || "",
    amount: amountInPaise,
    currency: "INR",
    status: "created",
    verificationSource: "checkout",
    notes: {
      purpose: campaign.title,
      userId: userId ? String(userId) : "",
    },
  });

  const order = await razorpayRequest("POST", "/orders", {
    amount: amountInPaise,
    currency: "INR",
    receipt: buildRazorpayReceipt(),
    notes: {
      purpose: campaign.title,
      campaignKey: campaign.key,
      donorName: donorName || "Guest Devotee",
      donorEmail: donorEmail || "",
      userId: userId ? String(userId) : "",
      donationId: String(donation._id),
    },
  });

  donation.orderId = order.id;
  donation.orderStatus = order.status || "created";
  donation.razorpayReceipt = order.receipt || "";
  donation.notes = {
    ...(donation.notes || {}),
    donationId: String(donation._id),
    razorpayOrderReceipt: order.receipt || "",
  };
  await donation.save();

  return {
    donationId: String(donation._id),
    keyId,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    name: "Tirth Sutra",
    description: `${campaign.title} via Tirth Sutra`,
    prefill: {
      name: donorName || "",
      email: donorEmail || "",
    },
    notes: order.notes || {},
    campaign: {
      key: campaign.key,
      title: campaign.title,
      description: campaign.description,
    },
  };
}

async function verifyDonationPayment(
  { razorpay_order_id, razorpay_payment_id, razorpay_signature },
  { userObjectId = null } = {}
) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new AppError("Missing Razorpay payment verification fields.", 400);
  }

  const donation = await Donation.findOne({ orderId: razorpay_order_id });
  if (!donation) {
    throw new AppError("Donation order could not be found for verification.", 404);
  }

  if (!signatureMatches(donation.orderId, razorpay_payment_id, razorpay_signature)) {
    throw new AppError("Payment signature verification failed.", 400);
  }

  if (
    donation.status === "captured" &&
    donation.paymentId &&
    donation.paymentId === razorpay_payment_id
  ) {
    const dashboard = await buildDashboardPayload(userObjectId || donation.user || null);
    return {
      alreadyVerified: true,
      clientPayload: {
        success: true,
        donation: serializeDonation(donation),
        dashboard,
      },
      realtimePayload: null,
    };
  }

  const payment = await fetchPayment(razorpay_payment_id);
  if (payment.order_id !== donation.orderId) {
    throw new AppError("Payment does not match the expected Razorpay order.", 400);
  }

  const settledPayment = await captureAuthorizedPayment(payment);

  donation.user = donation.user || userObjectId || null;
  donation.status = settledPayment.status || "captured";
  donation.orderStatus = settledPayment.status === "captured" ? "paid" : donation.orderStatus;
  donation.paymentId = settledPayment.id;
  donation.paymentStatus = settledPayment.status || "";
  donation.paymentMethod = settledPayment.method || "";
  donation.razorpaySignature = razorpay_signature;
  donation.donorEmail = donation.donorEmail || settledPayment.email || "";
  donation.donorContact = settledPayment.contact || donation.donorContact || "";
  donation.receiptIssuedAt = donation.receiptIssuedAt || new Date();
  donation.receiptNumber = donation.receiptNumber || buildReceiptNumber(donation);
  donation.paidAt = donation.paidAt
    || (settledPayment.created_at ? new Date(settledPayment.created_at * 1000) : new Date());

  await donation.save();

  const dashboard = await buildDashboardPayload(donation.user || null);

  return {
    alreadyVerified: false,
    clientPayload: {
      success: true,
      donation: serializeDonation(donation),
      dashboard,
    },
    realtimePayload: {
      summary: dashboard.summary,
      impactUpdates: dashboard.impactUpdates,
      recentDonation: serializeDonation(donation, {
        maskSensitive: true,
        includeReceipt: false,
      }),
      generatedAt: dashboard.generatedAt,
    },
  };
}

async function getDonationDashboard({ userObjectId = null } = {}) {
  return buildDashboardPayload(userObjectId || null);
}

async function getDonationHistory({ userObjectId = null } = {}) {
  if (!userObjectId) {
    return {
      donations: [],
      stats: {
        totalDonated: 0,
        donationsCount: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  const donations = await Donation.find({ user: userObjectId, status: "captured" })
    .sort({ paidAt: -1, createdAt: -1 })
    .limit(50)
    .lean();

  return {
    donations: donations.map((item) => serializeDonation(item)),
    stats: {
      totalDonated: donations.reduce((sum, item) => sum + (item.amount || 0), 0),
      donationsCount: donations.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  DONATION_CAMPAIGNS,
  createDonationOrder,
  verifyDonationPayment,
  getDonationDashboard,
  getDonationHistory,
};
