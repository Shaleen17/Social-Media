const asyncHandler = require("../utils/asyncHandler");
const {
  createDonationOrder,
  verifyDonationPayment,
} = require("../services/paymentService");

const createRazorpayDonationOrder = asyncHandler(async (req, res) => {
  const result = await createDonationOrder({
    amount: req.body.amount,
    purpose: req.body.purpose,
    donorName: req.user?.name || req.body.name || "",
    donorEmail: req.user?.email || req.body.email || "",
    userId: req.user?.id || req.user?._id || "",
  });

  res.status(201).json(result);
});

const verifyRazorpayDonationPayment = asyncHandler(async (req, res) => {
  const result = await verifyDonationPayment(req.body);
  res.json(result);
});

module.exports = {
  createRazorpayDonationOrder,
  verifyRazorpayDonationPayment,
};
