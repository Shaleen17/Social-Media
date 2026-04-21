const MAX_ROUTE_STATS = 80;
const MAX_RECENT_ERRORS = 30;

const metrics = {
  startedAt: new Date(),
  totalRequests: 0,
  totalApiRequests: 0,
  totalErrors: 0,
  statusCounts: {},
  methodCounts: {},
  routeStats: new Map(),
  recentErrors: [],
};

function recordRoute(path, method, statusCode, durationMs) {
  const routeKey = `${method} ${String(path || "").split("?")[0]}`;
  const current =
    metrics.routeStats.get(routeKey) ||
    {
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
      lastStatus: 0,
      lastSeenAt: null,
    };

  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastStatus = statusCode;
  current.lastSeenAt = new Date().toISOString();
  if (statusCode >= 500) current.errors += 1;

  metrics.routeStats.set(routeKey, current);

  if (metrics.routeStats.size > MAX_ROUTE_STATS) {
    const oldestKey = metrics.routeStats.keys().next().value;
    metrics.routeStats.delete(oldestKey);
  }
}

function monitoringMiddleware(req, res, next) {
  const startedAt = Date.now();
  metrics.totalRequests += 1;
  metrics.methodCounts[req.method] = (metrics.methodCounts[req.method] || 0) + 1;
  if (req.originalUrl?.startsWith("/api/")) metrics.totalApiRequests += 1;

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const statusKey = String(res.statusCode);
    metrics.statusCounts[statusKey] = (metrics.statusCounts[statusKey] || 0) + 1;
    if (res.statusCode >= 500) metrics.totalErrors += 1;
    if (req.originalUrl?.startsWith("/api/")) {
      recordRoute(req.originalUrl, req.method, res.statusCode, durationMs);
    }
  });

  next();
}

function recordError(error, req) {
  metrics.totalErrors += 1;
  metrics.recentErrors.unshift({
    ts: new Date().toISOString(),
    message: error.message || "Server error",
    statusCode: error.statusCode || 500,
    method: req?.method,
    path: req?.originalUrl,
    userId: req?.user?._id?.toString(),
  });
  metrics.recentErrors = metrics.recentErrors.slice(0, MAX_RECENT_ERRORS);
}

function getMonitoringSnapshot() {
  const routeStats = Array.from(metrics.routeStats.entries()).map(([route, stat]) => ({
    route,
    count: stat.count,
    errors: stat.errors,
    avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : 0,
    maxMs: stat.maxMs,
    lastStatus: stat.lastStatus,
    lastSeenAt: stat.lastSeenAt,
  }));

  return {
    startedAt: metrics.startedAt.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    totalRequests: metrics.totalRequests,
    totalApiRequests: metrics.totalApiRequests,
    totalErrors: metrics.totalErrors,
    statusCounts: metrics.statusCounts,
    methodCounts: metrics.methodCounts,
    routeStats,
    recentErrors: metrics.recentErrors,
  };
}

module.exports = {
  getMonitoringSnapshot,
  monitoringMiddleware,
  recordError,
};
