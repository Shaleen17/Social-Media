const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { name, handle, email, password } = req.body;
    if (!name || !handle || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }
    const cleanHandle = handle
      .toLowerCase()
      .replace("@", "")
      .replace(/\s+/g, "");
    if (cleanHandle.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters" });
    }

    // Check existing
    const existEmail = await User.findOne({ email: email.toLowerCase() });
    if (existEmail) {
      return res.status(400).json({ error: "Email already registered" });
    }
    const existHandle = await User.findOne({ handle: cleanHandle });
    if (existHandle) {
      return res.status(400).json({ error: "Username taken" });
    }

    const baseToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationToken = crypto
      .createHash("sha256")
      .update(baseToken)
      .digest("hex");
    const emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;

    const user = await User.create({
      name,
      handle: cleanHandle,
      email: email.toLowerCase(),
      password,
      emailVerificationToken,
      emailVerificationTokenExpires,
    });

    const verifyUrL = `${process.env.CLIENT_URL}/verify.html?token=${baseToken}`;

    const message = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #FF7E5F;">Namaste ${user.name},</h2>
        <p>Welcome to <strong>Tirth Sutra — The Mandir Community</strong> ✨.</p>
        <p>We are overjoyed to have you join our digital sanctuary. Before you can fully immerse yourself, please gently verify that this is the correct path to reach you.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrL}" style="background-color: #FF7E5F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block;">Verify My Email</a>
        </div>
        <p><em>(If the button above does not work, securely copy and paste this link into your browser: <br/> <a href="${verifyUrL}">${verifyUrL}</a>)</em></p>
        <p>Why are we asking for this? Creating a safe, authentic, and harmonious community is our highest priority. This quick step ensures your account is secure.</p>
        <p>May your path be filled with peace and divine blessings. 🌺</p>
        <p>Warmly,<br/><strong>The Tirth Sutra Team</strong></p>
      </div>
    `;

    try {
      await sendEmail({
        email: user.email,
        subject: "Welcome to Tirth Sutra 🙏 — Verify your email to begin your journey!",
        html: message,
      });

      res.status(201).json({
        success: true,
        message: "Account created! Please check your email to verify your account.",
      });
    } catch (error) {
      console.error("Email send error:", error);
      user.emailVerificationToken = undefined;
      user.emailVerificationTokenExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return res
        .status(500)
        .json({ error: "There was an error sending the verification email. Please try again." });
    }
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!user.verified) {
      return res.status(401).json({ error: "Please verify your email before logging in." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({ user: user.toJSON(), token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/auth/me — get current user from token
router.get("/me", async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token" });
    }
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: user.toJSON() });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;

// GET /api/auth/verify-email/:token
router.get("/verify-email/:token", async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    user.verified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpires = undefined;
    await user.save({ validateBeforeSave: false });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({ success: true, user: user.toJSON(), token });
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Server error during verification" });
  }
});
