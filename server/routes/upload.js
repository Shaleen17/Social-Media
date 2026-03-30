const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { auth } = require("../middleware/auth");

const router = express.Router();

function isSupportedUploadType(mimeType = "") {
  return (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/") ||
    mimeType === "application/pdf" ||
    mimeType === "text/plain" ||
    mimeType === "application/msword" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

function getUploadTarget(mimeType = "") {
  if (mimeType.startsWith("image/")) {
    return { folder: "tirth-sutra/images", resourceType: "image", type: "image" };
  }
  if (mimeType.startsWith("video/")) {
    return { folder: "tirth-sutra/videos", resourceType: "video", type: "video" };
  }
  if (mimeType.startsWith("audio/")) {
    return { folder: "tirth-sutra/audio", resourceType: "video", type: "audio" };
  }
  return { folder: "tirth-sutra/documents", resourceType: "raw", type: "document" };
}

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (isSupportedUploadType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image, video, audio, and document files are allowed"), false);
    }
  },
});

// POST /api/upload — upload single file to Cloudinary
router.post("/", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { folder, resourceType, type } = getUploadTarget(req.file.mimetype);

    // Upload to Cloudinary via stream
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          transformation:
            type === "image"
              ? [{ quality: "auto", fetch_format: "auto" }]
              : undefined,
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
      type,
      mimeType: req.file.mimetype,
      name: req.file.originalname,
      size: req.file.size,
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
