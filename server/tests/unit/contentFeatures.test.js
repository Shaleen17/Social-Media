const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");

const {
  buildSearchText,
  extractHashtags,
  moderateMediaAsset,
  moderateTextContent,
} = require("../../utils/contentFeatures");

test("extractHashtags normalizes and deduplicates tags", () => {
  const tags = extractHashtags("Join #Bhakti and #bhakti today", "#Darshan");
  assert.deepEqual(tags, ["#bhakti", "#darshan"]);
});

test("moderateTextContent flags suspicious spam patterns", () => {
  const result = moderateTextContent([
    "Click here now and whatsapp me for guaranteed profit #Bhakti",
  ]);
  assert.equal(result.status, "needs_review");
  assert.ok(result.flags.includes("spam_phrase"));
  assert.ok(result.flags.includes("spam_contact"));
  assert.ok(result.hashtags.includes("#bhakti"));
});

test("moderateMediaAsset flags oversized long videos", () => {
  const result = moderateMediaAsset({
    mimeType: "video/mp4",
    size: 45 * 1024 * 1024,
    duration: 31 * 60,
  });
  assert.equal(result.status, "needs_review");
  assert.ok(result.flags.includes("oversized_asset"));
  assert.ok(result.flags.includes("long_form_video"));
});

test("buildSearchText produces a flattened searchable string", () => {
  assert.equal(buildSearchText("  Jai  ", [" Radhe ", "", "Shyam"]), "Jai Radhe Shyam");
});
