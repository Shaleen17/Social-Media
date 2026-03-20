// Configuration for Frontend
const CONFIG = {
  // If we are running locally, use the local backend server.
  // Otherwise, use the production Render backend URL.
  BACKEND_URL:
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? "http://localhost:5000"
      : "https://YOUR_RENDER_APP_NAME.onrender.com", // <-- UPDATE THIS AFTER DEPLOYING TO RENDER
};
