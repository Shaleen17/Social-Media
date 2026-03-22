// Configuration for Frontend
const CONFIG = {
  // Vercel Serverless handles the standard API requests
  BACKEND_URL:
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      : "", 

  // Socket.io requires a persistent connection, so we keep it on Render
  SOCKET_URL:
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      : "https://tirth-sutra-backend.onrender.com",
};
