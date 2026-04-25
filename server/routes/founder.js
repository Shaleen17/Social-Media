const express = require("express");
const { auth } = require("../middleware/auth");
const { requireFounder } = require("../utils/founderAccess");
const { getFounderOverview } = require("../services/founderDashboardService");

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

module.exports = router;
