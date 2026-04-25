(function initEnhancementBootstrap(global) {
  const VERSION = "20260425-founder-control-room-1";
  const SCRIPT_ID = "ts-noncritical-enhancements";
  let started = false;

  function loadNonCriticalEnhancements() {
    if (started) return;
    started = true;

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `noncritical-enhancements.js?v=${VERSION}`;
    script.async = true;
    document.body.appendChild(script);
  }

  function scheduleLoad() {
    if ("requestIdleCallback" in global) {
      global.requestIdleCallback(loadNonCriticalEnhancements, { timeout: 1800 });
    } else {
      global.setTimeout(loadNonCriticalEnhancements, 900);
    }
  }

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    global.addEventListener(
      eventName,
      () => {
        loadNonCriticalEnhancements();
      },
      { once: true, passive: true }
    );
  });

  if (document.readyState === "complete" || document.readyState === "interactive") {
    scheduleLoad();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        scheduleLoad();
      },
      { once: true }
    );
  }
})(window);
