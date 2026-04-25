const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runCleanup(cleanups) {
  for (const cleanup of cleanups.reverse()) {
    await cleanup();
  }
}

async function run() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    const cleanups = [];
    const context = {
      after(cleanup) {
        if (typeof cleanup === "function") {
          cleanups.push(cleanup);
        }
      },
    };

    try {
      await fn(context);
      await runCleanup(cleanups);
      passed += 1;
      console.log(`ok - ${name}`);
    } catch (error) {
      try {
        await runCleanup(cleanups);
      } catch {}
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  run,
  test,
};
