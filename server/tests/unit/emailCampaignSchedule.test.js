const assert = require("node:assert/strict");
const { test } = require("../helpers/harness");
const { buildSchedule } = require("../../services/emailCampaignService");

test("email campaign schedules the first opted-in email immediately", () => {
  const previousImmediate = process.env.EMAIL_CAMPAIGN_FIRST_EMAIL_IMMEDIATE;
  process.env.EMAIL_CAMPAIGN_FIRST_EMAIL_IMMEDIATE = "true";

  try {
    const startDate = new Date("2026-05-22T10:15:30.000Z");
    const schedule = buildSchedule(startDate);

    assert.equal(schedule[0].contentItem.contentIndex, 1);
    assert.equal(schedule[0].scheduledFor.toISOString(), startDate.toISOString());
  } finally {
    if (previousImmediate === undefined) {
      delete process.env.EMAIL_CAMPAIGN_FIRST_EMAIL_IMMEDIATE;
    } else {
      process.env.EMAIL_CAMPAIGN_FIRST_EMAIL_IMMEDIATE = previousImmediate;
    }
  }
});
