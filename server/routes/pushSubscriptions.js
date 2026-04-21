const express = require("express");
const PushSubscription = require("../models/PushSubscription");
const { auth } = require("../middleware/auth");
const { getPublicVapidKey } = require("../utils/push");
const { cleanHttpUrl, cleanString } = require("../utils/validation");

const router = express.Router();

router.get("/public-key", auth, (req, res) => {
  res.json({ publicKey: getPublicVapidKey() });
});

router.post("/", auth, async (req, res, next) => {
  try {
    const subscription = req.body?.subscription;
    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return res.status(400).json({ error: "Valid push subscription required" });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint: cleanHttpUrl(subscription.endpoint, { field: "Subscription endpoint" }) },
      {
        user: req.user._id,
        endpoint: cleanHttpUrl(subscription.endpoint, { field: "Subscription endpoint" }),
        keys: {
          p256dh: cleanString(subscription.keys.p256dh, { field: "Push key", max: 500, required: true }),
          auth: cleanString(subscription.keys.auth, { field: "Push auth", max: 200, required: true }),
        },
        userAgent: cleanString(req.get("user-agent"), { field: "User agent", max: 500 }),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/", auth, async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: "Subscription endpoint required" });
    }

    await PushSubscription.deleteOne({
      user: req.user._id,
      endpoint: cleanHttpUrl(endpoint, { field: "Subscription endpoint" }),
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
