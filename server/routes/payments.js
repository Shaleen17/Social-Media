const express = require("express");
const {
  createRazorpayDonationOrder,
  verifyRazorpayDonationPayment,
} = require("../controllers/paymentController");
const { optionalAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/razorpay/order", optionalAuth, createRazorpayDonationOrder);
router.post("/razorpay/verify", optionalAuth, verifyRazorpayDonationPayment);

module.exports = router;
