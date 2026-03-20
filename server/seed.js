/**
 * Database Seed Script
 * Run: cd server && node seed.js
 *
 * Populates MongoDB with the same seed data from the original frontend
 * so the app feels pre-populated on first launch.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const Post = require("./models/Post");
const Story = require("./models/Story");
const Video = require("./models/Video");
const Notification = require("./models/Notification");
const Conversation = require("./models/Message");

async function seed() {
  await connectDB();
  console.log("🌱 Seeding database...");

  // Clear existing data
  await User.deleteMany({});
  await Post.deleteMany({});
  await Story.deleteMany({});
  await Video.deleteMany({});
  await Notification.deleteMany({});
  await Conversation.deleteMany({});

  // Create users (passwords are hashed automatically by the model)
  const password = "password123"; // Default password for all seed users

  const u1 = await User.create({
    name: "Swami Krishnananda",
    handle: "swami_kn",
    email: "swami@tirthsutra.com",
    password,
    bio: "Vedanta scholar & spiritual guide. Teaching Advaita for 30 years.",
    location: "Rishikesh, India",
    verified: true,
    joined: "Jan 2023",
  });

  const u2 = await User.create({
    name: "Ananya Sharma",
    handle: "ananya_yatra",
    email: "ananya@tirthsutra.com",
    password,
    bio: "Passionate pilgrim 🙏 Char Dham devotee.",
    location: "Mumbai, India",
    joined: "Mar 2023",
  });

  const u3 = await User.create({
    name: "Veda Pathashaala",
    handle: "veda_pathshala",
    email: "veda@tirthsutra.com",
    password,
    bio: "Daily shlokas & vedic knowledge. Sanctioned by Dharma Sansad.",
    location: "Varanasi, India",
    verified: true,
    joined: "Feb 2023",
  });

  const u4 = await User.create({
    name: "Prakash Teerth",
    handle: "prakash_teerth",
    email: "prakash@tirthsutra.com",
    password,
    bio: "Pilgrimage guide & photographer 📸",
    location: "Haridwar, India",
    joined: "Apr 2023",
  });

  // Set up follow relationships
  u1.followers = [u2._id, u3._id, u4._id];
  u1.following = [u2._id];
  await u1.save();

  u2.followers = [u1._id, u3._id];
  u2.following = [u1._id, u3._id];
  await u2.save();

  u3.followers = [u1._id, u2._id, u4._id];
  u3.following = [u1._id];
  await u3.save();

  u4.followers = [u1._id, u2._id];
  u4.following = [u2._id, u3._id];
  await u4.save();

  // Create posts
  const p1 = await Post.create({
    user: u1._id,
    text: "The Ganga at dawn is not just a river — it is a mirror of your own consciousness.\n\nEach ripple carries prayers of a thousand generations. 🕉\n\n#GangaAarti #Haridwar",
    likes: [u2._id, u3._id, u4._id],
    comments: [
      { user: u2._id, text: "Jai Gange Mata! 🙏" },
      { user: u4._id, text: "Was there this morning!" },
    ],
    reposts: [u2._id],
    createdAt: new Date(Date.now() - 7200000),
  });

  const p2 = await Post.create({
    user: u2._id,
    text: "Just returned from Kedarnath. Words cannot describe the energy at 3583m altitude. \n\n#Kedarnath #ShivBhakt",
    likes: [u1._id, u3._id],
    comments: [{ user: u1._id, text: "Har Har Mahadev! 🔱" }],
    bookmarks: [u1._id, u4._id],
    createdAt: new Date(Date.now() - 18000000),
  });

  const p3 = await Post.create({
    user: u3._id,
    text: " Shloka of the Day\n\nयत्र योगेश्वरः कृष्णो यत्र पार्थो धनुर्धरः।\nतत्र श्रीर्विजयो भूतिर्ध्रुवा नीतिर्मतिर्मम॥\n\n— Bhagavad Gita 18.78\n\n#BhagavadGita",
    likes: [u1._id, u2._id, u4._id],
    comments: [{ user: u4._id, text: "Jai Shri Krishna! 🙏" }],
    reposts: [u1._id, u4._id],
    bookmarks: [u2._id],
    createdAt: new Date(Date.now() - 28800000),
  });

  const p4 = await Post.create({
    user: u4._id,
    text: " Amarnath Yatra opens in 3 weeks! Are you going this year?",
    likes: [u1._id, u2._id],
    poll: {
      options: ["Yes, definitely! 🙏", "Maybe 🤔", "Not this year ❌"],
      votes: [`${u1._id}:0`, `${u2._id}:0`, `${u3._id}:1`],
    },
    createdAt: new Date(Date.now() - 43200000),
  });

  // Create stories
  await Story.create({
    user: u1._id,
    type: "video",
    src: "https://video-5c9i.vercel.app/feed1.mp4",
    caption: "तीर्थयात्रा का पूरा फल चाहिए ? तो पहले ये गलती मत करना !",
    emoji: "🕉",
  });

  await Story.create({
    user: u2._id,
    type: "video",
    src: "https://video-68c8.vercel.app/Brand1.mp4",
    caption: "Logo revel",
  });

  await Story.create({
    user: u3._id,
    type: "video",
    src: "https://video-ae5o.vercel.app/Post7.mp4",
    caption: "Sant Vani",
  });

  // Create videos
  await Video.create({
    user: u1._id,
    title: "One Spiritual Lesson That Can Change Your Life Forever",
    description: "keli kunj vrindavan",
    category: "Spiritual",
    src: "https://video-8d71.vercel.app/Post1.mp4?v=1",
    likes: [u2._id, u3._id],
    comments: [{ user: u2._id, text: "Jai Mahadev! 🔱" }],
    views: 1240,
    duration: "01:23",
    createdAt: new Date(Date.now() - 86400000),
  });

  await Video.create({
    user: u3._id,
    title: "सूरज ढला और एक दिन कम हो गया #iskcon",
    description:
      "हाँ रघुनंदन, प्राण प्रीति तुम बिन जिए, तो बहुत दिन बीते।",
    category: "Discourse",
    src: "https://video-8d71.vercel.app/Post2.mp4?v=2",
    likes: [u1._id, u4._id],
    views: 3820,
    duration: "01:00",
    createdAt: new Date(Date.now() - 172800000),
  });

  await Video.create({
    user: u4._id,
    title: "Soul-Touching Kirtan That Brings Instant Peace 🕉️",
    description: "Varanasi",
    category: "Aarti",
    src: "https://video-8d71.vercel.app/Post3.mp4?v=3",
    likes: [u1._id, u2._id, u3._id],
    comments: [{ user: u1._id, text: "Har Har Gange! 🌊" }],
    views: 5670,
    duration: "2:27",
    createdAt: new Date(Date.now() - 259200000),
  });

  await Video.create({
    user: u4._id,
    title: "Sant Darshan",
    description: "Varanasi",
    category: "Bhajan",
    src: "https://video-68c8.vercel.app/Post4.mp4",
    likes: [u1._id, u2._id, u3._id],
    comments: [{ user: u1._id, text: "Har Har Mahadev! 🌊" }],
    views: 567000,
    duration: "0:15",
    createdAt: new Date(Date.now() - 259200000),
  });

  await Video.create({
    user: u4._id,
    title: "हम श्री कृष्ण चेतन्य महाप्रभु को granted ना लें",
    description: "Mayapur",
    category: "Katha",
    src: "https://video-68c8.vercel.app/Post5.mp4",
    likes: [u1._id, u2._id, u3._id],
    comments: [{ user: u1._id, text: "Har Har Gange! 🌊" }],
    views: 100000,
    duration: "0:57",
    createdAt: new Date(Date.now() - 259200000),
  });

  // Create live streams
  await Video.create({
    user: u1._id,
    title: "The Essence of the Tirth Sutra",
    src: "https://video-xi-flame.vercel.app/Tirth%20Sutra%20Video.mp4?v=1",
    isLive: true,
    liveViewers: 12470,
    liveStarted: "10 min ago",
    category: "Spiritual",
  });

  await Video.create({
    user: u3._id,
    title: "Naam Sankirtan – The Most Powerful Meditation in Kali Yuga",
    src: "https://video-8d71.vercel.app/live.mp4?v=1",
    isLive: true,
    liveViewers: 38910,
    liveStarted: "1 hour ago",
    category: "Meditation",
  });

  // Create notifications
  await Notification.create({
    recipient: u1._id,
    sender: u2._id,
    type: "like",
    post: p1._id,
    text: "gave a Pranam to your post",
  });

  await Notification.create({
    recipient: u1._id,
    sender: u3._id,
    type: "follow",
    text: "started following you",
  });

  await Notification.create({
    recipient: u1._id,
    sender: u4._id,
    type: "comment",
    post: p1._id,
    text: "commented on your post",
  });

  await Notification.create({
    recipient: u1._id,
    sender: u2._id,
    type: "repost",
    post: p1._id,
    text: "reposted your post",
    read: true,
  });

  // Create conversations
  await Conversation.create({
    participants: [u1._id, u2._id],
    messages: [
      {
        sender: u2._id,
        text: "Jai Shri Ram! Are you joining the Kedarnath yatra?",
      },
      { sender: u1._id, text: "Jai! Yes planning to go." },
      { sender: u2._id, text: "May 15th from Haridwar! 🙏" },
    ],
    lastMessage: "May 15th from Haridwar! 🙏",
    lastMessageAt: new Date(),
  });

  await Conversation.create({
    participants: [u1._id, u3._id],
    messages: [
      {
        sender: u3._id,
        text: "Namaste! Could you share your Char Dham experience?",
      },
    ],
    lastMessage: "Namaste! Could you share your Char Dham experience?",
    lastMessageAt: new Date(Date.now() - 86400000),
  });

  console.log("✅ Database seeded successfully!");
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Seed Users (password: password123)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  swami@tirthsutra.com
  ananya@tirthsutra.com
  veda@tirthsutra.com
  prakash@tirthsutra.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
