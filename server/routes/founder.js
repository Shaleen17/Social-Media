const express = require("express");
const { auth } = require("../middleware/auth");
const { requireFounder } = require("../utils/founderAccess");
const {
  getFounderOverview,
  getFounderButtonPulse,
  getFounderFunnel,
} = require("../services/founderDashboardService");
const {
  getFounderUserDirectory,
  getFounderUserIntelligence,
} = require("../services/founderUserIntelligenceService");
const {
  cleanEnum,
  cleanString,
  validateObjectIdParam,
} = require("../utils/validation");

const router = express.Router();

function writeFounderStreamChunk(res, type, payload) {
  try {
    res.write(`${JSON.stringify({ type, payload })}\n`);
  } catch {}
}

function initFounderStream(res) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

router.get("/button", auth, requireFounder, async (req, res, next) => {
  try {
    const badge = await getFounderButtonPulse({
      app: req.app,
    });
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(badge);
  } catch (error) {
    next(error);
  }
});

router.get("/overview", auth, requireFounder, async (req, res, next) => {
  try {
    const overview = await getFounderOverview({
      app: req.app,
    });

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

router.get("/users", auth, requireFounder, async (req, res, next) => {
  try {
    const directory = await getFounderUserDirectory({
      app: req.app,
      page: req.query?.page,
      limit: req.query?.limit,
      q: cleanString(req.query?.q || "", {
        field: "Founder search",
        max: 80,
      }),
      sort: cleanEnum(req.query?.sort, ["active", "engaged", "newest"], "active"),
    });

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(directory);
  } catch (error) {
    next(error);
  }
});

router.get("/funnel", auth, requireFounder, async (req, res, next) => {
  try {
    const steps = String(req.query?.steps || "")
      .split(",")
      .map((value) => cleanString(value, { max: 40 }).trim())
      .filter(Boolean);
    const snapshot = await getFounderFunnel({ steps });
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

router.get("/stream", auth, requireFounder, async (req, res) => {
  initFounderStream(res);

  const fetchAndWrite = async () => {
    try {
      const [overview, directory, badge] = await Promise.all([
        getFounderOverview({ app: req.app }),
        getFounderUserDirectory({
          app: req.app,
          page: req.query?.page,
          limit: req.query?.limit,
          q: cleanString(req.query?.q || "", {
            field: "Founder search",
            max: 80,
          }),
          sort: cleanEnum(req.query?.sort, ["active", "engaged", "newest"], "active"),
        }),
        getFounderButtonPulse({ app: req.app }),
      ]);
      writeFounderStreamChunk(res, "overview", overview);
      writeFounderStreamChunk(res, "directory", directory);
      writeFounderStreamChunk(res, "button", badge);
    } catch (error) {
      writeFounderStreamChunk(res, "error", {
        message: error?.message || "Founder stream unavailable.",
      });
    }
  };

  await fetchAndWrite();
  const timerId = setInterval(fetchAndWrite, 12000);
  const heartbeatId = setInterval(() => {
    writeFounderStreamChunk(res, "heartbeat", { ts: new Date().toISOString() });
  }, 25000);

  const cleanup = () => {
    clearInterval(timerId);
    clearInterval(heartbeatId);
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
});

router.get(
  "/users/:userId/intelligence",
  auth,
  requireFounder,
  validateObjectIdParam("userId"),
  async (req, res, next) => {
    try {
      const intelligence = await getFounderUserIntelligence({
        app: req.app,
        userId: req.params.userId,
      });

      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.json(intelligence);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/users/:userId/stream",
  auth,
  requireFounder,
  validateObjectIdParam("userId"),
  async (req, res) => {
    initFounderStream(res);

    const fetchAndWrite = async () => {
      try {
        const intelligence = await getFounderUserIntelligence({
          app: req.app,
          userId: req.params.userId,
        });
        writeFounderStreamChunk(res, "detail", intelligence);
      } catch (error) {
        writeFounderStreamChunk(res, "error", {
          status: Number(error?.statusCode || error?.status || 500),
          message: error?.message || "Founder user stream unavailable.",
        });
      }
    };

    await fetchAndWrite();
    const timerId = setInterval(fetchAndWrite, 7000);
    const heartbeatId = setInterval(() => {
      writeFounderStreamChunk(res, "heartbeat", { ts: new Date().toISOString() });
    }, 25000);

    const cleanup = () => {
      clearInterval(timerId);
      clearInterval(heartbeatId);
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
  }
);

module.exports = router;
