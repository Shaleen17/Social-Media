const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const founderAccess = require("../../utils/founderAccess");

test("founder access recognizes the default founder email", () => {
  assert.equal(
    founderAccess.isFounderUser({ email: "tirthsutra@gemail.com" }),
    true
  );
  assert.equal(
    founderAccess.isFounderUser({ handle: "tirthsutra" }),
    true
  );
  assert.equal(
    founderAccess.isFounderUser({ email: "someone@example.com" }),
    false
  );
});

test("founder access honors configured founder emails", (t) => {
  const previous = process.env.FOUNDER_OWNER_EMAILS;
  process.env.FOUNDER_OWNER_EMAILS = "owner@example.com,lead@example.com";
  t.after(() => {
    if (previous == null) {
      delete process.env.FOUNDER_OWNER_EMAILS;
    } else {
      process.env.FOUNDER_OWNER_EMAILS = previous;
    }
  });

  assert.deepEqual(founderAccess.getFounderOwnerEmails(), [
    "owner@example.com",
    "lead@example.com",
  ]);
  assert.deepEqual(founderAccess.getFounderOwnerHandles(), ["tirthsutra"]);
  assert.equal(founderAccess.isFounderUser({ email: "lead@example.com" }), true);
});
