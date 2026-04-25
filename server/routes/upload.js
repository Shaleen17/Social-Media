const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { auth } = require("../middleware/auth");
const AppError = require("../utils/appError");
const { moderateMediaAsset } = require("../utils/contentFeatures");
const { cleanString } = require("../utils/validation");

const router = express.Router();
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 25 * 1024 * 1024);
const MAX_IMAGE_BYTES = Number(process.env.UPLOAD_IMAGE_MAX_BYTES || 5 * 1024 * 1024);
const MAX_VIDEO_BYTES = Number(process.env.UPLOAD_VIDEO_MAX_BYTES || 25 * 1024 * 1024);
const MAX_AUDIO_BYTES = Number(process.env.UPLOAD_AUDIO_MAX_BYTES || 10 * 1024 * 1024);
const MAX_DOCUMENT_BYTES = Number(process.env.UPLOAD_DOCUMENT_MAX_BYTES || 5 * 1024 * 1024);
const MAX_BASE64_BYTES = Number(process.env.UPLOAD_BASE64_MAX_BYTES || 8 * 1024 * 1024);

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

function getMaxBytesForType(type) {
  if (type === "image") return MAX_IMAGE_BYTES;
  if (type === "video") return MAX_VIDEO_BYTES;
  if (type === "audio") return MAX_AUDIO_BYTES;
  return MAX_DOCUMENT_BYTES;
}

function runSingleUpload(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("File is too large", 413, { maxBytes: MAX_UPLOAD_BYTES }));
    }
    next(new AppError(error.message || "Upload failed", 400));
  });
}

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (isSupportedUploadType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image, video, audio, and document files are allowed"), false);
    }
  },
});

// POST /api/upload — upload single file to Cloudinary
router.post("/", auth, runSingleUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { folder, resourceType, type } = getUploadTarget(req.file.mimetype);
    const maxBytes = getMaxBytesForType(type);
    if (req.file.size > maxBytes) {
      throw new AppError(`${type} file is too large`, 413, { maxBytes });
    }

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
      moderation: moderateMediaAsset({
        mimeType: req.file.mimetype,
        name: req.file.originalname,
        size: req.file.size,
        duration: result.duration || null,
      }),
      processing:
        type === "video"
          ? {
              status: "ready",
              profile: "adaptive-ready",
              optimizedAt: new Date().toISOString(),
            }
          : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/base64 — upload base64 data (for avatar/banner from data URLs)
router.post("/base64", auth, async (req, res, next) => {
  try {
    const { data, folder = "tirth-sutra/images" } = req.body;
    if (!data) return res.status(400).json({ error: "No data provided" });
    const safeData = cleanString(data, {
      field: "Upload data",
      max: MAX_BASE64_BYTES,
      required: true,
    });
    if (!/^data:(image|video|audio)\//i.test(safeData)) {
      throw new AppError("Base64 upload must be an image, video, or audio data URL", 400);
    }
    const safeFolder =
      cleanString(folder, { field: "Upload folder", max: 120 }) || "tirth-sutra/images";
    if (!safeFolder.startsWith("tirth-sutra/") || safeFolder.includes("..")) {
      throw new AppError("Invalid upload folder", 400);
    }

    const result = await cloudinary.uploader.upload(safeData, {
      folder: safeFolder,
      resource_type: "auto",
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    });

    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      moderation: moderateMediaAsset({
        mimeType: String(result.resource_type || "image"),
        size: Buffer.byteLength(safeData, "utf8"),
      }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
