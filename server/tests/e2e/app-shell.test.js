const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");
const { test } = require("../helpers/harness");

const { close, listen, request } = require("../helpers/http");

test("public app shell serves the upgraded entrypoints and PWA assets", async (t) => {
  const publicDir = path.resolve(__dirname, "..", "..", "..", "public");
  const app = express();
  app.use(express.static(publicDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  const { server, baseUrl } = await listen(app);
  t.after(() => close(server));

  const [indexResponse, swResponse, manifestResponse] = await Promise.all([
    request(baseUrl, { path: "/" }),
    request(baseUrl, { path: "/sw.js" }),
    request(baseUrl, { path: "/manifest.webmanifest" }),
  ]);

  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.text, /enhancements-bootstrap\.js/i);
  assert.match(indexResponse.text, /id="feedWrap"[^>]*role="main"/i);
  assert.match(indexResponse.text, /openPrivacyPolicyModal/i);

  assert.equal(swResponse.status, 200);
  assert.match(swResponse.text, /noncritical-enhancements\.js/i);
  assert.match(swResponse.text, /ts-static-/i);

  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.text, /"name"/i);
});
