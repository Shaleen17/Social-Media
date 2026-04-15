const crypto = require("crypto");
const AppError = require("../utils/appError");

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

function buildReceipt() {
  return `don_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAmountToPaise(amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 1) {
    throw new AppError("Donation amount must be at least Rs 1.", 400);
  }

  return Math.round(numericAmount * 100);
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

async function createDonationOrder({
  amount,
  purpose = "Mandir Community",
  donorName = "",
  donorEmail = "",
  userId = "",
}) {
  const { keyId } = getRazorpayCredentials();
  const amountInPaise = normalizeAmountToPaise(amount);
  const order = await razorpayRequest("POST", "/orders", {
    amount: amountInPaise,
    currency: "INR",
    receipt: buildReceipt(),
    notes: {
      purpose,
      donorName: donorName || "Guest",
      donorEmail: donorEmail || "",
      userId: userId ? String(userId) : "",
    },
  });

  return {
    keyId,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    name: "Tirth Sutra",
    description: `Donation to ${purpose}`,
    prefill: {
      name: donorName || "",
      email: donorEmail || "",
    },
    notes: order.notes || {},
  };
}

async function verifyDonationPayment({
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new AppError("Missing Razorpay payment verification fields.", 400);
  }

  if (!signatureMatches(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    throw new AppError("Payment signature verification failed.", 400);
  }

  const payment = await fetchPayment(razorpay_payment_id);
  if (payment.order_id !== razorpay_order_id) {
    throw new AppError("Payment does not match the expected Razorpay order.", 400);
  }

  const settledPayment = await captureAuthorizedPayment(payment);

  return {
    success: true,
    paymentId: settledPayment.id,
    orderId: settledPayment.order_id,
    amount: settledPayment.amount,
    currency: settledPayment.currency,
    status: settledPayment.status,
    method: settledPayment.method,
    email: settledPayment.email || "",
    contact: settledPayment.contact || "",
  };
}

module.exports = {
  createDonationOrder,
  verifyDonationPayment,
};
