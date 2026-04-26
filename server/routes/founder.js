const express = require("express");
const { auth } = require("../middleware/auth");
const { requireFounder } = require("../utils/founderAccess");
const { getFounderOverview } = require("../services/founderDashboardService");
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

module.exports = router;
