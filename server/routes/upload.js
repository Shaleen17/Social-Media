const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { auth } = require("../middleware/auth");

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"), false);
    }
  },
});

// POST /api/upload — upload single file to Cloudinary
router.post("/", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const isVideo = req.file.mimetype.startsWith("video/");
    const folder = isVideo ? "tirth-sutra/videos" : "tirth-sutra/images";
    const resourceType = isVideo ? "video" : "image";

    // Upload to Cloudinary via stream
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          transformation: isVideo
            ? undefined
            : [{ quality: "auto", fetch_format: "auto" }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      type: resourceType,
      width: result.width,
      height: result.height,
      duration: result.duration || null,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// POST /api/upload/base64 — upload base64 data (for avatar/banner from data URLs)
router.post("/base64", auth, async (req, res) => {
  try {
    const { data, folder = "tirth-sutra/images" } = req.body;
    if (!data) return res.status(400).json({ error: "No data provided" });

    const result = await cloudinary.uploader.upload(data, {
      folder,
      resource_type: "auto",
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    });

    res.json({
      url: result.secure_url,
      publicId: result.public_id,
    });
  } catch (err) {
    console.error("Base64 upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

module.exports = router;
