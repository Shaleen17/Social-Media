const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("../helpers/harness");

const { csrfCookieBootstrap, csrfProtection } = require("../../middleware/csrf");
const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
} = require("../../utils/cookies");
const { close, listen, request } = require("../helpers/http");

function extractCookieValue(setCookies, name) {
  const target = Array.isArray(setCookies)
    ? setCookies.find((value) => value.startsWith(`${name}=`))
    : "";
  return target ? target.split(";")[0].split("=")[1] : "";
}

test("csrf bootstrap sets a csrf cookie and response header", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(csrfCookieBootstrap);
  app.get("/csrf", (req, res) => {
    res.json({ ok: true });
  });
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  const { server, baseUrl } = await listen(app);
  t.after(() => close(server));

  const response = await request(baseUrl, { path: "/csrf" });
  assert.equal(response.status, 200);
  assert.match(response.headers["x-csrf-token"] || "", /^[a-f0-9]{48}$/);
  assert.ok(
    Array.isArray(response.headers["set-cookie"]) &&
      response.headers["set-cookie"].some((value) =>
        value.startsWith(`${CSRF_COOKIE_NAME}=`)
      )
  );
});

test("csrf protection blocks cookie-auth writes without a matching header", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(csrfCookieBootstrap);
  app.use(csrfProtection);
  app.post("/submit", (req, res) => {
    res.json({ ok: true });
  });
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  const { server, baseUrl } = await listen(app);
  t.after(() => close(server));

  const bootstrap = await request(baseUrl, { path: "/submit", method: "OPTIONS" });
  const csrfToken =
    bootstrap.headers["x-csrf-token"] ||
    extractCookieValue(bootstrap.headers["set-cookie"], CSRF_COOKIE_NAME);

  const blocked = await request(baseUrl, {
    path: "/submit",
    method: "POST",
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=demo-token; ${CSRF_COOKIE_NAME}=${csrfToken}`,
    },
    body: { ok: true },
  });
  assert.equal(blocked.status, 403);

  const allowed = await request(baseUrl, {
    path: "/submit",
    method: "POST",
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=demo-token; ${CSRF_COOKIE_NAME}=${csrfToken}`,
      "x-csrf-token": csrfToken,
    },
    body: { ok: true },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.json(), { ok: true });
});
