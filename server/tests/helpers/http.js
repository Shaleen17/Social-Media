const http = require("http");

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function close(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function request(baseUrl, options = {}) {
  const target = new URL(options.path || "/", baseUrl);
  const body =
    typeof options.body === "string"
      ? options.body
      : options.body != null
        ? JSON.stringify(options.body)
        : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      target,
      {
        method: options.method || "GET",
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: chunks,
            json() {
              return chunks ? JSON.parse(chunks) : {};
            },
          });
        });
      }
    );

    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  close,
  listen,
  request,
};
