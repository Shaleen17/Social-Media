require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const cronScheduler = require("../cron/scheduler");
const { initializeRedisCache } = require("../services/redisCache");

function getRequestedJobNames(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  return args.filter((value) => value && value !== "--all");
}

async function main() {
  const requestedNames = getRequestedJobNames(process.argv);

  await connectDB();
  await initializeRedisCache().catch(() => null);

  const result = await cronScheduler.runCronJobs(requestedNames, {
    trigger: process.env.RENDER ? "render-cron" : "cli",
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.results.some((item) => item.status === "error")) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
