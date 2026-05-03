const asyncHandler = require("../utils/asyncHandler");
const {
  createDonationOrder,
  getDonationDashboardCacheKey,
  getDonationHistoryCacheKey,
  verifyDonationPayment,
  getDonationDashboard,
  getDonationHistory,
} = require("../services/paymentService");
const {
  applyRedisCacheHeader,
  invalidateRedisCacheNamespaces,
  withRedisJsonCache,
} = require("../services/redisCache");

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
  invalidateRedisCacheNamespaces(["payments"]).catch(() => 0);

  const io = req.app.get("io");
  if (io && result.realtimePayload) {
    io.emit("donation:update", result.realtimePayload);
  }

  res.json(result.clientPayload);
});

const getDonationDashboardData = asyncHandler(async (req, res) => {
  const cacheKey = getDonationDashboardCacheKey(req.user?._id || null);
  const { status: cacheStatus, value: result } = await withRedisJsonCache(
    cacheKey,
    () =>
      getDonationDashboard({
        userObjectId: req.user?._id || null,
      }),
    { ttlSeconds: req.user?._id ? 90 : 180 }
  );
  applyRedisCacheHeader(res, cacheStatus);
  res.json(result);
});

const getDonationHistoryData = asyncHandler(async (req, res) => {
  const cacheKey = getDonationHistoryCacheKey(req.user?._id || null);
  const { status: cacheStatus, value: result } = await withRedisJsonCache(
    cacheKey,
    () =>
      getDonationHistory({
        userObjectId: req.user?._id || null,
      }),
    { ttlSeconds: req.user?._id ? 120 : 60 }
  );
  applyRedisCacheHeader(res, cacheStatus);
  res.json(result);
});

module.exports = {
  createRazorpayDonationOrder,
  verifyRazorpayDonationPayment,
  getDonationDashboardData,
  getDonationHistoryData,
};
