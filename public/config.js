// Configuration for Frontend
const CONFIG = {
  // If we are running locally, use the local backend server.
  // Otherwise, use the production Render backend URL.
  BACKEND_URL:
    window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      : "https://tirth-sutra-backend.onrender.com", // Update this if your backend URL changes
};
