const express = require("express");
const {
  createRazorpayDonationOrder,
  verifyRazorpayDonationPayment,
  getDonationDashboardData,
  getDonationHistoryData,
} = require("../controllers/paymentController");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/donations/dashboard", optionalAuth, getDonationDashboardData);
router.get("/donations/history", optionalAuth, getDonationHistoryData);
router.post("/razorpay/order", optionalAuth, createRazorpayDonationOrder);
router.post("/razorpay/verify", optionalAuth, verifyRazorpayDonationPayment);

module.exports = router;
