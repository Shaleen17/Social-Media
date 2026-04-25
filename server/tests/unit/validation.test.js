const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const {
  cleanEmail,
  cleanHandle,
  cleanHttpUrl,
  cleanString,
  sanitizePlainText,
} = require("../../utils/validation");

test("cleanString strips scripts and markup", () => {
  const value = cleanString(' <script>alert("x")</script><b> Jai Shri Ram </b> ');
  assert.equal(value, "Jai Shri Ram");
});

test("sanitizePlainText preserves line breaks when requested", () => {
  const value = sanitizePlainText("Line 1\r\n\r\n\r\nLine 2", {
    preserveNewlines: true,
  });
  assert.equal(value, "Line 1\n\nLine 2");
});

test("cleanEmail normalizes casing", () => {
  assert.equal(cleanEmail(" Devotee@Example.COM "), "devotee@example.com");
});

test("cleanHandle removes unsafe characters", () => {
  assert.equal(cleanHandle(" @Bhakt Ji!! "), "bhaktji");
});

test("cleanHttpUrl adds an https scheme when needed", () => {
  assert.equal(cleanHttpUrl("tirthsutra.com"), "https://tirthsutra.com/");
});
