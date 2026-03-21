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
const MandirPost = require("./models/MandirPost");

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
  await MandirPost.deleteMany({});

  // Create users (passwords are hashed automatically by the model)
  const password = process.env.SEED_PASSWORD || "password123";

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

  // ─── MANDIR ADMIN ACCOUNTS ───
  const mKedarnath = await User.create({
    name: "Kedarnath Temple",
    handle: "kedarnath_mandir",
    email: "kedarnath@tirthsutra.com",
    password,
    bio: "Official Kedarnath Temple Community 🏔 Ancient Shiva temple at 3583m altitude in the Himalayas.",
    location: "Rudraprayag, Uttarakhand",
    verified: true,
    mandirId: "kedarnath",
    joined: "Jan 2025",
  });

  const mKashi = await User.create({
    name: "Kashi Vishwanath",
    handle: "kashi_mandir",
    email: "kashi@tirthsutra.com",
    password,
    bio: "Official Kashi Vishwanath Temple Community 🕉 The divine abode of Lord Shiva on the banks of sacred Ganga.",
    location: "Varanasi, UP",
    verified: true,
    mandirId: "kashi-vishwanath",
    joined: "Jan 2025",
  });

  const mTirupati = await User.create({
    name: "Tirupati Balaji",
    handle: "tirupati_mandir",
    email: "tirupati@tirthsutra.com",
    password,
    bio: "Official Tirupati Balaji Community 🛕 Venkateshwara temple, the richest and most visited pilgrimage site.",
    location: "Tirupati, AP",
    verified: true,
    mandirId: "tirupati",
    joined: "Jan 2025",
  });

  const mSomnath = await User.create({
    name: "Somnath Temple",
    handle: "somnath_mandir",
    email: "somnath@tirthsutra.com",
    password,
    bio: "Official Somnath Temple Community 🌊 First among the 12 Jyotirlingas on the shores of Arabian Sea.",
    location: "Veraval, Gujarat",
    verified: true,
    mandirId: "somnath",
    joined: "Jan 2025",
  });

  const mMeenakshi = await User.create({
    name: "Meenakshi Amman",
    handle: "meenakshi_mandir",
    email: "meenakshi@tirthsutra.com",
    password,
    bio: "Official Meenakshi Amman Temple Community 🌺 Magnificent Dravidian temple with towering gopurams.",
    location: "Madurai, TN",
    verified: true,
    mandirId: "meenakshi",
    joined: "Jan 2025",
  });

  const mRamMandir = await User.create({
    name: "Ram Mandir Ayodhya",
    handle: "ramji_mandir",
    email: "ramji@tirthsutra.com",
    password,
    bio: "Official Ram Mandir Community 🏹 The sacred birthplace of Lord Ram — the grand temple at Ayodhya Dham.",
    location: "Ayodhya, UP",
    verified: true,
    mandirId: "ram-mandir",
    joined: "Jan 2025",
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

  // ─── MANDIR COMMUNITY POSTS ───
  // Kedarnath posts
  await MandirPost.create({
    mandirId: "kedarnath",
    user: mKedarnath._id,
    text: "🏔 Kedarnath Temple doors will open on May 7th, 2025! Start planning your yatra now. Registration opens next week.\n\n#KedarnathYatra2025",
    likes: [u1._id, u2._id, u3._id],
    comments: [{ user: u2._id, text: "Can't wait! 🙏" }],
    createdAt: new Date(Date.now() - 3600000),
  });
  await MandirPost.create({
    mandirId: "kedarnath",
    user: mKedarnath._id,
    text: "Morning aarti at Kedarnath — the purest form of devotion at 3583m. Har Har Mahadev! 🔱",
    likes: [u1._id, u4._id],
    createdAt: new Date(Date.now() - 86400000),
  });
  await MandirPost.create({
    mandirId: "kedarnath",
    user: mKedarnath._id,
    text: "Snow-covered peaks surrounding the sacred temple. Winter season serenity. ❄️🕉",
    likes: [u2._id, u3._id, u4._id],
    createdAt: new Date(Date.now() - 172800000),
  });

  // Kashi Vishwanath posts
  await MandirPost.create({
    mandirId: "kashi-vishwanath",
    user: mKashi._id,
    text: "🕯 Evening Ganga Aarti at the ghats of Varanasi. The spiritual energy here is beyond words.\n\n#GangaAarti #KashiVishwanath",
    likes: [u1._id, u2._id, u3._id, u4._id],
    comments: [
      { user: u1._id, text: "Om Namah Shivaya! 🙏" },
      { user: u3._id, text: "The eternal city of light" },
    ],
    createdAt: new Date(Date.now() - 7200000),
  });
  await MandirPost.create({
    mandirId: "kashi-vishwanath",
    user: mKashi._id,
    text: "The newly renovated Kashi Vishwanath corridor is a masterpiece. Visit and witness the grandeur of Mahadev's abode. 🛕",
    likes: [u2._id, u3._id],
    createdAt: new Date(Date.now() - 259200000),
  });

  // Tirupati Balaji posts
  await MandirPost.create({
    mandirId: "tirupati",
    user: mTirupati._id,
    text: "🛕 Tirumala Tirupati Devasthanams — Today's darshan wait time: approx 4 hours. Plan your visit accordingly.\n\nOm Namo Venkatesaya!",
    likes: [u1._id, u2._id],
    comments: [{ user: u4._id, text: "Thank you for the update 🙏" }],
    createdAt: new Date(Date.now() - 14400000),
  });
  await MandirPost.create({
    mandirId: "tirupati",
    user: mTirupati._id,
    text: "Srivari Kalyanotsavam — the divine wedding ceremony of Lord Venkateswara. A sight that fills every heart with devotion. 💛",
    likes: [u3._id, u4._id],
    createdAt: new Date(Date.now() - 345600000),
  });

  // Somnath posts
  await MandirPost.create({
    mandirId: "somnath",
    user: mSomnath._id,
    text: "🌊 Somnath — First of the 12 Jyotirlingas. The sound of the Arabian Sea waves and the temple bells create an unforgettable spiritual experience.\n\n#Somnath #Jyotirlinga",
    likes: [u1._id, u2._id, u4._id],
    createdAt: new Date(Date.now() - 10800000),
  });
  await MandirPost.create({
    mandirId: "somnath",
    user: mSomnath._id,
    text: "Light and Sound show narrating the glorious history of Somnath temple. Every evening at 7:30 PM.",
    likes: [u1._id],
    createdAt: new Date(Date.now() - 432000000),
  });

  // Meenakshi Amman posts
  await MandirPost.create({
    mandirId: "meenakshi",
    user: mMeenakshi._id,
    text: "🌺 Meenakshi Amman Temple, Madurai — The towering gopurams adorned with 33,000 sacred sculptures. A marvel of Dravidian architecture.\n\n#MeenakshiTemple",
    likes: [u1._id, u3._id, u4._id],
    comments: [{ user: u1._id, text: "Architectural wonder! 🏛" }],
    createdAt: new Date(Date.now() - 21600000),
  });
  await MandirPost.create({
    mandirId: "meenakshi",
    user: mMeenakshi._id,
    text: "Chithirai Festival preparations are underway! The grand procession of Lord Sundareswarar and Goddess Meenakshi. 🎊",
    likes: [u2._id, u3._id],
    createdAt: new Date(Date.now() - 518400000),
  });

  // Ram Mandir posts
  await MandirPost.create({
    mandirId: "ram-mandir",
    user: mRamMandir._id,
    text: "🏹 Jai Shri Ram! The grand Ram Mandir at Ayodhya Dham — the sacred birthplace of Lord Ram. A dream fulfilled for millions of devotees.\n\n#RamMandir #Ayodhya",
    likes: [u1._id, u2._id, u3._id, u4._id],
    comments: [
      { user: u2._id, text: "Jai Shri Ram! 🙏" },
      { user: u4._id, text: "Historic moment for Sanatan Dharma" },
    ],
    createdAt: new Date(Date.now() - 28800000),
  });
  await MandirPost.create({
    mandirId: "ram-mandir",
    user: mRamMandir._id,
    text: "Daily aarti schedule at Ram Mandir, Ayodhya:\n🌅 Mangala Aarti — 6:00 AM\n☀️ Shringar Aarti — 12:00 PM\n🌆 Sandhya Aarti — 7:00 PM\n🌙 Shayan Aarti — 9:00 PM",
    likes: [u1._id, u3._id],
    createdAt: new Date(Date.now() - 604800000),
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
  Mandir Admin Accounts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  kedarnath@tirthsutra.com   → Kedarnath
  kashi@tirthsutra.com       → Kashi Vishwanath
  tirupati@tirthsutra.com    → Tirupati Balaji
  somnath@tirthsutra.com     → Somnath
  meenakshi@tirthsutra.com   → Meenakshi Amman
  ramji@tirthsutra.com       → Ram Mandir, Ayodhya
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
