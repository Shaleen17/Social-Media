const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");

let vapidKeys = null;

function getVapidKeys() {
  if (vapidKeys) return vapidKeys;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (publicKey && privateKey) {
    vapidKeys = { publicKey, privateKey };
    return vapidKeys;
  }

  vapidKeys = webpush.generateVAPIDKeys();
  console.warn(
    "Push notifications: VAPID keys were generated in memory. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in server/.env to keep subscriptions stable across restarts."
  );
  return vapidKeys;
}

function configureWebPush() {
  const keys = getVapidKeys();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@tirthsutra.local",
    keys.publicKey,
    keys.privateKey
  );
  return keys;
}

function getPublicVapidKey() {
  return configureWebPush().publicKey;
}

async function sendPushToUsers(userIds, payload) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;

  configureWebPush();

  const subscriptions = await PushSubscription.find({
    user: { $in: userIds },
  }).lean();

  if (!subscriptions.length) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          body
        );
      } catch (err) {
        const statusCode = err.statusCode || err.code;
        if (statusCode === 404 || statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
          return;
        }
        console.error("Push notification send error:", err.message);
      }
    })
  );
}

module.exports = {
  getPublicVapidKey,
  sendPushToUsers,
};
