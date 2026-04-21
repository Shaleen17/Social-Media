require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { createDatabaseBackup } = require("../services/backupService");

async function run() {
  await connectDB();
  const backup = await createDatabaseBackup("cli");
  console.log(JSON.stringify({ success: true, backup }, null, 2));
}

run()
  .catch((error) => {
    console.error("Backup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
