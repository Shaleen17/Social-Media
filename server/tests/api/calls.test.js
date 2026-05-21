const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("../helpers/harness");
const callRoutes = require("../../routes/calls");
const { close, listen, request } = require("../helpers/http");

test("calling health exposes only safe Daily configuration", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/calls", callRoutes);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: err.message, details: err.details });
  });

  const { server, baseUrl } = await listen(app);
  t.after(() => close(server));

  const response = await request(baseUrl, { path: "/calls/daily/health" });
  const body = response.json();

  assert.equal(response.status, 200);
  assert.equal(body.provider, "daily");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "apiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "DAILY_API_KEY"), false);
});
