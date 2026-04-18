const express = require("express");
const AppError = require("../utils/appError");
const {
  getSupportedLanguages,
  translateBatch,
} = require("../services/translationService");

const router = express.Router();

router.get("/languages", async (req, res, next) => {
  try {
    const languages = await getSupportedLanguages();
    res.json({ languages });
  } catch (error) {
    next(error);
  }
});

router.post("/batch", async (req, res, next) => {
  try {
    const { texts, source = "auto", target, format = "text" } = req.body || {};

    if (!Array.isArray(texts)) {
      throw new AppError("texts must be an array", 400);
    }

    const result = await translateBatch({
      texts,
      source,
      target,
      format,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
