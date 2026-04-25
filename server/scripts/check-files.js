const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..");

const JS_FILES = [
  "server.js",
  "controllers/authController.js",
  "middleware/auth.js",
  "middleware/csrf.js",
  "routes/analytics.js",
  "routes/founder.js",
  "routes/messages.js",
  "routes/search.js",
  "routes/users.js",
  "services/founderDashboardService.js",
  "services/redisRealtime.js",
  "utils/authTokens.js",
  "utils/cookies.js",
  "utils/contentFeatures.js",
  "utils/validation.js",
  "../public/api.js",
  "../public/enhancements-bootstrap.js",
  "../public/founder-control.js",
  "../public/noncritical-enhancements.js",
  "../public/sw.js",
];

function runNodeCheck(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  try {
    new vm.Script(source, { filename: filePath });
  } catch (error) {
    throw new Error(`Syntax check failed for ${filePath}\n${error.message}`);
  }
}

function assertPublicAsset(html, fragment) {
  if (!html.includes(fragment)) {
    throw new Error(`Expected public/index.html to reference ${fragment}`);
  }
}

function main() {
  JS_FILES.forEach((relativePath) => {
    const absolutePath = path.resolve(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Missing required file: ${absolutePath}`);
    }
    runNodeCheck(absolutePath);
  });

  const indexHtmlPath = path.join(WORKSPACE_ROOT, "public", "index.html");
  const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
  assertPublicAsset(indexHtml, "enhancements-bootstrap.js");
  assertPublicAsset(indexHtml, "api.js");
  assertPublicAsset(indexHtml, "Script.js");
  assertPublicAsset(indexHtml, 'role="main"');

  console.log("Syntax and shell checks passed.");
}

main();
