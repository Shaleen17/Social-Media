const asyncHandler = require("../utils/asyncHandler");
const {
  createDonationOrder,
  verifyDonationPayment,
  getDonationDashboard,
  getDonationHistory,
} = require("../services/paymentService");

const createRazorpayDonationOrder = asyncHandler(async (req, res) => {
  const result = await createDonationOrder({
    amount: req.body.amount,
    purpose: req.body.purpose,
    donorName: req.user?.name || req.body.name || "",
    donorEmail: req.user?.email || req.body.email || "",
    userId: req.user?.id || req.user?._id || "",
    userObjectId: req.user?._id || null,
  });

  res.status(201).json(result);
});

const verifyRazorpayDonationPayment = asyncHandler(async (req, res) => {
  const result = await verifyDonationPayment(req.body, {
    userObjectId: req.user?._id || null,
  });

  const io = req.app.get("io");
  if (io && result.realtimePayload) {
    io.emit("donation:update", result.realtimePayload);
  }

  res.json(result.clientPayload);
});

const getDonationDashboardData = asyncHandler(async (req, res) => {
  const result = await getDonationDashboard({
    userObjectId: req.user?._id || null,
  });
  res.json(result);
});

const getDonationHistoryData = asyncHandler(async (req, res) => {
  const result = await getDonationHistory({
    userObjectId: req.user?._id || null,
  });
  res.json(result);
});

module.exports = {
  createRazorpayDonationOrder,
  verifyRazorpayDonationPayment,
  getDonationDashboardData,
  getDonationHistoryData,
};
