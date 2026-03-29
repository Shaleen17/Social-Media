const express = require("express");
const PushSubscription = require("../models/PushSubscription");
const { auth } = require("../middleware/auth");
const { getPublicVapidKey } = require("../utils/push");

const router = express.Router();

router.get("/public-key", auth, (req, res) => {
  res.json({ publicKey: getPublicVapidKey() });
});

router.post("/", auth, async (req, res) => {
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
      { endpoint: subscription.endpoint },
      {
        user: req.user._id,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: req.get("user-agent") || "",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save push subscription error:", err);
    res.status(500).json({ error: "Could not save push subscription" });
  }
});

router.delete("/", auth, async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: "Subscription endpoint required" });
    }

    await PushSubscription.deleteOne({
      user: req.user._id,
      endpoint,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Delete push subscription error:", err);
    res.status(500).json({ error: "Could not delete push subscription" });
  }
});

module.exports = router;
