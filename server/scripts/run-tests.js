const fs = require("fs");
const path = require("path");
const { run } = require("../tests/helpers/harness");

const TEST_ROOT = path.resolve(__dirname, "..", "tests");

function collectTestFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTestFiles(fullPath);
    }
    return /\.test\.js$/i.test(entry.name) ? [fullPath] : [];
  });
}

collectTestFiles(TEST_ROOT)
  .sort()
  .forEach((filePath) => {
    require(filePath);
  });

run();
