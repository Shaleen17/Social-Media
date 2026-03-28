"use strict";

/* ── STORAGE ── */
const Store = {
  g(k, d = null) {
    try {
      const v = localStorage.getItem("ts_" + k);
      return v !== null ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  s(k, v) {
    try {
      localStorage.setItem("ts_" + k, JSON.stringify(v));
    } catch { }
  },
  d(k) {
    try {
      localStorage.removeItem("ts_" + k);
    } catch { }
  },
};

/* ── IndexedDB ── */
let idb = null;
function openIDB() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("TirthSutraDB", 1);
      r.onupgradeneeded = (e) => {
        try {
          e.target.result.createObjectStore("videos", { keyPath: "id" });
        } catch { }
      };
      r.onsuccess = (e) => {
        idb = e.target.result;
        res();
      };
      r.onerror = () => res();
    } catch {
      res();
    }
  });
}
async function saveVidBlob(id, blob) {
  if (!idb) return;
  return new Promise((res) => {
    try {
      const t = idb.transaction("videos", "readwrite");
      t.objectStore("videos").put({ id, blob });
      t.oncomplete = res;
      t.onerror = res;
    } catch {
      res();
    }
  });
}

/* ── Mandir Community Notifications ── */
const MC = {
  show(msg, type = "i", dur = 3500) {
    const c = document.getElementById("toastContainer");
    if (!c) return;
    const el = document.createElement("div");
    el.className = "mc-toast";
    el.innerHTML = `<div class="mc-toast-header"><svg viewBox="0 0 24 24"><path d="M12 2C8 2 4 5.5 4 9.5c0 5.5 6 10.5 8 12 2-1.5 8-6.5 8-12C20 5.5 16 2 12 2z"/><circle cx="12" cy="9.5" r="2.5" fill="var(--p)" stroke="none"/></svg>Mandir Community</div><div class="mc-toast-body">${msg}</div><div class="mc-toast-bar ${type}"></div>`;
    c.appendChild(el);
    setTimeout(() => {
      el.style.animation = "toastOut .3s ease forwards";
      setTimeout(() => el.remove(), 300);
    }, dur);
    el.addEventListener("click", () => el.remove());
  },
  success(m) {
    this.show(m, "s");
  },
  error(m) {
    this.show(m, "e", 4500);
  },
  info(m) {
    this.show(m, "i");
  },
  warn(m) {
    this.show(m, "w", 4000);
  },
};

/* ── STATE ── */
let CU = null,
  curPage = "home",
  curFTab = "forYou",
  curSTabVal = "people";
let curProfId = null,
  curChat = null,
  activeRP = null,
  activeSH = null;
let svIdx = 0,
  svTimer = null,
  compImg = null;
let curVidCat = "All",
  curVidTab = "feed";
let vidUploadFile = null,
  storyUploadFile = null,
  liveFile = null,
  thumbFile = null;

/* ── SEED DATA ── */
const SEED_USERS = [
  {
    id: "u1",
    name: "Swami Krishnananda",
    handle: "swami_kn",
    bio: "Vedanta scholar & spiritual guide. Teaching Advaita for 30 years.",
    location: "Rishikesh, India",
    website: "",
    avatar: null,
    banner: null,
    followers: ["u2", "u3", "u4"],
    following: ["u2"],
    joined: "Jan 2023",
    verified: true,
  },
  {
    id: "u2",
    name: "Ananya Sharma",
    handle: "ananya_yatra",
    bio: "Passionate pilgrim 🙏 Char Dham devotee.",
    location: "Mumbai, India",
    website: "",
    avatar: null,
    banner: null,
    followers: ["u1", "u3"],
    following: ["u1", "u3"],
    joined: "Mar 2023",
    verified: false,
  },
  {
    id: "u3",
    name: "Veda Pathashaala",
    handle: "veda_pathshala",
    bio: "Daily shlokas & vedic knowledge. Sanctioned by Dharma Sansad.",
    location: "Varanasi, India",
    website: "",
    avatar: null,
    banner: null,
    followers: ["u1", "u2", "u4"],
    following: ["u1"],
    joined: "Feb 2023",
    verified: true,
  },
  {
    id: "u4",
    name: "Prakash Teerth",
    handle: "prakash_teerth",
    bio: "Pilgrimage guide & photographer 📸",
    location: "Haridwar, India",
    website: "",
    avatar: null,
    banner: null,
    followers: ["u1", "u2"],
    following: ["u2", "u3"],
    joined: "Apr 2023",
    verified: false,
  },
];
const SEED_POSTS = [
  {
    id: "p1",
    uid: "u1",
    txt: "The Ganga at dawn is not just a river — it is a mirror of your own consciousness.\n\nEach ripple carries prayers of a thousand generations. 🕉\n\n#GangaAarti #Haridwar",
    img: null,
    likes: ["u2", "u3", "u4"],
    cmts: [
      { id: "c1", uid: "u2", txt: "Jai Gange Mata! 🙏", t: "1h ago" },
      {
        id: "c2",
        uid: "u4",
        txt: "Was there this morning!",
        t: "45m ago",
      },
    ],
    reposts: ["u2"],
    bm: [],
    poll: null,
    t: "2h ago",
    ts: Date.now() - 7200000,
  },
  {
    id: "p2",
    uid: "u2",
    txt: "Just returned from Kedarnath. Words cannot describe the energy at 3583m altitude. \n\n#Kedarnath #ShivBhakt",
    img: null,
    likes: ["u1", "u3"],
    cmts: [{ id: "c3", uid: "u1", txt: "Har Har Mahadev! 🔱", t: "3h ago" }],
    reposts: [],
    bm: ["u1", "u4"],
    poll: null,
    t: "5h ago",
    ts: Date.now() - 18000000,
  },
  {
    id: "p3",
    uid: "u3",
    txt: " Shloka of the Day\n\nयत्र योगेश्वरः कृष्णो यत्र पार्थो धनुर्धरः।\nतत्र श्रीर्विजयो भूतिर्ध्रुवा नीतिर्मतिर्मम॥\n\n— Bhagavad Gita 18.78\n\n#BhagavadGita",
    img: null,
    likes: ["u1", "u2", "u4"],
    cmts: [{ id: "c4", uid: "u4", txt: "Jai Shri Krishna! 🙏", t: "6h ago" }],
    reposts: ["u1", "u4"],
    bm: ["u2"],
    poll: null,
    t: "8h ago",
    ts: Date.now() - 28800000,
  },
  {
    id: "p4",
    uid: "u4",
    txt: " Amarnath Yatra opens in 3 weeks! Are you going this year?",
    img: null,
    likes: ["u1", "u2"],
    cmts: [],
    reposts: [],
    bm: [],
    poll: {
      opts: ["Yes, definitely! 🙏", "Maybe 🤔", "Not this year ❌"],
      votes: ["u1:0", "u2:0", "u3:1"],
    },
    t: "12h ago",
    ts: Date.now() - 43200000,
  },
];
const SEED_STORIES = [
  {
    id: "s1",
    uid: "u1",
    emo: "🕉",
    cap: "तीर्थयात्रा का पूरा फल चाहिए ? तो पहले ये गलती मत करना !",
    t: "2h",
    type: "video",
    src: "https://video-5c9i.vercel.app/feed1.mp4",
  },
  {
    id: "s2",
    uid: "u2",
    emo: "",
    cap: "Logo revel",
    t: "5h",
    type: "video",
    src: "https://video-68c8.vercel.app/Brand1.mp4",
  },
  {
    id: "s3",
    uid: "u3",
    emo: "",
    cap: "Sant Vani",
    t: "8h",
    type: "video",
    src: "https://video-ae5o.vercel.app/Post7.mp4",
  },
];
const SEED_NOTIFS = [
  {
    id: "n1",
    type: "like",
    from: "u2",
    pid: "p1",
    txt: "gave a Pranam to your post",
    t: "2m",
    unread: true,
  },
  {
    id: "n2",
    type: "follow",
    from: "u3",
    pid: null,
    txt: "started following you",
    t: "15m",
    unread: true,
  },
  {
    id: "n3",
    type: "comment",
    from: "u4",
    pid: "p1",
    txt: "commented on your post",
    t: "45m",
    unread: true,
  },
  {
    id: "n4",
    type: "repost",
    from: "u2",
    pid: "p1",
    txt: "reposted your post",
    t: "1h",
    unread: false,
  },
];
const SEED_CONVS = [
  {
    id: "cv1",
    uid: "u2",
    msgs: [
      {
        from: "u2",
        txt: "Jai Shri Ram! Are you joining the Kedarnath yatra?",
        t: "10:30",
      },
      { from: "me", txt: "Jai! Yes planning to go.", t: "10:32" },
      { from: "u2", txt: "May 15th from Haridwar! 🙏", t: "10:35" },
    ],
  },
  {
    id: "cv2",
    uid: "u3",
    msgs: [
      {
        from: "u3",
        txt: "Namaste! Could you share your Char Dham experience?",
        t: "Yesterday",
      },
    ],
  },
  {
    id: "cv3",
    uid: "u1",
    msgs: [
      {
        from: "u1",
        txt: "Pranam. Your questions in last satsang were insightful.",
        t: "2d ago",
      },
    ],
  },
];
const SEED_VIDEOS = [
  {
    id: "v1",
    uid: "u1",
    title: "One Spiritual Lesson That Can Change Your Life Forever",
    desc: "keli kunj vrindavan",
    cat: "Spiritual",
    src: "https://video-8d71.vercel.app/Post1.mp4?v=1",
    thumb: null,
    likes: ["u2", "u3"],
    cmts: [{ uid: "u2", txt: "Jai Mahadev! 🔱", t: "1h ago" }],
    views: 1240,
    dur: "01:23",
    ts: Date.now() - 86400000,
    live: false,
  },
  {
    id: "v2",
    uid: "u3",
    title: "सूरज ढला और एक दिन कम हो गया #iskcon",
    desc: "हाँ रघुनंदन, प्राण प्रीति तुम बिन जिए, तो बहुत दिन बीते।",
    cat: "Discourse",
    src: "https://video-8d71.vercel.app/Post2.mp4?v=2",
    thumb: null,
    likes: ["u1", "u4"],
    cmts: [],
    views: 3820,
    dur: "01:00",
    ts: Date.now() - 172800000,
    live: false,
  },
  {
    id: "v3",
    uid: "u4",
    title: "Soul-Touching Kirtan That Brings Instant Peace 🕉️",
    desc: "Varanasi",
    cat: "Aarti",
    src: "https://video-8d71.vercel.app/Post3.mp4?v=3",
    thumb: null,
    likes: ["u1", "u2", "u3"],
    cmts: [{ uid: "u1", txt: "Har Har Gange! 🌊", t: "2h ago" }],
    views: 5670,
    dur: "2:27",
    ts: Date.now() - 259200000,
    live: false,
  },
  {
    id: "v3",
    uid: "u4",
    title: "Sant Darshan",
    desc: "Varanasi",
    cat: "Bhajan",
    src: "https://video-68c8.vercel.app/Post4.mp4",
    thumb: null,
    likes: ["u1", "u2", "u3"],
    cmts: [{ uid: "u1", txt: "Har Har Mahadev! 🌊", t: "3h ago" }],
    views: 567000,
    dur: "0:15",
    ts: Date.now() - 259200000,
    live: false,
  },
  {
    id: "v2",
    uid: "u4",
    title: "हम श्री कृष्ण चेतन्य महाप्रभु को granted ना लें",
    desc: "Mayapur",
    cat: "Katha",
    src: "https://video-68c8.vercel.app/Post5.mp4",
    thumb: null,
    likes: ["u1", "u2", "u3"],
    cmts: [{ uid: "u1", txt: "Har Har Gange! 🌊", t: "5h ago" }],
    views: 100000,
    dur: "0:57",
    ts: Date.now() - 259200000,
    live: false,
  },
];

const SEED_LIVE = [
  {
    id: "l1",
    uid: "u1",
    title: "The Essence of the Tirth Sutra",
    src: "https://video-xi-flame.vercel.app/Tirth%20Sutra%20Video.mp4?v=1",
    viewers: 12470,
    started: "10 min ago",
  },
  {
    id: "l2",
    uid: "u3",
    title: "Naam Sankirtan – The Most Powerful Meditation in Kali Yuga",
    src: "https://video-8d71.vercel.app/live.mp4?v=1",
    viewers: 38910,
    started: "1 hour ago",
  },
];
const SEED_VID_STORIES = [
  {
    id: "vs1",
    uid: "u2",
    cap: "Tirth Sutra Logo Revel",
    t: "1h",
    type: "video",
    emo: "",
    src: "https://video-68c8.vercel.app/Brand1.mp4",
  },
  {
    id: "vs2",
    uid: "u4",
    cap: "Radharaman Darshan ",
    t: "3h",
    type: "video",
    emo: "",
    src: "https://video-68c8.vercel.app/Reel1.mp4",
  },
];
const TRENDING = [
  { tag: "#MahaKumbh2025", cat: "Spiritual", cnt: "22.1k" },
  { tag: "#GangaAarti", cat: "Temple", cnt: "14.8k" },
  { tag: "#KedarnathYatra", cat: "Pilgrimage", cnt: "11.2k" },
  { tag: "#SanatanDharma", cat: "Culture", cnt: "45.6k" },
  { tag: "#BhagavadGita", cat: "Scripture", cnt: "38.9k" },
  { tag: "#CharDham2025", cat: "Travel", cnt: "8.7k" },
];

/* Mandir Community static data */
const TEMPLES = [
  {
    name: "Kedarnath",
    loc: "Uttarakhand",
    emoji: "🏔",
    color: "#e8eaf6",
  },
  {
    name: "Tirupati Balaji",
    loc: "Andhra Pradesh",
    emoji: "🛕",
    color: "#fce4ec",
  },
  {
    name: "Kashi Vishwanath",
    loc: "Varanasi",
    emoji: "🕯",
    color: "#fff3e0",
  },
  { name: "Somnath", loc: "Gujarat", emoji: "🌊", color: "#e0f7fa" },
  {
    name: "Shirdi Sai Baba",
    loc: "Maharashtra",
    emoji: "🙏",
    color: "#f3e5f5",
  },
  {
    name: "Jagannath Puri",
    loc: "Odisha",
    emoji: "🎪",
    color: "#e8f5e9",
  },
];
const EVENTS = [
  {
    day: "20",
    mon: "Oct",
    title: "Deepotsava — Diwali Celebrations",
    sub: "All India · Join virtually 🎆",
    tag: "Festival",
  },
  {
    day: "05",
    mon: "Nov",
    title: "Kartik Purnima — Ganga Snan",
    sub: "Haridwar, Varanasi, Prayagraj",
    tag: "Teerth",
  },
  {
    day: "02",
    mon: "May",
    title: "Kedarnath Temple Opening 2025",
    sub: "Uttarakhand · Register now",
    tag: "Yatra",
  },
  {
    day: "12",
    mon: "Nov",
    title: "Pushkar Mela — Camel Fair",
    sub: "Rajasthan · Sacred & Cultural",
    tag: "Mela",
  },
];
/* ============================================================
   ★ VERIFIED SANTS DATA
   HOW TO ADD PHOTOS:
   1. Create a folder: images/sants/
      (place it next to this HTML file, same level as index.html)
   2. Add photos inside that folder, e.g.:
        images/sants/shrigaurdas.jpg
        images/sants/shrinaresh.jpg   etc.
   3. Update the src: "" field in each sant entry below
   4. Recommended: 400×400px square, .jpg / .png / .webp
   ============================================================ */
const SANTS = [
  /* ── 1 ── */
  {
    id: "s1",
    uid: null,
    handle: "shrigaurdasjimaharaj",
    name: "Shri Gaurdas Ji Maharaj",
    title: "Sant & Katha Vachak",
    followers: "154k",
    followersNum: 154000,
    following: "2",
    posts: "0",
    verified: true,
    bio: "Shri Gaurdas Ji Maharaj 🙏\nKatha, kirtan and spiritual discourses.\nSpread the message of devotion and dharma.",
    category: "Sant & Katha Vachak",
    location: "India",
    website: "",
    /*
      ★ SANT 1 IMAGE PATH:
      src: "images/sants/shrigaurdas.jpg"
    */
    src: "images/sants/shrigaurdas.jpg",
    emoji: "🕉",
    highlights: ["Katha", "Kirtan", "Satsang", "Bhajans", "Pravachan"],
  },
  /* ── 2 ── */
  {
    id: "s2",
    uid: null,
    handle: "shrinareshbhaiyaji",
    name: "Shri Naresh Bhaiya Ji",
    title: "Spiritual Speaker",
    followers: "19k",
    followersNum: 19000,
    following: "1",
    posts: "0",
    verified: true,
    bio: "Shri Naresh Bhaiya Ji 🙏\nSpiritual speaker and devotee.\nGuiding seekers on the path of bhakti.",
    category: "Spiritual Speaker",
    location: "India",
    website: "",
    /*
      ★ SANT 2 IMAGE PATH:
      src: "images/sants/shrinaresh.jpg"
    */
    src: "images/sants/shrinaresh.jpg",
    emoji: "🙏",
    highlights: ["Bhakti", "Satsang", "Katha", "Pravachan", "Events"],
  },
  /* ── 3 ── */
  {
    id: "s3",
    uid: null,
    handle: "hitaambrish",
    name: "Hita Ambrish",
    title: "Vaishnava Saint",
    followers: "237K",
    followersNum: 237000,
    following: "2",
    posts: "0",
    verified: true,
    bio: "Hita Ambrish ✅\nVaishnava saint and kirtaniya.\n237K devotees spreading the love of Radha-Krishna.",
    category: "Vaishnava Saint",
    location: "Vrindavan, UP",
    website: "",
    /*
      ★ SANT 3 IMAGE PATH:
      src: "images/sants/hitaambrish.jpg"
    */
    src: "images/sants/hitaambrish.jpg",
    emoji: "🔱",
    highlights: ["Kirtan", "Vrindavan", "Radha-Krishna", "Bhajan", "Satsang"],
  },
  /* ── 4 ── */
  {
    id: "s4",
    uid: null,
    handle: "pujya__prembhushanjimaharaj__",
    name: "Pujya Prembhushan Ji Maharaj",
    title: "Sant & Pravachankaar",
    followers: "403k",
    followersNum: 403000,
    following: "3",
    posts: "0",
    verified: true,
    bio: "Pujya Prembhushan Ji Maharaj 🙏\nSpread love, devotion and dharma.\nJoin us for daily satsang and pravachan.",
    category: "Sant & Pravachankaar",
    location: "India",
    website: "",
    /*
      ★ SANT 4 IMAGE PATH:
      src: "images/sants/prembhushan.jpg"
    */
    src: "images/sants/prembhushan.jpg",
    emoji: "🪔",
    highlights: ["Pravachan", "Bhakti", "Katha", "Satsang", "Events"],
  },
  /* ── 5 ── */
  {
    id: "s5",
    uid: null,
    handle: "rajendradasjimaharaj",
    name: "Shri Rajendra Das Ji Maharaj",
    title: "Vaishnava Acharya",
    followers: "765K",
    followersNum: 765000,
    following: "6",
    posts: "1.2k",
    verified: true,
    bio: "Shri Rajendra Das Ji Maharaj 🔱\nVrindavan Dham · Vaishnava tradition.\nSpread love of Lord Hari through kirtan and katha.",
    category: "Vaishnava Acharya",
    location: "Vrindavan, UP",
    website: "",
    /*
      ★ SANT 5 IMAGE PATH:
      src: "images/sants/rajendradas.jpg"
    */
    src: "images/sants/rajendradas.jpg",
    emoji: "🔱",
    highlights: ["Katha", "Kirtan", "Vrindavan", "Bhajan", "Lectures"],
  },
  /* ── 6 ── */
  {
    id: "s6",
    uid: null,
    handle: "bhajanmarg_official",
    name: "Bhajan Marg Official",
    title: "Spiritual Organisation",
    followers: "40.3M",
    followersNum: 40300000,
    following: "0",
    posts: "8.7k",
    verified: true,
    bio: "🎶 Bhajan Marg — Connecting souls through devotion.\nOfficial spiritual platform. Daily satsang, bhajans & pravachans.",
    category: "Spiritual Organisation",
    location: "Pan India",
    website: "bhajanmarg.com",
    /*
      ★ SANT 6 IMAGE PATH:
      src: "images/sants/bhajanmarg.jpg"
    */
    src: "images/sants/bhajanmarg.jpg",
    emoji: "🎶",
    highlights: ["Daily Satsang", "Bhajans", "Pravachan", "Events", "Community"],
  },
  /* ── 7 ── */
  {
    id: "s7",
    uid: null,
    handle: "radhanathswami",
    name: "Radhanath Swami",
    title: "ISKCON Monk & Author",
    followers: "524k",
    followersNum: 524000,
    following: "3",
    posts: "3.4k",
    verified: true,
    bio: "ISKCON monk, author & spiritual teacher 🌿\nAuthor of The Journey Home.\nTeaching bhakti yoga to millions worldwide.",
    category: "Monk & Author",
    location: "Mumbai / USA",
    website: "radhanathswami.com",
    /*
      ★ SANT 7 IMAGE PATH:
      src: "images/sants/radhanathswami.jpg"
    */
    src: "images/sants/radhanathswami.jpg",
    emoji: "🌿",
    highlights: ["ISKCON", "The Journey Home", "Bhakti Yoga", "Kirtan", "Talks"],
  },
  /* ── 8 ── */
  {
    id: "s8",
    uid: null,
    handle: "sripundrik",
    name: "Pundrik Goswami",
    title: "Dharmacharya",
    followers: "1.5M",
    followersNum: 1500000,
    following: "75",
    posts: "934",
    verified: true,
    bio: "Pundrik Goswami Ji 🙏\nSri Dhama Vrindavan · Radhavallabh tradition.\nGyan, bhakti and kirtan for the modern seeker.",
    category: "Dharmacharya",
    location: "Vrindavan, UP",
    website: "",
    /*
      ★ SANT 8 IMAGE PATH:
      src: "images/sants/sripundrik.jpg"
    */
    src: "images/sants/sripundrik.jpg",
    emoji: "🌺",
    highlights: ["Vrindavan", "Kirtan", "Radhavallabh", "Gyan", "Pravachan"],
  },
  /* ── 9 ── */
  {
    id: "s9",
    uid: null,
    handle: "bhaktipath",
    name: "Indresh Upadhyay",
    title: "Bhakti Path",
    followers: "2.6M",
    followersNum: 2600000,
    following: "92",
    posts: "0",
    verified: true,
    bio: "Indresh Upadhyay 🙏\nBhaktipath — guiding seekers on the path of devotion.\nSpiritual content, pravachans and more.",
    category: "Spiritual Guide",
    location: "India",
    website: "",
    /*
      ★ SANT 9 IMAGE PATH:
      src: "images/sants/bhaktipath.jpg"
    */
    src: "images/sants/bhaktipath.jpg",
    emoji: "🪔",
    highlights: ["Bhakti", "Pravachan", "Katha", "Satsang", "Events"],
  },
];
const MANDIR_DISCUSSIONS = [
  {
    uid: "u1",
    txt: "Which Jyotirlinga have you visited this year? Share your experience below! 🔱 All 12 are equally sacred but each carries a unique energy...",
    likes: 284,
    cmts: 47,
    t: "1h ago",
  },
  {
    uid: "u3",
    txt: "Daily Shloka: Karmanyevadhikaraste ma phaleshu kadachana... Do your duty without attachment to results. Start your day with this reminder. 🕉",
    likes: 892,
    cmts: 123,
    t: "3h ago",
  },
  {
    uid: "u2",
    txt: "Planning Char Dham 2025! Looking for fellow yatris from Mumbai area. Let us travel together and make it a true spiritual journey. Who is joining? 🙏",
    likes: 156,
    cmts: 89,
    t: "5h ago",
  },
];

/* ── HELPERS ── */
function getUsers() {
  return Store.g("users", SEED_USERS);
}
function getPosts() {
  return Store.g("posts", SEED_POSTS);
}
function getVideos() {
  return Store.g("videos", SEED_VIDEOS);
}
function getLiveStreams() {
  return Store.g("liveStreams", SEED_LIVE);
}
function getVidStories() {
  return Store.g("vidStories", SEED_VID_STORIES);
}
function getUser(id) {
  return getUsers().find((u) => u.id === id) || null;
}
function getPost(id) {
  return getPosts().find((p) => p.id === id) || null;
}
function getVideo(id) {
  return getVideos().find((v) => v.id === id) || null;
}
function getIni(name) {
  return (name || "U")
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function avHTML(uid, cls = "av40") {
  const u = getUser(uid);
  if (!u) return `<div class="av ${cls}">?</div>`;
  const ini = getIni(u.name);
  return `<div class="av ${cls}">${u.avatar ? `<img src="${u.avatar}" alt="">` : `${ini}`}</div>`;
}
function savePost(id, data) {
  const p = getPosts();
  const i = p.findIndex((x) => x.id === id);
  if (i > -1) {
    Object.assign(p[i], data);
    Store.s("posts", p);
  }
}
function saveVideo(id, data) {
  const v = getVideos();
  const i = v.findIndex((x) => x.id === id);
  if (i > -1) {
    Object.assign(v[i], data);
    Store.s("videos", v);
  }
}
function updateUser(id, data) {
  const u = getUsers();
  const i = u.findIndex((x) => x.id === id);
  if (i > -1) {
    Object.assign(u[i], data);
    Store.s("users", u);
  }
  if (CU && CU.id === id) {
    Object.assign(CU, data);
    Store.s("currentUser", CU);
  }
}
function fmtV(n) {
  if (n >= 1000000) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}
function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ============================================================
   SEED DATA — version controlled
   Change VERSION number every time you update seed data
   ============================================================ */
const SEED_VERSION = "v4"; // ← change to v4, v5 etc on each update

function seedData() {
  const saved = Store.g("seedVersion");

  // If version changed or never seeded → wipe and reseed everything
  if (saved !== SEED_VERSION) {
    // Clear all old cached data
    Store.d("users");
    Store.d("posts");
    Store.d("stories");
    Store.d("notifs");
    Store.d("convs");
    Store.d("videos");
    Store.d("liveStreams");
    Store.d("vidStories");
    Store.d("seeded");
    Store.d("seen");
    Store.d("vidStoriesSeen");
    Store.d("chatMessages");
    Store.d("chatGroups");

    // Save fresh seed data
    Store.s("users", SEED_USERS);
    Store.s("posts", SEED_POSTS);
    Store.s("stories", SEED_STORIES);
    Store.s("notifs", SEED_NOTIFS);
    Store.s("convs", SEED_CONVS);
    Store.s("videos", SEED_VIDEOS);
    Store.s("liveStreams", SEED_LIVE);
    Store.s("vidStories", SEED_VID_STORIES);
    Store.s("seeded", true);
    Store.s("seedVersion", SEED_VERSION);

    console.log("✅ Seed data updated to", SEED_VERSION);
  }
}

/* ── AUTH ── */
function auth(fn) {
  if (!CU) {
    openOvl("authOvl");
    return false;
  }
  fn();
  return true;
}
function openOvl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("show");
}
function closeOvl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("show");
}
document.addEventListener("click", (e) => {
  document.querySelectorAll(".ovl.show").forEach((o) => {
    if (e.target === o) o.classList.remove("show");
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document
      .querySelectorAll(".ovl.show")
      .forEach((o) => o.classList.remove("show"));
    closeRP();
    closeSH();
  }
});

function authToggle(mode) {
  document
    .getElementById("loginForm")
    .classList.toggle("hide", mode !== "login");
  document
    .getElementById("signupForm")
    .classList.toggle("hide", mode === "login");
  document.getElementById("authTtl").textContent =
    mode === "login" ? "Sign In" : "Create Account";
  ["liEE", "liPE", "liErr", "suNE", "suEE", "suHE", "suPE", "suErr"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove("show");
        el.style.display = "none";
      }
    },
  );
}

async function doLogin() {
  const em = (document.getElementById("liEml")?.value || "").trim();
  const pw = document.getElementById("liPw")?.value || "";
  let ok = true;
  const se = (id, show) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle("show", show);
      el.style.display = show ? "block" : "none";
    }
  };
  se("liEE", !em || !em.includes("@"));
  if (!em || !em.includes("@")) ok = false;
  se("liPE", !pw);
  if (!pw) ok = false;
  if (!ok) return;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: pw }),
    });
    const data = await res.json();
    const e = document.getElementById("liErr");

    if (!res.ok) {
      if (e) {
        e.textContent = "❌ " + (data.error || "Invalid email or password");
        e.style.display = "block";
      }
      MC.error(data.error || "Invalid email or password. Please try again.");
      return;
    }

    if (e) e.style.display = "none";
    const { user, token } = data;
    CU = user;
    Store.s("currentUser", user);
    Store.s("token", token);
    ["liEml", "liPw"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    closeOvl("authOvl");
    initUI();
    MC.success(`Welcome back, ${user.name.split(" ")[0]}! 🙏`);
    gp("home");
  } catch (err) {
    console.error(err);
    MC.error("Network error. Please try again.");
  }
}

async function doSignup() {
  const nm = (document.getElementById("suNm")?.value || "").trim();
  const em = (document.getElementById("suEml")?.value || "").trim();
  const hdl = (document.getElementById("suHdl")?.value || "")
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const pw = document.getElementById("suPw")?.value || "";
  const se = (id, show) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle("show", show);
      el.style.display = show ? "block" : "none";
    }
  };
  let ok = true;
  se("suNE", !nm);
  if (!nm) ok = false;
  se("suEE", !em || !em.includes("@"));
  if (!em || !em.includes("@")) ok = false;
  se("suHE", !hdl || hdl.length < 3);
  if (!hdl || hdl.length < 3) ok = false;
  se("suPE", !pw || pw.length < 6);
  if (!pw || pw.length < 6) ok = false;
  if (!ok) return;

  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nm, handle: hdl, email: em, password: pw }),
    });
    const data = await res.json();
    const err = document.getElementById("suErr");

    if (!res.ok) {
      if (err) {
        err.textContent = "❌ " + (data.error || "Signup failed");
        err.style.display = "block";
      }
      MC.error(data.error || "Signup failed");
      return;
    }

    if (err) err.style.display = "none";
    ["suNm", "suEml", "suHdl", "suPw"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    closeOvl("authOvl");
    MC.success(data.message || "Account created! Please check your email. 🕉");
  } catch (err) {
    console.error(err);
    MC.error("Network error. Please try again.");
  }
}
function logout() {
  CU = null;
  Store.d("currentUser");
  initUI();
  gp("home");
  MC.info("Signed out. Jai Shri Ram 🙏");
}

/* ── NAVIGATION ── */
const PAGE_IDS = [
  "home",
  "mandir",
  "mandirCommunity",
  "santAll",
  "santProfile",
  "video",
  "search",
  "notifs",
  "bookmarks",
  "profile",
  "chats",
];
function gp(page) {
  PAGE_IDS.forEach((p) => {
    const el = document.getElementById(
      "pg" + p.charAt(0).toUpperCase() + p.slice(1),
    );
    if (el) {
      el.classList.toggle("on", p === page);
      el.classList.toggle("hide", p !== page);
    }
  });
  // Desktop sidebar
  document.querySelectorAll(".sb").forEach((b) => b.classList.remove("on"));
  const sb = document.getElementById(
    "sn" + page.charAt(0).toUpperCase() + page.slice(1),
  );
  if (sb) sb.classList.add("on");
  // Bottom nav
  document.querySelectorAll(".bnb").forEach((b) => b.classList.remove("on"));
  const bn = document.getElementById(
    "bn" + page.charAt(0).toUpperCase() + page.slice(1),
  );
  if (bn) bn.classList.add("on");
  // Drawer
  document
    .querySelectorAll(".drawer-item")
    .forEach((b) => b.classList.remove("on"));
  const di = document.getElementById(
    "d" + page.charAt(0).toUpperCase() + page.slice(1),
  );
  if (di) di.classList.add("on");
  curPage = page;
  const renderers = {
    home: () => {
      renderFeed();
      renderStories();
      renderWidgets();
    },
    mandir: () => renderMandir(),
    mandirCommunity: () => { }, // rendered by openMandirCommunity
    santAll: () => renderSantAll(),
    santProfile: () => { }, // rendered by openSantProfile
    video: () => renderVideoPage(),
    search: () => {
      doSearch("");
      renderWidgets();
    },
    notifs: () => renderNotifs(),
    bookmarks: () => renderBM(),
    profile: () => renderProfile(CU ? CU.id : curProfId || "u1"),
    chats: () => renderChatsPage(),
  };
  //* pgChats needs flex not block */
  if (page === "chats") {
    const cp = document.getElementById("pgChats");
    if (cp) cp.style.display = "flex";
    const rw = document.getElementById("rightWrap");
    if (rw) rw.style.display = "none";
    // Full-width chat: expand feedWrap to fill all space
    const fw = document.getElementById("feedWrap");
    if (fw) { fw.style.maxWidth = "100%"; fw.style.borderRight = "none"; }
  } else {
    const cp = document.getElementById("pgChats");
    if (cp) cp.style.display = "";
    const rw = document.getElementById("rightWrap");
    if (rw) rw.style.display = "";
    // Restore feedWrap defaults
    const fw = document.getElementById("feedWrap");
    if (fw) { fw.style.maxWidth = ""; fw.style.borderRight = ""; }
  }
  if (renderers[page]) renderers[page]();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ── MOBILE DRAWER ── */
function openDrawer() {
  document.getElementById("mobileDrawer").classList.add("open");
  document.getElementById("drawerOverlay").classList.add("open");
  document.getElementById("hamburgerBtn").classList.add("open");
  document.getElementById("hamburgerBtn").setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  document.getElementById("mobileDrawer").classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
  document.getElementById("hamburgerBtn").classList.remove("open");
  document
    .getElementById("hamburgerBtn")
    .setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}
function toggleDrawer() {
  if (document.getElementById("mobileDrawer").classList.contains("open"))
    closeDrawer();
  else openDrawer();
}
function gpAndClose(page) {
  gp(page);
  closeDrawer();
}
function handleDrawerAuth() {
  if (CU) {
    logout();
    closeDrawer();
  } else {
    closeDrawer();
    setTimeout(() => openOvl("authOvl"), 200);
  }
}
function updateDrawer() {
  const nameEl = document.getElementById("drawerUserName");
  const hdlEl = document.getElementById("drawerUserHandle");
  const avEl = document.getElementById("drawerAv");
  const authTxt = document.getElementById("dAuthTxt");
  if (CU) {
    if (nameEl) nameEl.textContent = CU.name || "";
    if (hdlEl) hdlEl.textContent = "@" + (CU.handle || "");
    if (avEl)
      avEl.innerHTML = CU.avatar
        ? `<img src="${CU.avatar}" alt="">`
        : `${getIni(CU.name)}`;
    if (authTxt) authTxt.textContent = "Sign Out";
  } else {
    if (nameEl) nameEl.textContent = "Guest";
    if (hdlEl) hdlEl.textContent = "@guest";
    if (avEl)
      avEl.innerHTML = `<svg style="width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    if (authTxt) authTxt.textContent = "Sign In";
  }
  // Also update sidebar and topbar auth buttons
  updateNavAuthButtons();
}

function updateNavAuthButtons() {
  // Desktop sidebar auth button
  const sbAuthTxt = document.getElementById("sbAuthTxt");
  if (sbAuthTxt) sbAuthTxt.textContent = CU ? "Sign Out" : "Sign In";

  // Mobile topbar auth button
  const topbarBtn = document.getElementById("topbarAuthBtn");
  if (topbarBtn) {
    if (CU) {
      const ini = getIni(CU.name);
      topbarBtn.innerHTML = CU.avatar
        ? `<img src="${CU.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : `<span style="font-size:13px;font-weight:700;color:var(--p)">${ini}</span>`;
      topbarBtn.style.background = CU.avatar ? 'transparent' : 'var(--a)';
      topbarBtn.style.border = CU.avatar ? 'none' : '2px solid var(--p)';
      topbarBtn.style.padding = '0';
      topbarBtn.style.overflow = 'hidden';
    } else {
      topbarBtn.innerHTML = `<svg viewBox="0 0 24 24" id="topbarAuthIco"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>`;
      topbarBtn.style.background = '';
      topbarBtn.style.border = '';
      topbarBtn.style.padding = '';
      topbarBtn.style.overflow = '';
    }
  }
}

function handleSidebarAuth() {
  if (CU) {
    logout();
  } else {
    openOvl('authOvl');
  }
}
function handleTopbarAuth() {
  if (CU) {
    gp('profile');
  } else {
    openOvl('authOvl');
  }
}
function handleDrawerAuth() {
  closeDrawer();
  if (CU) {
    logout();
  } else {
    openOvl('authOvl');
  }
}

/* ── STORIES ── */
function renderStories() {
  const row = document.getElementById("storiesRow");
  if (!row) return;
  const seen = Store.g("seen", []);
  const stories = Store.g("stories", SEED_STORIES);
  let h = "";
  if (CU)
    h += `<div class="story" onclick="MC.info('Story posting coming soon! 📸')"><div class="s-ring"><div class="s-inner">${CU.avatar ? `<img src="${CU.avatar}" alt="">` : getIni(CU.name)}</div></div><div class="s-lbl">Your story</div></div>`;
  stories.forEach((s, i) => {
    const u = getUser(s.uid);
    if (!u) return;
    const ini = getIni(u.name);
    const isSeen = seen.includes(s.id);
    h += `<div class="story" onclick="viewSocialStory(${i})"><div class="s-ring${isSeen ? " seen" : ""}"><div class="s-inner">${s.src && s.type === "video" ? `<video src="${s.src}" muted>` : s.src && s.type === "image" ? `<img src="${s.src}" alt="">` : s.emo || ini}</div></div><div class="s-lbl">${u.name.split(" ")[0]}</div></div>`;
  });
  row.innerHTML = h;
}
function viewSocialStory(i) {
  const stories = Store.g("stories", SEED_STORIES);
  svIdx = i;
  showSV(stories, i);
}
function showSV(stories, i) {
  const sv = document.getElementById("sv");
  if (!sv) return;
  sv.classList.add("show");
  const s = stories[i];
  if (!s) {
    closeSV();
    return;
  }
  const u = getUser(s.uid) || { name: "Unknown", avatar: null };
  document.getElementById("svBars").innerHTML = stories
    .map(
      (_, j) =>
        `<div class="sv-seg"><div class="sv-fill" id="sf${j}"></div></div>`,
    )
    .join("");
  for (let j = 0; j < i; j++) {
    const f = document.getElementById("sf" + j);
    if (f) f.style.width = "100%";
  }
  requestAnimationFrame(() => {
    const f = document.getElementById("sf" + i);
    if (f) f.style.width = "100%";
  });
  document.getElementById("svAv").innerHTML = u.avatar
    ? `<img src="${u.avatar}" alt="">`
    : getIni(u.name);
  document.getElementById("svName").textContent = u.name;
  document.getElementById("svTime").textContent =
    (s.t || "") + (s.t ? " ago" : "");
  const cont = document.getElementById("svContent");
  if (s.type === "video" && s.src)
    cont.innerHTML = `<video src="${s.src}" autoplay playsinline controls style="max-width:100%;max-height:100%;border-radius:12px"></video>`;
  const vid = cont.querySelector("video");
  if (vid) {
    vid.muted = false;
    vid.volume = 1.0;
    vid.play().catch(() => {
      vid.muted = true;
      vid.play().catch(() => { });
    });
  } else if (s.type === "image" && s.src)
    cont.innerHTML = `<img src="${s.src}" alt="" style="max-width:100%;max-height:100%;border-radius:12px">`;
  else cont.textContent = s.emo || "🕉";
  document.getElementById("svCap").textContent = s.cap || "";
  const seen = Store.g("seen", []);
  if (!seen.includes(s.id)) {
    seen.push(s.id);
    Store.s("seen", seen);
  }
  clearTimeout(svTimer);
  svTimer = setTimeout(() => {
    if (i < stories.length - 1) showSV(stories, i + 1);
    else closeSV();
  }, 29000);
}
function closeSV() {
  clearTimeout(svTimer);
  const sv = document.getElementById("sv");
  if (sv) sv.classList.remove("show");
  const v = document.querySelector("#svContent video");
  if (v) {
    v.pause();
    v.src = "";
  }
  renderStories();
}

/* ── FEED ── */
function setFTab(tab, el) {
  curFTab = tab;
  document.querySelectorAll(".ftab").forEach((t) => t.classList.remove("on"));
  if (el) el.classList.add("on");
  renderFeed();
}
function refreshFeed() {
  const sk = document.getElementById("feedSkel");
  const fp = document.getElementById("feedPosts");
  if (sk) sk.style.display = "";
  if (fp) fp.innerHTML = "";
  setTimeout(() => {
    if (sk) sk.style.display = "none";
    renderFeed();
    MC.info("Feed refreshed 🔄");
  }, 700);
}
function renderFeed() {
  const sk = document.getElementById("feedSkel");
  const fp = document.getElementById("feedPosts");
  if (!fp) return;
  if (sk) sk.style.display = "none";
  let posts = getPosts().sort((a, b) => b.ts - a.ts);
  if (curFTab === "following" && CU) {
    const fl = CU.following || [];
    posts = posts.filter((p) => fl.includes(p.uid) || p.uid === CU.id);
  }
  if (curFTab === "trending")
    posts = [...posts].sort(
      (a, b) =>
        b.likes.length + b.reposts.length - (a.likes.length + a.reposts.length),
    );
  if (!posts.length) {
    fp.innerHTML = `<div class="empty"><div class="empty-ico">🕉</div><div class="empty-ttl">No posts yet</div><div class="empty-sub">${curFTab === "following" ? "Follow people to see their posts" : "Be first to share something!"}</div></div>`;
    return;
  }
  fp.innerHTML = posts.map((p) => mkPost(p)).join("");
}
function mkPost(p) {
  const u = getUser(p.uid);
  if (!u) return "";
  const ini = getIni(u.name);
  const avH = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
  const liked = CU && p.likes.includes(CU.id);
  const rp = CU && p.reposts.includes(CU.id);
  const bm = CU && (p.bm || []).includes(CU.id);
  const isOwn = CU && p.uid === CU.id;
  let pollH = "";
  if (p.poll) {
    const tot = p.poll.votes.length;
    const myV = CU ? p.poll.votes.find((v) => v.startsWith(CU.id + ":")) : null;
    pollH = `<div class="poll">${p.poll.opts
      .map((opt, i) => {
        const cnt = p.poll.votes.filter((v) => v.endsWith(":" + i)).length;
        const pct = tot ? Math.round((cnt / tot) * 100) : 0;
        const isMyV = myV && myV.endsWith(":" + i);
        return `<button class="poll-opt${myV ? " poll-voted" : ""}" ${myV ? "disabled" : `onclick="castVote('${p.id}',${i})"`}>${myV ? `<div class="poll-bar" style="width:${pct}%"></div>` : ""}<div class="poll-lbl"><span>${opt}${isMyV ? " ✓" : ""}</span>${myV ? `<span>${pct}%</span>` : ""}</div></button>`;
      })
      .join(
        "",
      )}<div class="poll-info">${tot} vote${tot !== 1 ? "s" : ""}</div></div>`;
  }
  // ★ YouTube embed HTML — renders when a post includes a YouTube video ID
  const ytH = p.ytId
    ? `<div class="yt-container" style="margin:8px 0;border-radius:10px;overflow:hidden;border:1px solid var(--bd)">
               <iframe
                 src="https://www.youtube.com/embed/${p.ytId}?rel=0&modestbranding=1"
                 title="YouTube video"
                 allowfullscreen
                 loading="lazy"
                 allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
               </iframe>
             </div>`
    : "";
  const cmts = p.cmts || [];
  return `<div class="post" id="pt_${p.id}"><div class="post-row"><div style="position:relative;flex-shrink:0"><div class="av av40" onclick="vpro('${u.id}')" style="cursor:pointer">${avH}</div>${rp ? `<div style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;background:#43a047;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg)"><svg style="width:9px;height:9px;stroke:#fff;fill:none;stroke-width:2" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div>` : ""}</div><div class="post-body"><div class="post-meta"><span class="post-name" onclick="vpro('${u.id}')">${u.name}</span>${u.verified ? `<span class="vbadge"><svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></span>` : ""}<span class="post-handle">@${u.handle}</span><span class="post-time">· ${p.t}</span><div class="more-wrap"><button class="sb" style="width:26px;height:26px;border-radius:6px" onclick="toggleMore('${p.id}',event)"><svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button><div class="more-menu" id="mm_${p.id}">${isOwn ? `<button class="mi red" onclick="delPost('${p.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete</button>` : ""}<button class="mi" onclick="copyLink()"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Copy link</button><button class="mi" onclick="closeMore()"><svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>Report</button></div></div></div><div class="post-txt" onclick="openPD('${p.id}')">${esc(p.txt)}</div>${p.img ? `<img src="${p.img}" class="post-img" onclick="openPD('${p.id}')" alt="" loading="lazy">` : ""}${ytH}${pollH}<div class="post-acts"><button class="pa" onclick="toggleCmts('${p.id}',event)"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${cmts.length}</button><button class="pa${rp ? " reposted" : ""}" onclick="openRP('${p.id}',event)"><svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${p.reposts.length}</button><button class="pa${liked ? " liked" : ""}" onclick="toggleLike('${p.id}',this,event)"><svg viewBox="0 0 24 24" ${liked ? 'style="fill:#e53935;stroke:#e53935"' : ""}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span id="lc_${p.id}" onclick="openLikes('${p.id}',event)">${p.likes.length}</span></button><button class="pa${bm ? " saved" : ""}" onclick="toggleBM('${p.id}',this,event)"><svg viewBox="0 0 24 24" ${bm ? 'style="fill:var(--ad);stroke:var(--ad)"' : ""}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button><button class="pa" onclick="openSH('${p.id}',event)"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button></div></div></div><div class="cmts" id="cm_${p.id}">${cmts
    .map((c) => {
      const cu = getUser(c.uid);
      return `<div class="cmt">${avHTML(c.uid, "av28")}<div class="cmt-body" style="margin-left:8px"><span class="cmt-name">${cu?.name || "User"}</span><span class="cmt-time"> ${c.t}</span><br>${esc(c.txt)}</div></div>`;
    })
    .join(
      "",
    )}<div class="cmt-row">${avHTML(CU ? CU.id : "u1", "av28")}<input class="cmt-in" id="ci_${p.id}" placeholder="Post a reply…" onkeydown="if(event.key==='Enter'){event.preventDefault();submitCmt('${p.id}')}"><button class="btn btn-p btn-sm" onclick="submitCmt('${p.id}')">Reply</button></div></div></div>`;
}

/* ── POST ACTIONS ── */
function toggleMore(id, e) {
  if (e) e.stopPropagation();
  document.querySelectorAll(".more-menu").forEach((m) => {
    if (m.id !== "mm_" + id) m.classList.remove("show");
  });
  const m = document.getElementById("mm_" + id);
  if (m) m.classList.toggle("show");
}
function closeMore() {
  document
    .querySelectorAll(".more-menu")
    .forEach((m) => m.classList.remove("show"));
}
document.addEventListener("click", closeMore);
function toggleLike(id, btn, e) {
  if (e) e.stopPropagation();
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const p = getPost(id);
  if (!p) return;
  const i = p.likes.indexOf(CU.id);
  if (i > -1) p.likes.splice(i, 1);
  else {
    p.likes.push(CU.id);
    addNotif("like", CU.id, id, p.uid);
  }
  savePost(id, { likes: p.likes });
  const liked = p.likes.includes(CU.id);
  if (btn) {
    btn.className = `pa${liked ? " liked" : ""}`;
    const sv = btn.querySelector("svg");
    if (sv) {
      sv.style.fill = liked ? "#e53935" : "";
      sv.style.stroke = liked ? "#e53935" : "";
    }
  }
  const sp = document.getElementById("lc_" + id);
  if (sp) sp.textContent = p.likes.length;
}
function toggleBM(id, btn, e) {
  if (e) e.stopPropagation();
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const p = getPost(id);
  if (!p) return;
  const bm = p.bm || [];
  const i = bm.indexOf(CU.id);
  if (i > -1) bm.splice(i, 1);
  else bm.push(CU.id);
  savePost(id, { bm });
  const saved = bm.includes(CU.id);
  if (btn) {
    btn.className = `pa${saved ? " saved" : ""}`;
    const sv = btn.querySelector("svg");
    if (sv) {
      sv.style.fill = saved ? "var(--ad)" : "";
      sv.style.stroke = saved ? "var(--ad)" : "";
    }
  }
  MC.info(saved ? "Saved to bookmarks 🔖" : "Removed from bookmarks");
}
function toggleCmts(id, e) {
  if (e) e.stopPropagation();
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const el = document.getElementById("cm_" + id);
  if (el) el.style.display = el.style.display === "block" ? "none" : "block";
}
function submitCmt(id) {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const inp = document.getElementById("ci_" + id);
  const text = inp?.value?.trim() || "";
  if (!text) return;
  const p = getPost(id);
  if (!p) return;
  const nc = {
    id: "c" + Date.now(),
    uid: CU.id,
    txt: text,
    t: "Just now",
  };
  p.cmts.push(nc);
  savePost(id, { cmts: p.cmts });
  addNotif("comment", CU.id, id, p.uid);
  const cm = document.getElementById("cm_" + id);
  if (cm) {
    const d = document.createElement("div");
    d.className = "cmt";
    d.innerHTML = `${avHTML(CU.id, "av28")}<div class="cmt-body" style="margin-left:8px"><span class="cmt-name">${CU.name}</span><br>${esc(text)}</div>`;
    cm.insertBefore(d, cm.lastElementChild);
  }
  if (inp) inp.value = "";
  MC.success("Reply posted 🙏");
}
function openRP(id, e) {
  if (e) e.stopPropagation();
  if (!auth(() => { })) return;
  activeRP = id;
  document.getElementById("rpSheet").classList.add("show");
  document.getElementById("rpOvl").style.display = "block";
}
function closeRP() {
  document.getElementById("rpSheet")?.classList.remove("show");
  const o = document.getElementById("rpOvl");
  if (o) o.style.display = "none";
}
function doRepost() {
  if (!CU || !activeRP) return;
  const p = getPost(activeRP);
  if (!p) return;
  const i = p.reposts.indexOf(CU.id);
  if (i > -1) {
    p.reposts.splice(i, 1);
    savePost(activeRP, { reposts: p.reposts });
    MC.info("Repost removed");
  } else {
    p.reposts.push(CU.id);
    savePost(activeRP, { reposts: p.reposts });
    addNotif("repost", CU.id, activeRP, p.uid);
    MC.success("Reposted! 🔁");
  }
  closeRP();
  renderFeed();
}
function doQuote() {
  closeRP();
  if (!activeRP) return;
  const p = getPost(activeRP);
  const u = getUser(p?.uid);
  const ta = document.getElementById("compTxt");
  if (ta)
    ta.value = `\n\n@${u?.handle || "user"}: "${(p?.txt || "").substring(0, 50)}…"`;
  openOvl("compOvl");
}
function openSH(id, e) {
  if (e) e.stopPropagation();
  activeSH = id;
  document.getElementById("shareSheet").classList.add("show");
  document.getElementById("shareOvl").style.display = "block";
}
function closeSH() {
  document.getElementById("shareSheet")?.classList.remove("show");
  const o = document.getElementById("shareOvl");
  if (o) o.style.display = "none";
}
function shareAct(t) {
  closeSH();
  const m = {
    copy: "Link copied! 🔗",
    dm: "Sent as DM 💬",
    wa: "Opening WhatsApp…",
    bm: "Saved 🔖",
  };
  MC.success(m[t] || "Shared!");
}
function openLikes(id, e) {
  if (e) e.stopPropagation();
  const p = getPost(id);
  if (!p) return;
  const c = document.getElementById("likesContent");
  if (!c) return;
  c.innerHTML = !p.likes.length
    ? `<div class="empty"><div class="empty-ico">🙏</div><div class="empty-sub">No Pranams yet</div></div>`
    : p.likes
      .map((uid) => {
        const u = getUser(uid);
        if (!u) return "";
        return `<div class="fol-item">${avHTML(uid, "av36")}<div style="flex:1;min-width:0;margin-left:10px"><div style="font-weight:600;font-size:14px" onclick="vpro('${u.id}')">${u.name}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div><button class="btn btn-sm ${CU && (CU.following || []).includes(uid) ? "btn-o" : "btn-p"}" onclick="toggleFollow('${uid}',this)">${CU && (CU.following || []).includes(uid) ? "Following" : "Follow"}</button></div>`;
      })
      .join("");
  openOvl("likesOvl");
}
function openPD(id) {
  const p = getPost(id);
  if (!p) return;
  const c = document.getElementById("pdContent");
  if (!c) return;
  c.innerHTML =
    mkPost(p) +
    `<div style="padding:12px 16px"><div class="cmt-row">${avHTML(CU ? CU.id : "u1", "av36")}<input class="cmt-in" id="pdc_${id}" placeholder="Post a reply…" onkeydown="if(event.key==='Enter'){event.preventDefault();submitCmt('${id}')}"><button class="btn btn-p btn-sm" onclick="submitCmt('${id}')">Reply</button></div></div>`;
  openOvl("pdOvl");
}
function castVote(id, opt) {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const p = getPost(id);
  if (!p || !p.poll) return;
  if (p.poll.votes.find((v) => v.startsWith(CU.id + ":"))) return;
  p.poll.votes.push(`${CU.id}:${opt}`);
  savePost(id, { poll: p.poll });
  renderFeed();
  MC.success("Vote cast! 🗳");
}
function delPost(id) {
  if (!CU) return;
  const posts = getPosts().filter((p) => !(p.id === id && p.uid === CU.id));
  Store.s("posts", posts);
  closeMore();
  const el = document.getElementById("pt_" + id);
  if (el) el.remove();
  MC.info("Post deleted");
}
function copyLink() {
  closeMore();
  MC.success("Link copied! 🔗");
}

/* ── COMPOSE ── */
function updateCC() {
  const ta = document.getElementById("compTxt");
  const cc = document.getElementById("ccNum");
  if (!ta || !cc) return;
  const rem = 280 - ta.value.length;
  cc.textContent = rem;
  cc.style.color = rem < 20 ? "#e53935" : rem < 50 ? "#f57c00" : "var(--t3)";
}
function handleCompImg(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    compImg = ev.target.result;
    const el = document.getElementById("compImgEl");
    if (el) el.src = ev.target.result;
    document.getElementById("compImgPrev")?.classList.remove("hide");
  };
  r.readAsDataURL(f);
}
function removeCompImg() {
  compImg = null;
  document.getElementById("compImgPrev")?.classList.add("hide");
  const el = document.getElementById("compImgEl");
  if (el) el.src = "";
}

/* ── YOUTUBE LINK INTEGRATION ──────────────────────────────────────
         Extracts the video ID from any standard YouTube URL format and
         renders a responsive 16:9 embedded player as a live preview.
         Supported URL patterns:
           https://www.youtube.com/watch?v=VIDEO_ID
           https://youtu.be/VIDEO_ID
           https://www.youtube.com/embed/VIDEO_ID
           https://m.youtube.com/watch?v=VIDEO_ID
      ──────────────────────────────────────────────────────────────────── */
let compYTId = null; // stores the current YouTube video ID for posting

/**
 * Extracts a YouTube video ID from a URL string.
 * Returns the video ID string, or null if no valid ID found.
 */
function extractYTId(url) {
  if (!url || typeof url !== "string") return null;
  url = url.trim();
  // Pattern: watch?v=ID or &v=ID
  let m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  // Pattern: youtu.be/ID
  m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  // Pattern: /embed/ID
  m = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  // Pattern: /shorts/ID
  m = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

/** Shows/hides the YouTube link input row in the compose modal. */
function toggleYTInput() {
  const row = document.getElementById("ytLinkRow");
  const btn = document.getElementById("ytBtn");
  if (!row) return;
  const isHidden = row.classList.contains("hide");
  row.classList.toggle("hide", !isHidden);
  if (btn) btn.style.color = isHidden ? "var(--p)" : "";
  if (!isHidden)
    clearYTLink(); // reset when hiding
  else {
    const inp = document.getElementById("ytLinkInput");
    if (inp) inp.focus();
  }
}

/** Called on every keystroke in the YouTube link input.
 *  If a valid YouTube URL is detected, renders a live preview iframe. */
function previewYTLink(url) {
  const preview = document.getElementById("ytLinkPreview");
  if (!preview) return;
  const id = extractYTId(url);
  compYTId = id || null;
  if (id) {
    // Build responsive iframe preview
    preview.innerHTML = `
            <div class="yt-container" style="border-radius:10px;overflow:hidden">
              <iframe
                src="https://www.youtube.com/embed/${id}?rel=0&modestbranding=1"
                title="YouTube preview"
                allowfullscreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
              </iframe>
            </div>`;
    preview.classList.remove("hide");
  } else {
    preview.innerHTML = "";
    preview.classList.add("hide");
  }
}

/** Clears the YouTube link input and hides the preview. */
function clearYTLink() {
  compYTId = null;
  const inp = document.getElementById("ytLinkInput");
  if (inp) inp.value = "";
  const preview = document.getElementById("ytLinkPreview");
  if (preview) {
    preview.innerHTML = "";
    preview.classList.add("hide");
  }
}
function toggleEmoji() {
  const area = document.getElementById("emojiArea");
  if (!area) return;
  area.classList.toggle("hide");
  if (!area.classList.contains("hide")) {
    const emojis = [
      "🕉",
      "🙏",
      "🏔",
      "🛕",
      "📖",
      "🌸",
      "🔱",
      "💧",
      "🌅",
      "✨",
      "🪔",
      "📿",
      "🌊",
      "⛰️",
      "🌺",
      "🕯",
      "🌿",
      "🔔",
      "🎆",
      "🌙",
    ];
    area.innerHTML = emojis
      .map(
        (e) => `<button class="emj" onclick="insEmoji('${e}')">${e}</button>`,
      )
      .join("");
  }
}
function insEmoji(e) {
  const ta = document.getElementById("compTxt");
  if (ta) {
    ta.value += e;
    updateCC();
    ta.focus();
  }
}
function submitPost() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const txt = document.getElementById("compTxt")?.value?.trim() || "";
  if (!txt && !compImg && !compYTId) {
    MC.warn("Please write something or add a YouTube video to share 🙏");
    return;
  }
  let poll = null;
  const pa = document.getElementById("pollArea");
  if (pa && !pa.classList.contains("hide")) {
    const o1 = document.getElementById("p1")?.value?.trim() || "";
    const o2 = document.getElementById("p2")?.value?.trim() || "";
    const o3 = document.getElementById("p3")?.value?.trim() || "";
    if (o1 && o2) poll = { opts: [o1, o2, ...(o3 ? [o3] : [])], votes: [] };
  }
  const posts = getPosts();
  posts.unshift({
    id: "p" + Date.now(),
    uid: CU.id,
    txt,
    img: compImg || null,
    ytId: compYTId || null, // ★ YouTube video ID stored here
    likes: [],
    cmts: [],
    reposts: [],
    bm: [],
    poll,
    t: "Just now",
    ts: Date.now(),
  });
  Store.s("posts", posts);
  const ta = document.getElementById("compTxt");
  if (ta) ta.value = "";
  removeCompImg();
  clearYTLink();
  // Hide YouTube row & reset button
  const ytRow = document.getElementById("ytLinkRow");
  if (ytRow) ytRow.classList.add("hide");
  const ytBtn = document.getElementById("ytBtn");
  if (ytBtn) ytBtn.style.color = "";
  document.getElementById("pollArea")?.classList.add("hide");
  document.getElementById("emojiArea")?.classList.add("hide");
  closeOvl("compOvl");
  renderFeed();
  MC.success("Posted! 🙏");
  if (curPage !== "home") gp("home");
}

/* ── MANDIR COMMUNITY PAGE ── */
function renderMandir() {
  // Temples
  const ts = document.getElementById("templeScroll");
  if (ts)
    ts.innerHTML = TEMPLES.map(
      (t) =>
        `<div class="temple-card" onclick="MC.info('${t.name} — Live Darshan coming soon! 🛕')"><div class="temple-thumb" style="background:${t.color}">${t.emoji}</div><div class="temple-info"><div class="temple-name">${t.name}</div><div class="temple-loc">${t.loc}</div></div></div>`,
    ).join("");
  // Events
  const el = document.getElementById("eventsList");
  if (el)
    el.innerHTML = EVENTS.map(
      (ev) =>
        `<div class="event-item"><div class="event-date"><div class="ed-day">${ev.day}</div><div class="ed-mon">${ev.mon}</div></div><div class="event-info"><div class="event-title">${ev.title}</div><div class="event-sub">${ev.sub}</div></div><span class="event-tag">${ev.tag}</span></div>`,
    ).join("");
  // Sants — show first 4 in grid
  const sg = document.getElementById("santGrid");
  if (sg)
    sg.innerHTML = SANTS.slice(0, 4).map((s, idx) => {
      const u = s.uid ? getUser(s.uid) : null;
      const name = u ? u.name : (s.name || s.handle);
      const isVerified = (s.verified !== undefined) ? s.verified : (u ? u.verified : true);
      const avatarSrc = s.src || (u && u.avatar ? u.avatar : "");
      const ini = getIni(name);
      const imgHtml = avatarSrc
        ? `<img src="${avatarSrc}" alt="${name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
           <span class="av-ini-fb" style="display:none">${ini}</span>`
        : `<span>${ini}</span>`;
      return `<div class="sant-card" onclick="openSantProfile(${idx})">
        <div class="sant-avatar-wrap">${imgHtml}</div>
        <div class="sant-info">
          <div class="sant-name">${name}${isVerified ? ` <svg class="sant-chk" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877f2"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` : ""}</div>
          <div class="sant-title">${s.title}</div>
          <div class="sant-followers">${s.followers} followers</div>
        </div>
      </div>`;
    }).join("");
  // Discussions
  const disc = document.getElementById("mandirDiscussions");
  if (disc)
    disc.innerHTML = MANDIR_DISCUSSIONS.map((d) => {
      const u = getUser(d.uid);
      if (!u) return "";
      const ini = getIni(u.name);
      return `<div class="disc-post"><div class="av av36">${u.avatar ? `<img src="${u.avatar}" alt="">` : ini}</div><div class="disc-body"><div class="disc-meta">${u.name}${u.verified ? " 🔱" : ""} · ${d.t}</div><div class="disc-text">${esc(d.txt)}</div><div class="disc-acts"><button class="disc-btn" onclick="auth(()=>MC.success('Pranam given! 🙏'))"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${d.likes}</button><button class="disc-btn" onclick="auth(()=>openOvl('compOvl'))"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${d.cmts}</button><button class="disc-btn" onclick="openSH('d1',event)"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share</button></div></div></div>`;
    }).join("");
}

/* ── SANT ALL LIST PAGE ── */
let currentSantFilter = "";
function renderSantAll(filter) {
  if (filter !== undefined) currentSantFilter = filter;
  const f = (currentSantFilter || "").toLowerCase();
  const list = document.getElementById("santAllList");
  if (!list) return;
  const filtered = SANTS.filter(s => {
    const u = s.uid ? getUser(s.uid) : null;
    const name = u ? u.name : (s.name || s.handle || "");
    return !f || name.toLowerCase().includes(f) ||
      (s.title || "").toLowerCase().includes(f) ||
      (s.handle || "").toLowerCase().includes(f);
  });
  if (filtered.length === 0) {
    list.innerHTML = '<div class="sant-all-empty">🔍 No Sants found</div>';
    return;
  }
  list.innerHTML = filtered.map((s) => {
    const realIdx = SANTS.indexOf(s);
    const u = s.uid ? getUser(s.uid) : null;
    const name = u ? u.name : (s.name || s.handle);
    const isVerified = (s.verified !== undefined) ? s.verified : (u ? u.verified : true);
    const avatarSrc = s.src || (u && u.avatar ? u.avatar : "");
    const ini = getIni(name);
    const imgHtml = avatarSrc
      ? `<img src="${avatarSrc}" alt="${name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="av-ini-fb" style="display:none">${ini}</span>`
      : `<span class="av-ini-fb-only">${ini}</span>`;
    // Sub-line: show "@handle · Xk followers" or "@handle · Following"
    const followersTxt = (s.followers === "Following" || s.followers === "0" || !s.followers)
      ? "Following" : `${s.followers} followers`;
    return `<div class="sant-list-item" onclick="openSantProfile(${realIdx})">
      <div class="sant-list-avatar">${imgHtml}</div>
      <div class="sant-list-info">
        <div class="sant-list-name">${name}${isVerified ? ` <svg class="sant-chk" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877f2"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` : ""}</div>
        <div class="sant-list-sub">@${s.handle} · ${followersTxt}</div>
        <div class="sant-list-title">${s.title}</div>
      </div>
      <button class="sant-list-follow" onclick="event.stopPropagation();this.classList.toggle('following');this.textContent=this.classList.contains('following')?'Following ✓':'Follow';">Follow</button>
    </div>`;
  }).join("");
}

/* ── SANT PROFILE PAGE ── */
let curSantIdx = 0;
function openSantProfile(idx) {
  curSantIdx = idx;
  const s = SANTS[idx];
  if (!s) return;
  const u = s.uid ? getUser(s.uid) : null;
  const name = u ? u.name : (s.name || s.handle);
  const isVerified = (s.verified !== undefined) ? s.verified : (u ? u.verified : true);
  const avatarSrc = s.src || (u && u.avatar ? u.avatar : "");
  const ini = getIni(name);
  const bio = s.bio || (u ? u.bio : "");
  const loc = s.location || (u ? u.location : "");
  const website = s.website || (u ? u.website : "");

  // Set avatar
  const avImg = document.getElementById("spAvatar");
  const avFb = document.getElementById("spAvatarFb");
  if (avatarSrc) {
    avImg.src = avatarSrc;
    avImg.style.display = "block";
    avImg.onerror = () => { avImg.style.display = "none"; avFb.style.display = "flex"; avFb.textContent = ini; };
    avFb.style.display = "none";
  } else {
    avImg.style.display = "none";
    avFb.style.display = "flex";
    avFb.textContent = ini;
  }

  // Header
  document.getElementById("spHandle").textContent = "@" + (s.handle || (u ? u.handle : ""));
  document.getElementById("spName").textContent = name;
  const spVBadge = document.getElementById("spVerifiedBadge");
  if (spVBadge) spVBadge.style.display = isVerified ? "inline-flex" : "none";
  document.getElementById("spCategory").textContent = s.category || s.title || "";

  // Bio
  const bioEl = document.getElementById("spBio");
  if (bioEl) bioEl.textContent = bio || "";

  // Stats
  document.getElementById("spPosts").textContent = s.posts || "0";
  document.getElementById("spFollowers").textContent = s.followers || "0";
  document.getElementById("spFollowing").textContent = s.following || "0";

  // Location
  const locWrap = document.getElementById("spLocationWrap");
  const locEl = document.getElementById("spLocation");
  if (locWrap && locEl) {
    locWrap.style.display = loc ? "flex" : "none";
    locEl.textContent = loc || "";
  }

  // Website
  const webWrap = document.getElementById("spWebsiteWrap");
  const webEl = document.getElementById("spWebsite");
  if (webWrap && webEl) {
    webWrap.style.display = website ? "flex" : "none";
    webEl.textContent = website || "";
    webEl.href = website ? (website.startsWith("http") ? website : "https://" + website) : "#";
  }

  // Highlights
  const hlContainer = document.getElementById("spHighlights");
  if (hlContainer) {
    const highlights = s.highlights || [];
    hlContainer.innerHTML = highlights.map(hl =>
      `<div class="sp-hl-item">
        <div class="sp-hl-circle">${s.emoji || "🙏"}</div>
        <div class="sp-hl-label">${hl}</div>
      </div>`
    ).join("");
  }

  // Navigate to page
  gp("santProfile");
}

/* ── MANDIR COMMUNITY CONFIG ── */
const MANDIR_CONFIG = {
  "kedarnath": {
    name: "Kedarnath Temple",
    handle: "kedarnath_mandir",
    slug: "kedarnath",
    image: "images/temples/kedarnath.jpg",
    bio: "Official Kedarnath Temple Community 🏔 Ancient Shiva temple at 3583m altitude in the Himalayas. One of the Char Dhams.",
    category: "Religious Organisation",
    location: "Rudraprayag, Uttarakhand",
    followers: "1.2M",
    following: "0",
    highlights: ["Yatra 2025", "Morning Aarti", "Snow Season", "History", "Trekking"],
    email: "kedarnath@tirthsutra.com",
  },
  "kashi-vishwanath": {
    name: "Kashi Vishwanath",
    handle: "kashi_mandir",
    slug: "kashi-vishwanath",
    image: "images/temples/kashi-vishwanath.jpg",
    bio: "Official Kashi Vishwanath Temple Community 🕉 The divine abode of Lord Shiva on the banks of sacred Ganga in Varanasi.",
    category: "Religious Organisation",
    location: "Varanasi, UP",
    followers: "2.8M",
    following: "0",
    highlights: ["Ganga Aarti", "Corridor Tour", "Daily Darshan", "Festivals", "History"],
    email: "kashi@tirthsutra.com",
  },
  "tirupati": {
    name: "Tirupati Balaji",
    handle: "tirupati_mandir",
    slug: "tirupati",
    image: "images/temples/tirupati.jpg",
    bio: "Official Tirupati Balaji Community 🛕 Tirumala Tirupati Devasthanams — the richest and most visited pilgrimage site.",
    category: "Religious Organisation",
    location: "Tirupati, AP",
    followers: "5.6M",
    following: "0",
    highlights: ["Darshan Info", "Seva Booking", "Kalyanotsavam", "Prasadam", "Festivals"],
    email: "tirupati@tirthsutra.com",
  },
  "somnath": {
    name: "Somnath Temple",
    handle: "somnath_mandir",
    slug: "somnath",
    image: "images/temples/somnath.jpg",
    bio: "Official Somnath Temple Community 🌊 First among the 12 Jyotirlingas, standing gloriously on the shores of Arabian Sea.",
    category: "Religious Organisation",
    location: "Veraval, Gujarat",
    followers: "890K",
    following: "0",
    highlights: ["Light Show", "Aarti", "Sea View", "History", "Pilgrimage"],
    email: "somnath@tirthsutra.com",
  },
  "meenakshi": {
    name: "Meenakshi Amman",
    handle: "meenakshi_mandir",
    slug: "meenakshi",
    image: "images/temples/meenakshi.jpg",
    bio: "Official Meenakshi Amman Temple Community 🌺 Magnificent Dravidian temple with towering gopurams and 33,000 sacred sculptures.",
    category: "Religious Organisation",
    location: "Madurai, TN",
    followers: "1.5M",
    following: "0",
    highlights: ["Chithirai", "Architecture", "Night Temple", "Sculptures", "Festivals"],
    email: "meenakshi@tirthsutra.com",
  },
  "ram-mandir": {
    name: "Ram Mandir Ayodhya",
    handle: "ramji_mandir",
    slug: "ram-mandir",
    image: "images/temples/ram-mandir.jpg",
    bio: "Official Ram Mandir Community 🏹 The sacred birthplace of Lord Ram — the grand newly built temple at Ayodhya Dham.",
    category: "Religious Organisation",
    location: "Ayodhya, UP",
    followers: "8.2M",
    following: "0",
    highlights: ["Aarti Schedule", "Architecture", "Ram Lalla", "History", "Live Darshan"],
    email: "ramji@tirthsutra.com",
  },
};

let currentMandirSlug = null;
let currentMandirPosts = [];
let mandirCompImgData = null;

function openMandirCommunity(slug) {
  const config = MANDIR_CONFIG[slug];
  if (!config) {
    MC.error("Mandir not found");
    return;
  }
  currentMandirSlug = slug;

  // Navigate to mandirCommunity page
  gp("mandirCommunity");

  // Fill header info
  document.getElementById("mcTopTitle").textContent = config.handle;
  document.getElementById("mcAvatar").src = config.image;
  document.getElementById("mcName").textContent = config.name;
  document.getElementById("mcCategory").textContent = config.category;
  document.getElementById("mcBio").textContent = config.bio;
  document.getElementById("mcLocation").querySelector("span").textContent = config.location;
  document.getElementById("mcFollowers").textContent = config.followers;
  document.getElementById("mcFollowing").textContent = config.following;

  // Render highlights
  const hlEl = document.getElementById("mcHighlights");
  if (hlEl && config.highlights) {
    hlEl.innerHTML = config.highlights.map((h, i) =>
      `<div class="mc-hl-item">
        <div class="mc-hl-circle">
          <span>${["🕉", "🔱", "🛕", "📿", "🪷"][i % 5]}</span>
        </div>
        <div class="mc-hl-label">${h}</div>
      </div>`
    ).join("");
  }

  // Show/hide compose FAB based on auth
  const fab = document.getElementById("mcComposeFab");
  const storedUser = API.getStoredUser();
  if (storedUser && storedUser.mandirId === slug) {
    fab.classList.remove("hide");
  } else {
    fab.classList.add("hide");
  }

  // Reset tabs
  document.querySelectorAll(".mc-tab").forEach(t => t.classList.remove("on"));
  document.getElementById("mcTabAll").classList.add("on");

  // Load posts
  loadMandirPosts(slug);
}

async function loadMandirPosts(mandirId) {
  const grid = document.getElementById("mcPostGrid");
  const empty = document.getElementById("mcEmpty");
  const countEl = document.getElementById("mcPostCount");

  // Show loading skeleton
  grid.innerHTML = Array(6).fill('').map(() =>
    '<div class="mc-post-cell"><div class="skel" style="width:100%;height:100%"></div></div>'
  ).join('');
  empty.classList.add("hide");

  try {
    const data = await API.getMandirPosts(mandirId);
    currentMandirPosts = data.posts || [];
    countEl.textContent = data.total || currentMandirPosts.length;

    if (currentMandirPosts.length === 0) {
      grid.innerHTML = "";
      empty.classList.remove("hide");
      return;
    }

    empty.classList.add("hide");
    renderMandirGrid(currentMandirPosts);
  } catch (err) {
    console.error("Load mandir posts error:", err);
    grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">Failed to load posts. Please try again.</div>';
  }
}

function renderMandirGrid(posts) {
  const grid = document.getElementById("mcPostGrid");
  grid.innerHTML = posts.map((p, i) => {
    const mt = p.mediaType || (p.video ? "video" : p.img ? "image" : "text");
    let preview = "";
    if (mt === "video") {
      preview = p.img
        ? `<img src="${p.img}" alt="" class="mc-grid-img" loading="lazy"><div class="mc-grid-play">▶</div>`
        : `<div class="mc-grid-text mc-grid-video-bg"><div class="mc-grid-play">▶</div></div>`;
    } else if (mt === "image" && p.img) {
      preview = `<img src="${p.img}" alt="Post" class="mc-grid-img" loading="lazy">`;
    } else {
      preview = `<div class="mc-grid-text"><p>${esc(p.txt).substring(0, 120)}</p></div>`;
    }
    const realIdx = currentMandirPosts.indexOf(p) >= 0 ? currentMandirPosts.indexOf(p) : i;
    const action = mt === "video" ? `openMandirShorts(${realIdx})` : `openMandirPostDetail(${realIdx})`;
    return `<div class="mc-post-cell" onclick="${action}">
      ${preview}
      <div class="mc-post-overlay">
        <span>❤ ${p.likes.length}</span>
        <span>💬 ${p.cmts ? p.cmts.length : 0}</span>
      </div>
    </div>`;
  }).join("");
}

function openMandirPostDetail(idx) {
  const p = currentMandirPosts[idx];
  if (!p) return;
  const detail = document.getElementById("mandirPostDetail");
  const u = p.user || {};
  const ini = getIni(u.name || "U");
  const avatarHtml = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;

  let commentsHtml = "";
  if (p.cmts && p.cmts.length > 0) {
    commentsHtml = p.cmts.map(c => {
      const cu = c.user || {};
      const cIni = getIni(cu.name || "U");
      return `<div style="display:flex;gap:8px;padding:8px 0;border-top:1px solid var(--bd)">
        <div class="av av28">${cu.avatar ? `<img src="${cu.avatar}">` : cIni}</div>
        <div style="flex:1"><strong style="font-size:13px">${cu.name || 'User'}</strong> <span style="font-size:12px;color:var(--t3)">${c.t}</span><div style="font-size:13px;margin-top:2px">${esc(c.txt)}</div></div>
      </div>`;
    }).join("");
  }

  detail.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
      <div class="av av40">${avatarHtml}</div>
      <div>
        <strong>${u.name || 'Unknown'}</strong>${u.verified ? ' 🔱' : ''}
        <div style="font-size:12px;color:var(--t3)">@${u.handle || 'user'} · ${p.t}</div>
      </div>
    </div>
    ${p.txt ? `<div style="font-size:15px;line-height:1.5;margin-bottom:12px;white-space:pre-wrap">${esc(p.txt)}</div>` : ''}
    ${p.video ? `<video src="${p.video}" controls playsinline style="width:100%;border-radius:10px;margin-bottom:12px;max-height:400px"></video>` : (p.img ? `<img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:12px" alt="Post" loading="lazy">` : '')}
    <div style="display:flex;gap:16px;padding:10px 0;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd)">
      <button class="disc-btn" onclick="toggleMandirPostLike('${p.id}', ${idx})">❤ ${p.likes.length}</button>
      <button class="disc-btn">💬 ${p.cmts ? p.cmts.length : 0}</button>
    </div>
    ${commentsHtml}
    <div style="display:flex;gap:8px;margin-top:12px">
      <input type="text" id="mcCommentInput" placeholder="Add a comment..." style="flex:1;padding:8px 12px;border-radius:20px;border:1px solid var(--bd);background:var(--bg2);color:var(--t1);font-size:13px">
      <button class="btn btn-p btn-sm" onclick="addMandirPostComment('${p.id}', ${idx})">Post</button>
    </div>
  `;
  openOvl("mandirPostOvl");
}

async function toggleMandirPostLike(postId, idx) {
  if (!API.getToken()) {
    openOvl("authOvl");
    return;
  }
  try {
    const result = await API.toggleMandirLike(currentMandirSlug, postId);
    if (currentMandirPosts[idx]) {
      currentMandirPosts[idx].likes = result.likes;
    }
    renderMandirGrid(currentMandirPosts);
    openMandirPostDetail(idx);
  } catch (err) {
    MC.error("Failed to like post");
  }
}

async function addMandirPostComment(postId, idx) {
  if (!API.getToken()) {
    openOvl("authOvl");
    return;
  }
  const input = document.getElementById("mcCommentInput");
  const text = (input?.value || "").trim();
  if (!text) return;
  try {
    const comment = await API.addMandirComment(currentMandirSlug, postId, text);
    if (currentMandirPosts[idx]) {
      if (!currentMandirPosts[idx].cmts) currentMandirPosts[idx].cmts = [];
      currentMandirPosts[idx].cmts.push(comment);
    }
    input.value = "";
    openMandirPostDetail(idx);
    MC.success("Comment added! 🙏");
  } catch (err) {
    MC.error("Failed to add comment");
  }
}

function setMCTab(tab, el) {
  document.querySelectorAll(".mc-tab").forEach(t => t.classList.remove("on"));
  if (el) el.classList.add("on");
  if (tab === "all") {
    renderMandirGrid(currentMandirPosts);
  } else if (tab === "video") {
    const videoPosts = currentMandirPosts.filter(p => p.mediaType === "video" || p.video);
    if (videoPosts.length === 0) {
      document.getElementById("mcPostGrid").innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--t3)"><div style="font-size:32px;margin-bottom:8px">🎬</div>No videos yet</div>';
    } else {
      renderMandirGrid(videoPosts);
    }
  } else if (tab === "tagged") {
    document.getElementById("mcPostGrid").innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--t3)"><div style="font-size:32px;margin-bottom:8px">👤</div>Tagged posts coming soon</div>';
  }
}

function openMandirCompose() {
  const storedUser = API.getStoredUser();
  if (!storedUser || storedUser.mandirId !== currentMandirSlug) {
    MC.error("You can only post in your assigned mandir community.");
    return;
  }
  const config = MANDIR_CONFIG[currentMandirSlug];
  document.getElementById("mandirCompTitle").textContent = `New Post — ${config?.name || 'Community'}`;
  document.getElementById("mandirCompText").value = "";
  removeMandirCompMedia();
  openOvl("mandirCompOvl");
}

let mandirCompMediaFile = null;
let mandirCompMediaType = null;

function handleMandirCompMedia(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  const maxSize = type === "video" ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxSize) {
    MC.error(`File too large. Max ${type === "video" ? "50MB" : "10MB"}.`);
    event.target.value = "";
    return;
  }
  removeMandirCompMedia();
  mandirCompMediaFile = file;
  mandirCompMediaType = type;
  if (type === "image") {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById("mandirCompImg").src = e.target.result;
      document.getElementById("mandirCompImgPreview").classList.remove("hide");
    };
    reader.readAsDataURL(file);
  } else {
    const vidEl = document.getElementById("mandirCompVid");
    vidEl.src = URL.createObjectURL(file);
    document.getElementById("mandirCompVidPreview").classList.remove("hide");
  }
}

function removeMandirCompMedia() {
  mandirCompMediaFile = null;
  mandirCompMediaType = null;
  mandirCompImgData = null;
  document.getElementById("mandirCompImgPreview").classList.add("hide");
  document.getElementById("mandirCompImg").src = "";
  const vidEl = document.getElementById("mandirCompVid");
  if (vidEl && vidEl.src) { try { URL.revokeObjectURL(vidEl.src); } catch (e) { } vidEl.src = ""; }
  document.getElementById("mandirCompVidPreview").classList.add("hide");
  document.querySelectorAll("#mandirCompOvl input[type=file]").forEach(inp => { inp.value = ""; });
}

async function submitMandirPost() {
  const text = (document.getElementById("mandirCompText")?.value || "").trim();
  if (!text && !mandirCompMediaFile) {
    MC.error("Please write something or add media.");
    return;
  }
  const btn = document.getElementById("mandirPostBtn");
  const progress = document.getElementById("mandirUploadProgress");
  btn.disabled = true;
  btn.textContent = "Posting...";
  try {
    let imageUrl = null;
    let videoUrl = null;
    if (mandirCompMediaFile) {
      progress.classList.remove("hide");
      progress.textContent = "Uploading " + mandirCompMediaType + "...";
      try {
        if (mandirCompMediaType === "video") {
          const uploadResult = await API.uploadFile(mandirCompMediaFile);
          videoUrl = uploadResult.url;
        } else {
          // For images, read as base64 and use uploadBase64 (more reliable)
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(mandirCompMediaFile);
          });
          const uploadResult = await API.uploadBase64(base64Data, "tirth-sutra/mandir");
          imageUrl = uploadResult.url;
        }
      } catch (e) {
        console.error("Upload error:", e);
        MC.error("Media upload failed. Please try again.");
        return;
      } finally {
        progress.classList.add("hide");
      }
    }
    const newPost = await API.createMandirPost(currentMandirSlug, text, imageUrl, videoUrl);
    currentMandirPosts.unshift(newPost);
    renderMandirGrid(currentMandirPosts);
    document.getElementById("mcPostCount").textContent = currentMandirPosts.length;
    closeOvl("mandirCompOvl");
    MC.success("Post published! 🙏");
  } catch (err) {
    MC.error(err.message || "Failed to create post");
  } finally {
    btn.disabled = false;
    btn.textContent = "Post 🙏";
  }
}

/* ── SHORTS / REELS VIEWER ── */
let shortsVideoPosts = [];
let shortsCurrentIdx = 0;
let shortsMuted = true;

function openMandirShorts(gridIdx) {
  shortsVideoPosts = currentMandirPosts.filter(p => p.video || p.mediaType === "video");
  if (shortsVideoPosts.length === 0) { MC.info("No videos available"); return; }
  const clickedPost = currentMandirPosts[gridIdx];
  shortsCurrentIdx = shortsVideoPosts.findIndex(p => p.id === clickedPost?.id);
  if (shortsCurrentIdx < 0) shortsCurrentIdx = 0;
  shortsMuted = true;
  document.getElementById("mcShortsOvl").classList.remove("hide");
  document.body.style.overflow = "hidden";
  renderCurrentShort();
}

function closeMandirShorts() {
  document.getElementById("mcShortsOvl").classList.add("hide");
  document.body.style.overflow = "";
  document.querySelectorAll("#mcShortsContainer video").forEach(v => { v.pause(); v.src = ""; });
}

function renderCurrentShort() {
  const p = shortsVideoPosts[shortsCurrentIdx];
  if (!p) return;
  const container = document.getElementById("mcShortsContainer");
  container.innerHTML = `<video id="mcShortsVideo" src="${p.video}" ${shortsMuted ? 'muted' : ''} autoplay loop playsinline webkit-playsinline class="mc-shorts-video" onclick="toggleShortsPlayPause()"></video>`;
  const vid = document.getElementById("mcShortsVideo");
  if (vid) vid.play().catch(() => { });
  const u = p.user || {};
  document.getElementById("mcShortsInfo").innerHTML = `
    <div class="mc-shorts-user"><strong>@${u.handle || "user"}</strong>${u.verified ? ' 🔱' : ''}</div>
    ${p.txt ? `<div class="mc-shorts-caption">${esc(p.txt).substring(0, 150)}</div>` : ''}
  `;
  document.getElementById("mcShortsLikeCount").textContent = p.likes ? p.likes.length : 0;
  document.getElementById("mcShortsCommentCount").textContent = p.cmts ? p.cmts.length : 0;
  document.getElementById("mcShortsMute").textContent = shortsMuted ? "🔇" : "🔊";
  document.getElementById("mcShortsPrev").style.opacity = shortsCurrentIdx > 0 ? "1" : "0.3";
  document.getElementById("mcShortsNext").style.opacity = shortsCurrentIdx < shortsVideoPosts.length - 1 ? "1" : "0.3";
}

function toggleShortsPlayPause() {
  const vid = document.getElementById("mcShortsVideo");
  if (!vid) return;
  if (vid.paused) vid.play().catch(() => { });
  else vid.pause();
}

function toggleShortsMute() {
  shortsMuted = !shortsMuted;
  const vid = document.getElementById("mcShortsVideo");
  if (vid) vid.muted = shortsMuted;
  document.getElementById("mcShortsMute").textContent = shortsMuted ? "🔇" : "🔊";
}

function navigateShorts(direction) {
  const newIdx = shortsCurrentIdx + direction;
  if (newIdx < 0 || newIdx >= shortsVideoPosts.length) return;
  const vid = document.getElementById("mcShortsVideo");
  if (vid) vid.pause();
  shortsCurrentIdx = newIdx;
  renderCurrentShort();
}

async function likeShortsPost() {
  if (!API.getToken()) { openOvl("authOvl"); return; }
  const p = shortsVideoPosts[shortsCurrentIdx];
  if (!p) return;
  try {
    const result = await API.toggleMandirLike(currentMandirSlug, p.id);
    p.likes = result.likes;
    document.getElementById("mcShortsLikeCount").textContent = p.likes.length;
    const mainIdx = currentMandirPosts.findIndex(mp => mp.id === p.id);
    if (mainIdx >= 0) currentMandirPosts[mainIdx].likes = result.likes;
  } catch (err) { MC.error("Failed to like"); }
}

function commentShortsPost() {
  const p = shortsVideoPosts[shortsCurrentIdx];
  if (!p) return;
  const mainIdx = currentMandirPosts.findIndex(mp => mp.id === p.id);
  closeMandirShorts();
  if (mainIdx >= 0) {
    const u = p.user || {};
    const ini = getIni(u.name || "U");
    const avatarHtml = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
    let commentsHtml = (p.cmts || []).map(c => {
      const cu = c.user || {};
      return `<div style="display:flex;gap:8px;padding:8px 0;border-top:1px solid var(--bd)"><div class="av av28">${cu.avatar ? `<img src="${cu.avatar}">` : (getIni(cu.name || "U"))}</div><div style="flex:1"><strong style="font-size:13px">${cu.name || 'User'}</strong> <span style="font-size:12px;color:var(--t3)">${c.t}</span><div style="font-size:13px;margin-top:2px">${esc(c.txt)}</div></div></div>`;
    }).join("");
    document.getElementById("mandirPostDetail").innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><div class="av av40">${avatarHtml}</div><div><strong>${u.name || 'Unknown'}</strong>${u.verified ? ' 🔱' : ''}<div style="font-size:12px;color:var(--t3)">@${u.handle || 'user'} · ${p.t}</div></div></div>
      ${p.txt ? `<div style="font-size:15px;line-height:1.5;margin-bottom:12px;white-space:pre-wrap">${esc(p.txt)}</div>` : ''}
      <video src="${p.video}" controls playsinline style="width:100%;border-radius:10px;margin-bottom:12px;max-height:400px"></video>
      <div style="display:flex;gap:16px;padding:10px 0;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd)"><button class="disc-btn" onclick="toggleMandirPostLike('${p.id}', ${mainIdx})">❤ ${p.likes.length}</button><button class="disc-btn">💬 ${p.cmts ? p.cmts.length : 0}</button></div>
      ${commentsHtml}
      <div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="mcCommentInput" placeholder="Add a comment..." style="flex:1;padding:8px 12px;border-radius:20px;border:1px solid var(--bd);background:var(--bg2);color:var(--t1);font-size:13px"><button class="btn btn-p btn-sm" onclick="addMandirPostComment('${p.id}', ${mainIdx})">Post</button></div>
    `;
    openOvl("mandirPostOvl");
  }
}

// Touch swipe for shorts
(function () {
  let touchStartY = 0;
  document.addEventListener("touchstart", (e) => {
    if (!document.getElementById("mcShortsOvl")?.classList.contains("hide")) touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (document.getElementById("mcShortsOvl")?.classList.contains("hide")) return;
    const diff = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(diff) > 60) navigateShorts(diff > 0 ? 1 : -1);
  }, { passive: true });
})();

/* ── VIDEO PAGE ── */
function renderVideoPage() {
  renderVidStories();
  renderLiveSection();
  renderVidFeed();
}
function renderVidStories() {
  const row = document.getElementById("vidStoriesRow");
  if (!row) return;
  const stories = Store.g("vidStories", SEED_VID_STORIES);
  const seen = Store.g("vidStoriesSeen", []);
  let h = `<div class="add-story-btn" onclick="auth(()=>openOvl('addStoryModal'))"><div class="add-story-ring"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div><div class="s-lbl">Add Story</div></div>`;
  stories.forEach((s, i) => {
    const u = getUser(s.uid) || { name: "Unknown" };
    const ini = getIni(u.name);
    const isSeen = seen.includes(s.id);
    h += `<div class="story" onclick="viewVidStory(${i})"><div class="s-ring${isSeen ? " seen" : ""}"><div class="s-inner">${s.src && s.type === "video" ? `<video src="${s.src}" muted>` : s.src && s.type === "image" ? `<img src="${s.src}" alt="">` : s.emo || ini}</div></div><div class="s-lbl">${u.name.split(" ")[0]}</div></div>`;
  });
  row.innerHTML = h;
}
function viewVidStory(i) {
  const stories = Store.g("vidStories", SEED_VID_STORIES);
  showSV(stories, i);
}
function renderLiveSection() {
  const c = document.getElementById("liveScroll");
  const wrap = document.getElementById("liveSectionWrap");
  if (!c) return;
  const lives = getLiveStreams();
  if (!lives.length) {
    if (wrap) wrap.style.display = "none";
    return;
  }
  if (wrap) wrap.style.display = "";
  c.innerHTML = lives
    .map((l) => {
      const u = getUser(l.uid) || { name: "Unknown" };
      return `<div class="live-card" onclick="playLive('${l.id}')"><div class="live-card-thumb"><video src="${l.src}" muted loop playsinline onmouseenter="this.play().catch(()=>{})" onmouseleave="this.pause()" style="width:100%;height:100%;object-fit:cover"></video><div class="live-overlay"><span class="live-badge">● LIVE</span></div></div><div class="live-card-info"><div class="live-card-title">${esc(l.title)}</div><div class="live-card-channel">${u.name}</div><div class="live-viewers">👁 ${fmtV(l.viewers)} watching · ${l.started}</div></div></div>`;
    })
    .join("");
}
function playLive(id) {
  const l = getLiveStreams().find((x) => x.id === id);
  if (!l) return;
  const u = getUser(l.uid) || { name: "Unknown" };
  const c = document.getElementById("pdContent");
  if (!c) return;
  c.innerHTML = `<div style="background:#000"><video src="${l.src}" controls autoplay playsinline style="width:100%;max-height:400px;object-fit:contain"></video></div><div style="padding:14px 16px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="live-badge">● LIVE</span><span style="font-size:15px;font-weight:600">${esc(l.title)}</span></div><div style="font-size:13px;color:var(--t3)">${u.name} · 👁 ${fmtV(l.viewers)} watching</div></div>`;
  openOvl("pdOvl");
}
function setVidCat(cat, el) {
  curVidCat = cat;
  document
    .querySelectorAll(".cat-chip")
    .forEach((c) => c.classList.remove("on"));
  if (el) el.classList.add("on");
  renderVidFeed();
}
function setVidTab(tab, el) {
  curVidTab = tab;
  document
    .querySelectorAll(".vid-tab")
    .forEach((t) => t.classList.remove("on"));
  if (el) el.classList.add("on");
  renderVidFeed();
}
function renderVidFeed() {
  const c = document.getElementById("vidFeed");
  if (!c) return;
  let vids = getVideos().sort((a, b) => b.ts - a.ts);
  if (curVidCat !== "All") vids = vids.filter((v) => v.cat === curVidCat);
  if (curVidTab === "trending")
    vids = [...vids].sort(
      (a, b) => b.likes.length + b.views - (a.likes.length + a.views),
    );
  if (curVidTab === "uploads") {
    if (!CU) {
      c.innerHTML = `<div class="empty"><div class="empty-ico">📹</div><div class="empty-ttl">Sign in to see your uploads</div><button class="btn btn-p" style="margin-top:14px" onclick="openOvl('authOvl')">Sign In</button></div>`;
      return;
    }
    vids = vids.filter((v) => v.uid === CU.id);
  }
  if (!vids.length) {
    c.innerHTML = `<div class="empty"><div class="empty-ico">🎬</div><div class="empty-ttl">No videos yet</div><div class="empty-sub">Upload your first video!</div><button class="btn btn-p" style="margin-top:14px" onclick="auth(()=>openOvl('uploadVidModal'))">Upload Video</button></div>`;
    return;
  }
  c.innerHTML = vids.map((v) => mkVidCard(v)).join("");
}
function mkVidCard(v) {
  const u = getUser(v.uid) || {
    name: "Unknown",
    handle: "unknown",
    verified: false,
  };
  const ini = getIni(u.name);
  const avH = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
  const liked = CU && (v.likes || []).includes(CU.id);
  const cmts = v.cmts || [];
  return `<div class="vid-card" id="vc_${v.id}"><div class="vid-card-thumb"><video src="${v.src}" controls preload="metadata" playsinline style="width:100%;max-height:340px;object-fit:contain;background:#000" onplay="trackVidView('${v.id}')" onerror="this.style.background='#1a1a1a'"></video><div class="vid-overlay"><span class="vid-duration">${v.dur || "--:--"}</span></div></div><div class="vid-card-body"><div class="vid-card-meta"><div class="av av40" onclick="vpro('${u.id}')" style="cursor:pointer">${avH}</div><div class="vid-card-info"><div class="vid-card-title">${esc(v.title)}</div><div class="vid-card-channel" onclick="vpro('${u.id}')">${u.name}${u.verified ? " 🔱" : ""}</div><div class="vid-card-stats">${fmtV(v.views)} views · ${v.cat}</div></div><div class="more-wrap"><button class="sb" style="width:26px;height:26px;border-radius:6px" onclick="toggleVidMore('${v.id}',event)"><svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button><div class="more-menu" id="vm_${v.id}">${CU && v.uid === CU.id ? `<button class="mi red" onclick="deleteVid('${v.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete</button>` : ""}<button class="mi" onclick="shareVid('${v.id}')"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share</button></div></div></div></div><div class="vid-card-actions"><button class="va${liked ? " vliked" : ""}" onclick="toggleVidLike('${v.id}',this)"><svg viewBox="0 0 24 24" ${liked ? 'style="fill:#e53935;stroke:#e53935"' : ""}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span id="vlc_${v.id}">${(v.likes || []).length}</span></button><button class="va" onclick="toggleVCmts('${v.id}')"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${cmts.length}</button><button class="va" onclick="shareVid('${v.id}')"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share</button></div><div class="vcmts" id="vcm_${v.id}">${cmts
    .map((cm) => {
      const cu = getUser(cm.uid);
      return `<div class="vcmt">${avHTML(cm.uid, "av28")}<div class="vcmt-body" style="margin-left:8px"><span class="vcmt-name">${cu?.name || "User"}</span><br>${esc(cm.txt)}</div></div>`;
    })
    .join(
      "",
    )}<div class="cmt-row" style="margin-top:10px">${avHTML(CU ? CU.id : "u1", "av28")}<input class="cmt-in" id="vci_${v.id}" placeholder="Add a comment…" onkeydown="if(event.key==='Enter'){event.preventDefault();submitVidCmt('${v.id}')}"><button class="btn btn-p btn-sm" onclick="submitVidCmt('${v.id}')">Post</button></div></div></div>`;
}
function toggleVidLike(id, btn) {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const v = getVideo(id);
  if (!v) return;
  const likes = v.likes || [];
  const i = likes.indexOf(CU.id);
  if (i > -1) likes.splice(i, 1);
  else likes.push(CU.id);
  saveVideo(id, { likes });
  const liked = likes.includes(CU.id);
  if (btn) {
    btn.className = `va${liked ? " vliked" : ""}`;
    const sv = btn.querySelector("svg");
    if (sv) {
      sv.style.fill = liked ? "#e53935" : "";
      sv.style.stroke = liked ? "#e53935" : "";
    }
  }
  const sp = document.getElementById("vlc_" + id);
  if (sp) sp.textContent = likes.length;
}
function toggleVCmts(id) {
  const el = document.getElementById("vcm_" + id);
  if (el) el.style.display = el.style.display === "block" ? "none" : "block";
}
function submitVidCmt(id) {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const inp = document.getElementById("vci_" + id);
  const text = inp?.value?.trim() || "";
  if (!text) return;
  const v = getVideo(id);
  if (!v) return;
  const cmts = v.cmts || [];
  cmts.push({ uid: CU.id, txt: text, t: "Just now" });
  saveVideo(id, { cmts });
  const vcm = document.getElementById("vcm_" + id);
  if (vcm) {
    const d = document.createElement("div");
    d.className = "vcmt";
    d.innerHTML = `${avHTML(CU.id, "av28")}<div class="vcmt-body" style="margin-left:8px"><span class="vcmt-name">${CU.name}</span><br>${esc(text)}</div>`;
    vcm.insertBefore(d, vcm.lastElementChild);
  }
  if (inp) inp.value = "";
  MC.success("Comment posted 🙏");
}
function trackVidView(id) {
  const v = getVideo(id);
  if (!v) return;
  saveVideo(id, { views: (v.views || 0) + 1 });
}
function toggleVidMore(id, e) {
  if (e) e.stopPropagation();
  document.querySelectorAll(".more-menu").forEach((m) => {
    if (m.id !== "vm_" + id) m.classList.remove("show");
  });
  const m = document.getElementById("vm_" + id);
  if (m) m.classList.toggle("show");
}
function deleteVid(id) {
  if (!CU) return;
  const vids = getVideos().filter((v) => !(v.id === id && v.uid === CU.id));
  Store.s("videos", vids);
  closeMore();
  const el = document.getElementById("vc_" + id);
  if (el) el.remove();
  MC.info("Video deleted");
}
function shareVid(id) {
  closeMore();
  activeSH = id;
  document.getElementById("shareSheet")?.classList.add("show");
  const o = document.getElementById("shareOvl");
  if (o) o.style.display = "block";
}

/* ── VIDEO UPLOAD ── */
function handleVidFile(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  vidUploadFile = f;
  const url = URL.createObjectURL(f);
  const prev = document.getElementById("vidUploadPreview");
  const vid = document.getElementById("vidPrevEl");
  if (vid) vid.src = url;
  if (prev) prev.classList.remove("hide");
  document.getElementById("vidUploadZone").style.display = "none";
  MC.info("Video selected! Fill in details and click Publish.");
}
function handleVidDrop(e) {
  e.preventDefault();
  document.getElementById("vidUploadZone")?.classList.remove("drag-over");
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith("video/"))
    handleVidFile({ target: { files: [f] } });
}
function resetVidUpload() {
  vidUploadFile = null;
  document.getElementById("vidUploadPreview")?.classList.add("hide");
  const z = document.getElementById("vidUploadZone");
  if (z) z.style.display = "";
  const v = document.getElementById("vidPrevEl");
  if (v) v.src = "";
}
function handleThumb(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  thumbFile = f;
  const r = new FileReader();
  r.onload = (ev) => {
    const img = document.getElementById("thumbPrevImg");
    if (img) {
      img.src = ev.target.result;
      img.style.display = "block";
    }
    document.getElementById("thumbPrevLabel")?.classList.add("hide");
  };
  r.readAsDataURL(f);
}
async function submitVideoUpload() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const title = document.getElementById("vidTitle")?.value?.trim() || "";
  if (!title) {
    MC.warn("Please enter a video title");
    return;
  }
  if (!vidUploadFile) {
    MC.warn("Please select a video file");
    return;
  }
  const id = "v" + Date.now();
  let blobUrl = null;
  try {
    await saveVidBlob(id, vidUploadFile);
    blobUrl = URL.createObjectURL(vidUploadFile);
  } catch {
    blobUrl = URL.createObjectURL(vidUploadFile);
  }
  let thumbSrc = null;
  if (thumbFile) {
    thumbSrc = await new Promise((res) => {
      const r = new FileReader();
      r.onload = (e) => res(e.target.result);
      r.readAsDataURL(thumbFile);
    });
  }
  const vids = getVideos();
  vids.unshift({
    id,
    uid: CU.id,
    title,
    desc: document.getElementById("vidDesc")?.value?.trim() || "",
    cat: document.getElementById("vidCat")?.value || "Other",
    src: blobUrl,
    thumb: thumbSrc,
    likes: [],
    cmts: [],
    views: 0,
    dur: "--:--",
    ts: Date.now(),
    live: false,
  });
  Store.s("videos", vids);
  vidUploadFile = null;
  thumbFile = null;
  ["vidTitle", "vidDesc"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  resetVidUpload();
  const tpi = document.getElementById("thumbPrevImg");
  if (tpi) tpi.style.display = "none";
  document.getElementById("thumbPrevLabel")?.classList.remove("hide");
  closeOvl("uploadVidModal");
  renderVidFeed();
  MC.success("Video published! 🎬 Jai Shri Ram");
}

/* ── STORY UPLOAD ── */
function handleStoryFile(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  storyUploadFile = f;
  const url = URL.createObjectURL(f);
  document.getElementById("storyPrev")?.classList.remove("hide");
  if (f.type.startsWith("video/")) {
    const img = document.getElementById("storyPrevImg");
    if (img) img.style.display = "none";
    const vid = document.getElementById("storyPrevVid");
    if (vid) {
      vid.src = url;
      vid.style.display = "block";
    }
  } else {
    const vid = document.getElementById("storyPrevVid");
    if (vid) vid.style.display = "none";
    const img = document.getElementById("storyPrevImg");
    if (img) {
      img.src = url;
      img.style.display = "block";
    }
  }
}
function submitStory() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  if (!storyUploadFile) {
    MC.warn("Please select a photo or video");
    return;
  }
  const url = URL.createObjectURL(storyUploadFile);
  const isVid = storyUploadFile.type.startsWith("video/");
  const stories = Store.g("vidStories", SEED_VID_STORIES);
  stories.unshift({
    id: "vs" + Date.now(),
    uid: CU.id,
    cap: document.getElementById("storyCap")?.value?.trim() || "",
    t: "Just now",
    type: isVid ? "video" : "image",
    src: url,
    emo: "🕉",
  });
  Store.s("vidStories", stories);
  storyUploadFile = null;
  const sc = document.getElementById("storyCap");
  if (sc) sc.value = "";
  document.getElementById("storyPrev")?.classList.add("hide");
  const spi = document.getElementById("storyPrevImg");
  if (spi) {
    spi.style.display = "none";
    spi.src = "";
  }
  const spv = document.getElementById("storyPrevVid");
  if (spv) {
    spv.style.display = "none";
    spv.src = "";
  }
  closeOvl("addStoryModal");
  renderVidStories();
  MC.success("Story shared! 🌟");
}

/* ── GO LIVE ── */
function handleLiveFile(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  liveFile = f;
  const url = URL.createObjectURL(f);
  const vid = document.getElementById("livePreviewVid");
  if (vid) {
    vid.src = url;
    vid.style.display = "block";
    vid.play().catch(() => { });
  }
  const ph = document.getElementById("livePreviewPlaceholder");
  if (ph) ph.style.display = "none";
}
function startLive() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const title = document.getElementById("liveTitle")?.value?.trim() || "";
  if (!title) {
    MC.warn("Please enter a stream title");
    return;
  }
  const viewers =
    parseInt(document.getElementById("liveViewers")?.value || "127") || 127;
  const src = liveFile
    ? URL.createObjectURL(liveFile)
    : "https://www.w3schools.com/html/mov_bbb.mp4";
  const lives = getLiveStreams();
  lives.unshift({
    id: "l" + Date.now(),
    uid: CU.id,
    title,
    src,
    viewers,
    started: "Just now",
  });
  Store.s("liveStreams", lives);
  liveFile = null;
  const lt = document.getElementById("liveTitle");
  if (lt) lt.value = "";
  const lv = document.getElementById("liveViewers");
  if (lv) lv.value = "127";
  const lvid = document.getElementById("livePreviewVid");
  if (lvid) {
    lvid.style.display = "none";
    lvid.src = "";
  }
  const ph = document.getElementById("livePreviewPlaceholder");
  if (ph) ph.style.display = "";
  closeOvl("goLiveModal");
  renderLiveSection();
  MC.success("You are now LIVE! 🔴 Jai Shri Ram");
}

/* ── PROFILE ── */
function vpro(uid) {
  curProfId = uid;
  gp("profile");
}
function renderProfile(uid) {
  const u = getUser(uid) || SEED_USERS[0];
  curProfId = u.id;
  const isOwn = CU && CU.id === u.id;
  const isFollowing = CU && (CU.following || []).includes(u.id);
  const ini = getIni(u.name);
  const bi = document.getElementById("prBannerImg");
  if (bi) {
    bi.src = u.banner || "";
    bi.style.display = u.banner ? "block" : "none";
  }
  const prAv = document.getElementById("prAv");
  if (prAv) prAv.innerHTML = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
  const prActions = document.getElementById("prActions");
  if (prActions)
    prActions.innerHTML = isOwn
      ? `<button class="btn btn-w" onclick="openEP()">Edit Profile</button>${CU ? `<button class="btn btn-w btn-sm" onclick="logout()" style="margin-left:4px">Sign Out</button>` : ""}`
      : `<button class="sb" style="width:36px;height:36px" onclick="openDM('${u.id}')"><svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></button><button class="btn ${isFollowing ? "btn-w" : "btn-p"}" id="pfBtn" onclick="toggleFollow('${u.id}',this)">${isFollowing ? "Following" : "Follow"}</button>`;
  const prName = document.getElementById("prName");
  if (prName)
    prName.innerHTML =
      u.name +
      (u.verified
        ? ' <span class="vbadge"><svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></span>'
        : "");
  const prHdl = document.getElementById("prHdl");
  if (prHdl) prHdl.textContent = "@" + u.handle;
  const prBio = document.getElementById("prBio");
  if (prBio) prBio.textContent = u.bio || "";
  let meta = "";
  if (u.location)
    meta += `<span><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${u.location}</span>`;
  if (u.joined)
    meta += `<span><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Joined ${u.joined}</span>`;
  const prMeta = document.getElementById("prMeta");
  if (prMeta) prMeta.innerHTML = meta;
  const myPosts = getPosts().filter((p) => p.uid === u.id);
  const phName = document.getElementById("phName");
  if (phName) phName.textContent = u.name;
  const phPosts = document.getElementById("phPosts");
  if (phPosts) phPosts.textContent = myPosts.length + " posts";
  const fol = u.followers || [],
    fwg = u.following || [];
  const prStats = document.getElementById("prStats");
  if (prStats)
    prStats.innerHTML = `<div class="ps" onclick="openFolModal('${u.id}','following')"><strong>${fwg.length}</strong> <span>Following</span></div><div class="ps" onclick="openFolModal('${u.id}','followers')"><strong>${fol.length}</strong> <span>Followers</span></div><div class="ps"><strong>${myPosts.length}</strong> <span>Posts</span></div>`;
  renderPTab(u.id, "posts");
}
function setPTab(tab, el) {
  document
    .querySelectorAll("#prTabs .tab")
    .forEach((t) => t.classList.remove("on"));
  if (el) el.classList.add("on");
  renderPTab(curProfId, tab);
}
function renderPTab(uid, tab) {
  const c = document.getElementById("prPosts");
  if (!c) return;
  let posts = getPosts()
    .filter((p) => p.uid === uid)
    .sort((a, b) => b.ts - a.ts);
  if (tab === "likes")
    posts = getPosts().filter((p) => (p.likes || []).includes(uid));
  if (tab === "media") posts = posts.filter((p) => p.img);
  if (tab === "replies")
    posts = getPosts().filter((p) =>
      (p.cmts || []).some((cm) => cm.uid === uid),
    );
  if (!posts.length) {
    c.innerHTML = `<div class="empty"><div class="empty-ico">🕉</div><div class="empty-ttl">No ${tab} yet</div></div>`;
    return;
  }
  if (tab === "media") {
    c.innerHTML = `<div class="media-grid">${posts.map((p) => `<div class="media-cell" onclick="openPD('${p.id}')"><img src="${p.img}" alt="" loading="lazy"></div>`).join("")}</div>`;
    return;
  }
  c.innerHTML = posts.map((p) => mkPost(p)).join("");
}
function toggleFollow(uid, btn) {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  if (uid === CU.id) return;
  const fol = [...(CU.following || [])];
  const i = fol.indexOf(uid);
  if (i > -1) fol.splice(i, 1);
  else {
    fol.push(uid);
    addNotif("follow", CU.id, null, uid);
  }
  updateUser(CU.id, { following: fol });
  const tu = getUser(uid);
  if (tu) {
    const fs = [...(tu.followers || [])];
    const fi = fs.indexOf(CU.id);
    if (i > -1) {
      if (fi > -1) fs.splice(fi, 1);
    } else if (!fs.includes(CU.id)) fs.push(CU.id);
    updateUser(uid, { followers: fs });
  }
  const now = fol.includes(uid);
  if (btn) {
    btn.textContent = now ? "Following" : "Follow";
    btn.className = `btn btn-sm ${now ? "btn-w" : "btn-p"}`;
  }
  MC.info(now ? `Following @${tu?.handle || "user"} 🙏` : "Unfollowed");
  renderWidgets();
  if (curProfId === uid) renderProfile(uid);
}
function openFolModal(uid, type) {
  const u = getUser(uid);
  if (!u) return;
  const ft = document.getElementById("folTtl");
  if (ft) ft.textContent = type === "followers" ? "Followers" : "Following";
  const ids = type === "followers" ? u.followers || [] : u.following || [];
  const fc = document.getElementById("folContent");
  if (!fc) return;
  fc.innerHTML = !ids.length
    ? `<div class="empty"><div class="empty-sub">No ${type} yet</div></div>`
    : ids
      .map((id) => {
        const fu = getUser(id);
        if (!fu) return "";
        return `<div class="fol-item">${avHTML(id, "av36")}<div style="flex:1;min-width:0;margin-left:10px"><div style="font-weight:600;font-size:14px;cursor:pointer" onclick="vpro('${fu.id}')">${fu.name}</div><div style="font-size:12px;color:var(--t3)">@${fu.handle}</div></div><button class="btn btn-sm ${CU && (CU.following || []).includes(id) ? "btn-o" : "btn-p"}" onclick="toggleFollow('${id}',this)">${CU && (CU.following || []).includes(id) ? "Following" : "Follow"}</button></div>`;
      })
      .join("");
  openOvl("folOvl");
}
function openEP() {
  if (!CU) return;
  const epNm = document.getElementById("epNm");
  const epBio = document.getElementById("epBio");
  const epLoc = document.getElementById("epLoc");
  const epWeb = document.getElementById("epWeb");
  const epAv = document.getElementById("epAv");
  const epBanner = document.getElementById("epBanner");
  if (epNm) epNm.value = CU.name || "";
  if (epBio) epBio.value = CU.bio || "";
  if (epLoc) epLoc.value = CU.location || "";
  if (epWeb) epWeb.value = CU.website || "";
  const ini = getIni(CU.name);
  if (epAv)
    epAv.innerHTML = CU.avatar ? `<img src="${CU.avatar}" alt="">` : ini;
  if (epBanner) {
    epBanner.src = CU.banner || "";
    epBanner.style.display = CU.banner ? "block" : "none";
  }
  openOvl("epOvl");
}
function saveEP() {
  if (!CU) return;
  const nm = document.getElementById("epNm")?.value?.trim() || "";
  if (!nm) {
    MC.error("Name is required");
    return;
  }
  updateUser(CU.id, {
    name: nm,
    bio: document.getElementById("epBio")?.value?.trim() || "",
    location: document.getElementById("epLoc")?.value?.trim() || "",
    website: document.getElementById("epWeb")?.value?.trim() || "",
  });
  closeOvl("epOvl");
  renderProfile(CU.id);
  syncAvatars();
  MC.success("Profile updated! 🙏");
}
function handleAvUp(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    const src = ev.target.result;
    const epAv = document.getElementById("epAv");
    if (epAv) epAv.innerHTML = `<img src="${src}" alt="">`;
    updateUser(CU.id, { avatar: src });
    syncAvatars();
  };
  r.readAsDataURL(f);
}
function handleBanner(e) {
  const f = e.target?.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    const src = ev.target.result;
    const bi = document.getElementById("epBanner");
    if (bi) {
      bi.src = src;
      bi.style.display = "block";
    }
    updateUser(CU.id, { banner: src });
  };
  r.readAsDataURL(f);
}
function syncAvatars() {
  if (!CU) return;
  const ini = getIni(CU.name);
  const h = CU.avatar ? `<img src="${CU.avatar}" alt="">` : ini;
  ["sbAv", "inlineAv", "compAv"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = h;
  });
}

/* ── NOTIFICATIONS ── */
function addNotif(type, from, pid, to) {
  if (!to || from === to) return;
  const notifs = Store.g("notifs", SEED_NOTIFS);
  const msgs = {
    like: "gave a Pranam to your post",
    comment: "commented on your post",
    repost: "reposted your post",
    follow: "started following you",
  };
  notifs.unshift({
    id: "n" + Date.now(),
    type,
    from,
    pid: pid || null,
    txt: msgs[type] || "interacted",
    t: "Just now",
    unread: true,
  });
  Store.s("notifs", notifs);
  const d = document.getElementById("ndot");
  if (d) d.style.display = "block";
  const bd = document.getElementById("bnNotifBadge");
  if (bd) bd.style.display = "block";
}
function renderNotifs(filter = "all") {
  const c = document.getElementById("notifsWrap");
  if (!c) return;
  let notifs = Store.g("notifs", SEED_NOTIFS);
  if (filter === "mentions")
    notifs = notifs.filter((n) => n.type === "comment");
  if (filter === "pranams") notifs = notifs.filter((n) => n.type === "like");
  const icons = { like: "❤️", comment: "💬", repost: "🔁", follow: "👤" };
  if (!notifs.length) {
    c.innerHTML = `<div class="empty"><div class="empty-ico">🔔</div><div class="empty-ttl">No notifications yet</div></div>`;
    return;
  }
  c.innerHTML = notifs
    .map((n) => {
      const u = getUser(n.from);
      const ini = getIni(u?.name || "U");
      const avH = u?.avatar ? `<img src="${u.avatar}" alt="">` : ini;
      return `<div class="notif${n.unread ? " unread" : ""}" onclick="handleNC('${n.pid || ""}','${n.from || ""}')"><div class="notif-ico" style="background:var(--a)">${icons[n.type] || "🔔"}</div><div style="display:flex;align-items:center;gap:8px;flex:1"><div class="av av36">${avH}</div><div><div class="notif-txt"><strong>${u?.name || "Someone"}</strong> ${n.txt}</div><div class="notif-tm">${n.t}</div></div></div></div>`;
    })
    .join("");
  const updated = Store.g("notifs", SEED_NOTIFS).map((n) => ({
    ...n,
    unread: false,
  }));
  Store.s("notifs", updated);
  const d = document.getElementById("ndot");
  if (d) d.style.display = "none";
  const bd = document.getElementById("bnNotifBadge");
  if (bd) bd.style.display = "none";
}
function handleNC(pid, from) {
  if (pid) openPD(pid);
  else if (from) vpro(from);
}
function markRead() {
  const n = Store.g("notifs", SEED_NOTIFS).map((x) => ({
    ...x,
    unread: false,
  }));
  Store.s("notifs", n);
  renderNotifs();
  MC.info("All marked as read ✓");
}
function setNTab(t, el) {
  document
    .querySelectorAll("#pgNotifs .tab")
    .forEach((x) => x.classList.remove("on"));
  if (el) el.classList.add("on");
  renderNotifs(t);
}

/* ── MESSAGES ── */
function renderConvs() {
  const cl = document.getElementById("convsList");
  const cv = document.getElementById("chatView");
  if (!cl) return;
  cl.style.display = "block";
  if (cv) cv.classList.add("hide");
  if (!CU) {
    cl.innerHTML = `<div class="empty"><div class="empty-ico">💬</div><div class="empty-ttl">Sign in to view messages</div><button class="btn btn-p" style="margin-top:12px" onclick="openOvl('authOvl')">Sign In</button></div>`;
    return;
  }
  const convs = Store.g("convs", SEED_CONVS);
  cl.innerHTML = convs
    .map((conv) => {
      const u = getUser(conv.uid);
      if (!u) return "";
      const ini = getIni(u.name);
      const avH = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
      const last = conv.msgs[conv.msgs.length - 1];
      return `<div class="conv" onclick="openChat('${conv.id}')"><div class="av av40">${avH}</div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between"><span class="conv-name">${u.name}</span><span class="conv-tm">${last?.t || ""}</span></div><div class="conv-prev">${esc(last?.txt || "Start a conversation")}</div></div></div>`;
    })
    .join("");
}
function filterConvs(q) {
  const convs = Store.g("convs", SEED_CONVS);
  const filtered = q
    ? convs.filter((c) => {
      const u = getUser(c.uid);
      return u && u.name.toLowerCase().includes(q.toLowerCase());
    })
    : convs;
  const cl = document.getElementById("convsList");
  if (!cl) return;
  cl.innerHTML = filtered
    .map((conv) => {
      const u = getUser(conv.uid);
      if (!u) return "";
      const ini = getIni(u.name);
      const avH = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
      const last = conv.msgs[conv.msgs.length - 1];
      return `<div class="conv" onclick="openChat('${conv.id}')"><div class="av av40">${avH}</div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between"><span class="conv-name">${u.name}</span><span class="conv-tm">${last?.t || ""}</span></div><div class="conv-prev">${esc(last?.txt || "")}</div></div></div>`;
    })
    .join("");
}
function openChat(id) {
  if (!auth(() => openChat(id))) return;
  const convs = Store.g("convs", SEED_CONVS);
  const conv = convs.find((c) => c.id === id);
  if (!conv) return;
  curChat = id;
  const u = getUser(conv.uid);
  if (!u) return;
  const cl = document.getElementById("convsList");
  const cv = document.getElementById("chatView");
  if (cl) cl.style.display = "none";
  if (cv) {
    cv.classList.remove("hide");
    cv.style.display = "flex";
  }
  const ini = getIni(u.name);
  const chatAv = document.getElementById("chatAv");
  const chatNm = document.getElementById("chatNm");
  if (chatAv)
    chatAv.innerHTML = u.avatar ? `<img src="${u.avatar}" alt="">` : ini;
  if (chatNm) chatNm.textContent = u.name;
  renderMsgs(conv.msgs);
}
function renderMsgs(msgs) {
  const c = document.getElementById("chatMsgs");
  if (!c) return;
  c.innerHTML = msgs
    .map(
      (m) =>
        `<div class="bubble ${m.from === "me" || m.from === CU?.id ? "mine" : "theirs"}">${esc(m.txt)}<div class="bubble-time">${m.t}</div></div>`,
    )
    .join("");
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight;
  });
}
function sendMsg() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const inp = document.getElementById("msgIn");
  const text = inp?.value?.trim() || "";
  if (!text) return;
  const convs = Store.g("convs", SEED_CONVS);
  const conv = convs.find((c) => c.id === curChat);
  if (!conv) return;
  conv.msgs.push({ from: "me", txt: text, t: "Just now" });
  Store.s("convs", convs);
  if (inp) inp.value = "";
  renderMsgs(conv.msgs);
  const replies = [
    "Jai Shri Ram! 🙏",
    "That sounds wonderful!",
    "Let me check.",
    "Namaste! 🕉",
    "May Mahadev bless you!",
  ];
  setTimeout(() => {
    conv.msgs.push({
      from: conv.uid,
      txt: replies[Math.floor(Math.random() * replies.length)],
      t: "Just now",
    });
    Store.s("convs", convs);
    renderMsgs(conv.msgs);
  }, 1200);
}
function backToConvs() {
  const cv = document.getElementById("chatView");
  const cl = document.getElementById("convsList");
  if (cv) cv.classList.add("hide");
  if (cl) cl.style.display = "block";
  curChat = null;
}
function openDM(uid) {
  if (!auth(() => openDM(uid))) return;
  const convs = Store.g("convs", SEED_CONVS);
  let c = convs.find((x) => x.uid === uid);
  if (!c) {
    c = { id: "cv" + Date.now(), uid, msgs: [] };
    convs.push(c);
    Store.s("convs", convs);
  }
  gp("messages");
  setTimeout(() => openChat(c.id), 80);
}

/* ── BOOKMARKS ── */
function renderBM() {
  const c = document.getElementById("bmPosts");
  const bmCnt = document.getElementById("bmCnt");
  if (!c) return;
  if (!CU) {
    c.innerHTML = `<div class="empty"><div class="empty-ico">🔖</div><div class="empty-ttl">Sign in to see bookmarks</div><button class="btn btn-p" style="margin-top:12px" onclick="openOvl('authOvl')">Sign In</button></div>`;
    if (bmCnt) bmCnt.textContent = "";
    return;
  }
  const bm = getPosts().filter((p) => (p.bm || []).includes(CU.id));
  if (bmCnt) bmCnt.textContent = bm.length + " saved posts";
  if (!bm.length) {
    c.innerHTML = `<div class="empty"><div class="empty-ico">🔖</div><div class="empty-ttl">No saved posts yet</div></div>`;
    return;
  }
  c.innerHTML = bm.map((p) => mkPost(p)).join("");
}

/* ── SEARCH ── */
function setSTab(t, el) {
  curSTabVal = t;
  document
    .querySelectorAll("#srchTabs .tab")
    .forEach((x) => x.classList.remove("on"));
  if (el) el.classList.add("on");
  doSearch(document.getElementById("srchIn")?.value || "");
}
function doSearch(q) {
  const c = document.getElementById("srchResults");
  if (!c) return;
  if (!q) {
    c.innerHTML = `<div style="padding:14px 16px"><h3 style="font-size:15px;font-weight:700;margin-bottom:10px">🔥 Trending Today</h3>${TRENDING.map((t) => `<div class="trend-item" onclick="searchTag('${t.tag}')"><div class="trend-cat">${t.cat}</div><div class="trend-name">${t.tag}</div><div class="trend-cnt">${t.cnt} posts</div></div>`).join("")}</div>`;
    return;
  }
  const ql = q.toLowerCase();
  if (curSTabVal === "people") {
    const users = getUsers().filter(
      (u) =>
        u.name.toLowerCase().includes(ql) ||
        u.handle.toLowerCase().includes(ql) ||
        (u.bio || "").toLowerCase().includes(ql),
    );
    c.innerHTML = !users.length
      ? `<div class="empty"><div class="empty-sub">No users found</div></div>`
      : users
        .map((u) => {
          const ini = getIni(u.name);
          return `<div class="s-result" onclick="vpro('${u.id}')"><div class="av av40">${u.avatar ? `<img src="${u.avatar}" alt="">` : ini}</div><div style="flex:1;min-width:0;margin-left:8px"><div class="who-name">${u.name}${u.verified ? " 🔱" : ""}</div><div class="who-hdl">@${u.handle}</div><div style="font-size:13px;color:var(--t2);margin-top:2px">${u.bio || ""}</div></div><button class="btn btn-sm ${CU && (CU.following || []).includes(u.id) ? "btn-o" : "btn-p"}" onclick="event.stopPropagation();toggleFollow('${u.id}',this)">${CU && (CU.following || []).includes(u.id) ? "Following" : "Follow"}</button></div>`;
        })
        .join("");
  }
  if (curSTabVal === "posts") {
    const posts = getPosts().filter((p) => p.txt.toLowerCase().includes(ql));
    c.innerHTML = !posts.length
      ? `<div class="empty"><div class="empty-sub">No posts found</div></div>`
      : posts.map((p) => mkPost(p)).join("");
  }
  if (curSTabVal === "tags") {
    const tags = TRENDING.filter((t) => t.tag.toLowerCase().includes(ql));
    c.innerHTML = `<div style="padding:14px 16px">${!tags.length ? `<div class="empty"><div class="empty-sub">No tags found</div></div>` : tags.map((t) => `<div class="trend-item" onclick="searchTag('${t.tag}')"><div class="trend-cat">${t.cat}</div><div class="trend-name">${t.tag}</div><div class="trend-cnt">${t.cnt} posts</div></div>`).join("")}</div>`;
  }
}
function searchTag(tag) {
  gp("search");
  const inp = document.getElementById("srchIn");
  if (inp) inp.value = tag;
  const pt = document.querySelector("#srchTabs .tab:nth-child(2)");
  if (pt) setSTab("posts", pt);
  doSearch(tag);
}

/* ── WIDGETS ── */
function renderWidgets() {
  const tw = document.getElementById("trendW");
  if (tw)
    tw.innerHTML = TRENDING.slice(0, 5)
      .map(
        (t) =>
          `<div class="trend-item" onclick="searchTag('${t.tag}')"><div class="trend-cat">${t.cat}</div><div class="trend-name">${t.tag}</div><div class="trend-cnt">${t.cnt} posts</div></div>`,
      )
      .join("");
  const wf = document.getElementById("wtfW");
  if (wf) {
    const fl = CU ? CU.following || [] : [];
    const sug = getUsers()
      .filter((u) => u.id !== CU?.id && !fl.includes(u.id))
      .slice(0, 3);
    wf.innerHTML = !sug.length
      ? `<div style="font-size:13px;color:var(--t3)">You're following everyone!</div>`
      : sug
        .map((u) => {
          const ini = getIni(u.name);
          return `<div class="who-item"><div class="av av36" onclick="vpro('${u.id}')" style="cursor:pointer">${u.avatar ? `<img src="${u.avatar}" alt="">` : ini}</div><div style="flex:1;min-width:0;margin-left:8px;cursor:pointer" onclick="vpro('${u.id}')"><div class="who-name">${u.name}${u.verified ? " 🔱" : ""}</div><div class="who-hdl">@${u.handle}</div></div><button class="btn btn-p btn-sm" onclick="toggleFollow('${u.id}',this)">Follow</button></div>`;
        })
        .join("");
  }
}

/* ── DARK MODE ── */
function toggleDark() {
  const isDark = document.documentElement.hasAttribute("data-dark");
  if (isDark) document.documentElement.removeAttribute("data-dark");
  else document.documentElement.setAttribute("data-dark", "");
  Store.s("theme", isDark ? "light" : "dark");
  const sunPath = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  const moonPath = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
  const np = isDark ? moonPath : sunPath;
  ["thIco", "dThemeIco"].forEach((id) => {
    const ico = document.getElementById(id);
    if (ico) ico.innerHTML = np;
  });
}

/* ── INIT UI ── */
function initUI() {
  if (CU) {
    const ini = getIni(CU.name);
    const h = CU.avatar ? `<img src="${CU.avatar}" alt="">` : ini;
    ["sbAv", "inlineAv", "compAv"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = h;
    });
    const sbN = document.getElementById("sbUserName");
    const sbH = document.getElementById("sbUserHandle");
    if (sbN) sbN.textContent = CU.name || "";
    if (sbH) sbH.textContent = "@" + (CU.handle || "");
  } else {
    const placeholder = `<svg style="width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    ["sbAv", "inlineAv", "compAv"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = placeholder;
    });
    const sbN = document.getElementById("sbUserName");
    const sbH = document.getElementById("sbUserHandle");
    if (sbN) sbN.textContent = "Guest";
    if (sbH) sbH.textContent = "@guest";
  }
  updateDrawer();
  updateNavAuthButtons();
}

/* ── BOOTSTRAP ── */
async function init() {
  // Step 1 — seed data immediately (no delay)
  seedData();

  // Step 2 — restore logged in user
  const saved = Store.g("currentUser");
  if (saved) {
    const users = getUsers();
    const found = users.find((u) => u.id === saved.id);
    if (found) {
      CU = found;
      Store.s("currentUser", found);
    } else {
      CU = null;
      Store.d("currentUser");
    }
  }

  // Step 3 — restore theme
  const theme = Store.g("theme", "light");
  if (theme === "dark") {
    document.documentElement.setAttribute("data-dark", "");
    const sunPath = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
    ["thIco", "dThemeIco"].forEach((id) => {
      const ico = document.getElementById(id);
      if (ico) ico.innerHTML = sunPath;
    });
  }

  // Step 4 — wire auth buttons
  const lb = document.getElementById("loginBtn");
  if (lb) lb.addEventListener("click", doLogin);
  const sb2 = document.getElementById("signupBtn");
  if (sb2) sb2.addEventListener("click", doSignup);
  document.getElementById("liPw")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
  document.getElementById("suPw")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSignup();
  });

  // Step 5 — render UI immediately
  initUI();
  renderFeed();
  renderStories();
  renderWidgets();

  // Step 6 — notification dots
  const notifs = Store.g("notifs", SEED_NOTIFS);
  if (notifs.some((n) => n.unread)) {
    const d = document.getElementById("ndot");
    if (d) d.style.display = "block";
    const bd = document.getElementById("bnNotifBadge");
    if (bd) bd.style.display = "block";
  }

  // Step 7 — IDB in background, never blocks render
  try {
    await openIDB();
  } catch { }
}

// Call init immediately when DOM is ready
window.addEventListener("DOMContentLoaded", init);

/* ============================================================
   BROWSER / PHONE BACK BUTTON HANDLER
   ============================================================ */
(function () {
  // Push a state so the browser has something to go "back" from
  function pushState(name) {
    history.pushState({ page: name }, "", "");
  }

  // On page load push initial state
  window.addEventListener("load", () => {
    history.replaceState({ page: "home" }, "", "");
  });

  // Every time gp() is called push a new state
  const _origGP = window.gp;
  window.gp = function (page) {
    _origGP(page);
    pushState(page);
  };

  // When user presses phone back button
  window.addEventListener("popstate", (e) => {
    // 1. If chat window is open on mobile → close it first
    const chatWin = document.getElementById("chatWindow");
    const isChatOpen =
      chatWin && !chatWin.classList.contains("hide") && window.innerWidth < 641;

    if (isChatOpen) {
      closeChatWindow();
      // Push state again so next back press goes to previous page
      history.pushState({ page: "chats" }, "", "");
      return;
    }

    // 2. If old Messages chat view is open → go back to convs list
    const oldChatView = document.getElementById("chatView");
    const isOldChatOpen =
      oldChatView && !oldChatView.classList.contains("hide");

    if (isOldChatOpen) {
      backToConvs();
      history.pushState({ page: "messages" }, "", "");
      return;
    }

    // 3. If any modal is open → close it
    const openModal = document.querySelector(".ovl.show");
    if (openModal) {
      openModal.classList.remove("show");
      history.pushState({ page: curPage }, "", "");
      return;
    }

    // 4. If story viewer is open → close it
    const sv = document.getElementById("sv");
    if (sv && sv.classList.contains("show")) {
      closeSV();
      history.pushState({ page: curPage }, "", "");
      return;
    }

    // 5. If not on home → go to home
    if (typeof curPage !== "undefined" && curPage !== "home") {
      _origGP("home");
      history.pushState({ page: "home" }, "", "");
      return;
    }

    // 6. Already on home → let browser handle (exit app)
    // Do nothing — default back behavior
  });
})();

/* ============================================================
   PULL TO REFRESH — mobile only
   ============================================================ */
(function () {
  // Only activate on touch devices
  if (!("ontouchstart" in window)) return;

  const THRESHOLD = 80; // px to pull before triggering refresh
  const MAX_PULL = 120; // max visual pull distance

  let startY = 0;
  let currentY = 0;
  let pulling = false;
  let refreshing = false;
  let startScrollY = 0;

  const indicator = document.getElementById("pullIndicator");
  const pullText = document.getElementById("pullText");

  if (!indicator || !pullText) return;

  /* ── helpers ── */
  function canPull() {
    // Only pull when page is scrolled to very top
    return window.scrollY <= 0;
  }

  function setState(state) {
    indicator.className = ""; // clear all state classes
    if (state) indicator.classList.add(state);
  }

  function showIndicator(progress) {
    // progress: 0–1
    const h = Math.min(progress * 60, 60);
    indicator.style.height = h + "px";

    const inner = indicator.querySelector(".pull-inner");
    if (inner) {
      inner.style.opacity = Math.min(progress * 2, 1);
      inner.style.transform = `translateY(${(1 - Math.min(progress * 2, 1)) * -10}px)`;
    }
  }

  function hideIndicator() {
    indicator.style.height = "0px";
    const inner = indicator.querySelector(".pull-inner");
    if (inner) {
      inner.style.opacity = "0";
      inner.style.transform = "translateY(-10px)";
    }
    setState("");
  }

  function doRefresh() {
    if (refreshing) return;
    refreshing = true;

    setState("refreshing");
    indicator.style.height = "60px";
    pullText.textContent = "Refreshing…";
    document.body.classList.add("pull-refreshing");

    // Trigger the correct page refresh
    const refreshMap = {
      home: () => {
        renderFeed();
        renderStories();
        renderWidgets();
      },
      mandir: () => renderMandir(),
      mandirCommunity: () => { if (currentMandirSlug) loadMandirPosts(currentMandirSlug); },
      video: () => renderVideoPage(),
      search: () => doSearch(""),
      notifs: () => renderNotifs(),
      messages: () => renderConvs(),
      bookmarks: () => renderBM(),
      profile: () => renderProfile(curProfId || (CU ? CU.id : "u1")),
      chats: () => renderChatsPage(),
    };

    setTimeout(() => {
      const fn = refreshMap[curPage];
      if (fn) fn();

      MC.success("Feed refreshed 🔄");

      // animate out
      setState("");
      pullText.textContent = "Pull down to refresh";
      document.body.classList.remove("pull-refreshing");

      // smooth hide
      const step = () => {
        const cur = parseFloat(indicator.style.height) || 0;
        if (cur <= 1) {
          indicator.style.height = "0px";
          refreshing = false;
          return;
        }
        indicator.style.height = cur - 5 + "px";
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 1000);
  }

  /* ── touch handlers ── */
  document.addEventListener(
    "touchstart",
    (e) => {
      if (refreshing) return;
      startScrollY = window.scrollY;
      if (!canPull()) return;

      startY = e.touches[0].clientY;
      pulling = false;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (refreshing) return;
      if (!canPull() && window.scrollY > 5) return;

      currentY = e.touches[0].clientY;
      const diff = currentY - startY;

      if (diff <= 0) {
        if (pulling) hideIndicator();
        pulling = false;
        return;
      }

      pulling = true;

      // Apply resistance so it feels natural
      const resistance = 0.4;
      const pull = Math.min(diff * resistance, MAX_PULL);
      const progress = pull / THRESHOLD;

      showIndicator(progress);

      if (pull >= THRESHOLD) {
        setState("ready");
        pullText.textContent = "Release to refresh";
      } else {
        setState("visible");
        pullText.textContent = "Pull down to refresh";
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (refreshing || !pulling) return;
      pulling = false;

      const diff = currentY - startY;
      const resistance = 0.4;
      const pull = Math.min(diff * resistance, MAX_PULL);

      if (pull >= THRESHOLD) {
        doRefresh();
      } else {
        // Not enough — snap back
        setState("");
        pullText.textContent = "Pull down to refresh";
        const snap = () => {
          const cur = parseFloat(indicator.style.height) || 0;
          if (cur <= 1) {
            indicator.style.height = "0px";
            return;
          }
          indicator.style.height = cur - 4 + "px";
          requestAnimationFrame(snap);
        };
        requestAnimationFrame(snap);
      }
    },
    { passive: true },
  );
})();

/* ================================================================
   CHATS MODULE — paste after: window.addEventListener("DOMContentLoaded", init);
   ================================================================ */

const CHAT_CONTACTS = [
  { id: "cc1", uid: "u2", online: true, lastSeen: "online" },
  {
    id: "cc2",
    uid: "u3",
    online: false,
    lastSeen: "last seen today at 9:10 AM",
  },
  { id: "cc3", uid: "u4", online: true, lastSeen: "online" },
  { id: "cc4", uid: "u1", online: false, lastSeen: "last seen yesterday" },
  {
    id: "cc5",
    uid: "cx1",
    online: true,
    lastSeen: "online",
    name: "Radha Devi",
    handle: "radha_devi",
    avatar: null,
    verified: false,
  },
  {
    id: "cc6",
    uid: "cx2",
    online: false,
    lastSeen: "last seen 2h ago",
    name: "Govind Das",
    handle: "govind_das",
    avatar: null,
    verified: false,
  },
];

const CHAT_GROUPS = [
  {
    id: "cg1",
    type: "group",
    name: "Kedarnath Yatra 2025 🏔",
    members: ["u1", "u2", "u3", "u4", "cx1"],
    admin: "u1",
    desc: "Planning the Kedarnath pilgrimage together 🙏",
    emoji: "🏔",
  },
  {
    id: "cg2",
    type: "group",
    name: "Tirth Sutra Sangha 🕉",
    members: ["u2", "u3", "cx1", "cx2"],
    admin: "u2",
    desc: "Official Tirth Sutra community group",
    emoji: "🕉",
  },
  {
    id: "cg3",
    type: "group",
    name: "Bhajan Circle 🎶",
    members: ["u1", "u4", "cx1", "cx2"],
    admin: "u4",
    desc: "Daily bhajans and kirtan sharing",
    emoji: "🎶",
  },
];

const CHAT_SEED_MESSAGES = {
  cc1: [
    {
      id: "m1",
      from: "u2",
      txt: "Jai Shri Ram! 🙏",
      ts: Date.now() - 3600000,
      read: true,
    },
    {
      id: "m2",
      from: "me",
      txt: "Jai! How are you doing?",
      ts: Date.now() - 3500000,
      read: true,
    },
    {
      id: "m3",
      from: "u2",
      txt: "All good, just came back from Ganga Aarti. It was divine! 🌊",
      ts: Date.now() - 3400000,
      read: true,
    },
    {
      id: "m4",
      from: "me",
      txt: "Wonderful! I plan to visit next week.",
      ts: Date.now() - 3000000,
      read: true,
    },
    {
      id: "m5",
      from: "u2",
      txt: "You should stay for the evening aarti — truly mesmerising.",
      ts: Date.now() - 2900000,
      read: false,
    },
  ],
  cc2: [
    {
      id: "m1",
      from: "u3",
      txt: "Namaste! Did you read the new shloka I posted?",
      ts: Date.now() - 86400000,
      read: true,
    },
    {
      id: "m2",
      from: "me",
      txt: "Yes! Bhagavad Gita 18.78 — beautiful. 🕉",
      ts: Date.now() - 86000000,
      read: true,
    },
    {
      id: "m3",
      from: "u3",
      txt: "Jai Shri Krishna! Sharing more tomorrow.",
      ts: Date.now() - 85000000,
      read: true,
    },
  ],
  cc3: [
    {
      id: "m1",
      from: "u4",
      txt: "Hey! Are you joining the Amarnath yatra this summer?",
      ts: Date.now() - 7200000,
      read: true,
    },
    {
      id: "m2",
      from: "me",
      txt: "Definitely planning to! When are you going?",
      ts: Date.now() - 7100000,
      read: true,
    },
    {
      id: "m3",
      from: "u4",
      txt: "July 15th from Jammu. Let me know!",
      ts: Date.now() - 7000000,
      read: false,
    },
  ],
  cc4: [
    {
      id: "m1",
      from: "u1",
      txt: "Pranam. Your questions during satsang were very insightful.",
      ts: Date.now() - 172800000,
      read: true,
    },
    {
      id: "m2",
      from: "me",
      txt: "Pranam Swamiji 🙏 Your teachings are truly inspiring.",
      ts: Date.now() - 172000000,
      read: true,
    },
  ],
  cc5: [
    {
      id: "m1",
      from: "cx1",
      txt: "Hare Krishna! 🌸 Have you visited Vrindavan?",
      ts: Date.now() - 43200000,
      read: true,
    },
    {
      id: "m2",
      from: "me",
      txt: "Not yet — it is on my list!",
      ts: Date.now() - 43000000,
      read: true,
    },
    {
      id: "m3",
      from: "cx1",
      txt: "You must visit during Janmashtami — absolutely magical! 🎊",
      ts: Date.now() - 42000000,
      read: false,
    },
  ],
  cc6: [
    {
      id: "m1",
      from: "cx2",
      txt: "Hari Bol! 🎻 Do you attend ISKCON Sunday feasts?",
      ts: Date.now() - 259200000,
      read: true,
    },
    {
      id: "m2",
      from: "me",
      txt: "Sometimes! The prasad is always wonderful.",
      ts: Date.now() - 258000000,
      read: true,
    },
  ],
  cg1: [
    {
      id: "m1",
      from: "u1",
      txt: "Jai Kedarnath! 🏔 Planning for May 2025.",
      ts: Date.now() - 86400000,
      read: true,
    },
    {
      id: "m2",
      from: "u2",
      txt: "I am in! Should we book helicopters in advance?",
      ts: Date.now() - 86000000,
      read: true,
    },
    {
      id: "m3",
      from: "u3",
      txt: "Yes — they fill up very fast. Register at irctc.co.in",
      ts: Date.now() - 85000000,
      read: true,
    },
    {
      id: "m4",
      from: "cx1",
      txt: "What is the packing list? First time for me 🙏",
      ts: Date.now() - 84000000,
      read: true,
    },
    {
      id: "m5",
      from: "u4",
      txt: "Warm clothes, trekking shoes, and lots of prasad! 😄",
      ts: Date.now() - 7200000,
      read: false,
    },
  ],
  cg2: [
    {
      id: "m1",
      from: "u2",
      txt: "Welcome everyone to the official Tirth Sutra Sangha! 🕉",
      ts: Date.now() - 604800000,
      read: true,
    },
    {
      id: "m2",
      from: "cx1",
      txt: "Jai Shri Ram! Happy to be here 🙏",
      ts: Date.now() - 604000000,
      read: true,
    },
    {
      id: "m3",
      from: "cx2",
      txt: "Hare Krishna! Sharing bhakti content here?",
      ts: Date.now() - 603000000,
      read: true,
    },
    {
      id: "m4",
      from: "u3",
      txt: "Yes! Daily shlokas, event updates, and spiritual discussions.",
      ts: Date.now() - 602000000,
      read: true,
    },
    {
      id: "m5",
      from: "u2",
      txt: "New blog post on Char Dham planning is live on the feed! 🎉",
      ts: Date.now() - 3600000,
      read: false,
    },
  ],
  cg3: [
    {
      id: "m1",
      from: "u4",
      txt: "Let us start with Hanuman Chalisa every morning 🙏",
      ts: Date.now() - 172800000,
      read: true,
    },
    {
      id: "m2",
      from: "cx1",
      txt: "Jai Bajrang Bali! I will share a new bhajan today.",
      ts: Date.now() - 172000000,
      read: true,
    },
    {
      id: "m3",
      from: "cx2",
      txt: "🎵 Hari naam sankirtan is the best medicine!",
      ts: Date.now() - 171000000,
      read: true,
    },
    {
      id: "m4",
      from: "u1",
      txt: "Absolutely. Naam is everything. 🕉",
      ts: Date.now() - 7200000,
      read: false,
    },
  ],
};

let activeChatId = null;
let chatFilter = "all";
let selectedGroupMembers = [];

const chatsBotReplies = {
  u1: [
    "Pranam 🙏 May Shiva bless you!",
    "That is very insightful.",
    "Hari OM! 🕉",
    "Keep up the sadhana.",
    "Wonderful thought.",
  ],
  u2: [
    "Jai Shri Ram! 🙏",
    "Yes, I agree completely!",
    "Have you tried the new temple route?",
    "See you at the ghats! 🌊",
    "Amazing!",
  ],
  u3: [
    "Jai Shri Krishna! 🔱",
    "Today's shloka: Yogastah kuru karmani 🕉",
    "Great point!",
    "Keep chanting! 📿",
    "Indeed!",
  ],
  u4: [
    "Har Har Mahadev! 🏔",
    "The mountains are calling!",
    "Kedarnath this year!",
    "Photography session?",
    "Pranam 🙏",
  ],
  cx1: [
    "Hare Krishna! 🌸",
    "Radhe Radhe! 🌺",
    "Beautiful thought!",
    "Jai Shri Radha!",
    "Vrindavan calls!",
  ],
  cx2: [
    "Hari Bol! 🎻",
    "Naam is everything!",
    "ISKCON Prabhu ji!",
    "Govinda! 🎊",
    "Jai Jagannath!",
  ],
};
const groupBotMap = {
  cg1: ["u1", "u2", "u3", "u4", "cx1"],
  cg2: ["u2", "cx1", "u3"],
  cg3: ["u4", "cx1", "u2"],
};

/* ── Helpers ── */
function getChatUser(uid) {
  const u = getUser(uid);
  if (u) return u;
  const extra = CHAT_CONTACTS.find((c) => c.uid === uid);
  if (extra && extra.name)
    return {
      id: uid,
      name: extra.name,
      handle: extra.handle,
      avatar: extra.avatar,
      verified: extra.verified || false,
    };
  return {
    id: uid,
    name: "Unknown",
    handle: "unknown",
    avatar: null,
    verified: false,
  };
}
function getChatContact(id) {
  return CHAT_CONTACTS.find((c) => c.id === id) || null;
}
function getChatGroupsStore() {
  return Store.g("chatGroups", CHAT_GROUPS);
}
function getChatGroup(id) {
  return getChatGroupsStore().find((g) => g.id === id) || null;
}
function getChatMessages(chatId) {
  const all = Store.g("chatMessages", CHAT_SEED_MESSAGES);
  return all[chatId] || [];
}
function saveChatMessages(chatId, msgs) {
  const all = Store.g("chatMessages", CHAT_SEED_MESSAGES);
  all[chatId] = msgs;
  Store.s("chatMessages", all);
}
function fmtChatTime(ts) {
  const d = new Date(ts),
    now = new Date(),
    diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}
function fmtMsgTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function getChatAvHTML(id, size = 38) {
  if (id.startsWith("cg")) {
    const g = getChatGroup(id);
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--pl));display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.42)}px;flex-shrink:0">${g ? g.emoji || "👥" : "👥"}</div>`;
  }
  const c = getChatContact(id);
  const u = getChatUser(c ? c.uid : "");
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;background:var(--p);display:flex;align-items:center;justify-content:center;color:#fff;font-size:${Math.round(size * 0.35)}px;font-weight:600;flex-shrink:0">${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : getIni(u.name)}</div>`;
}
function getUnreadCount(chatId) {
  return getChatMessages(chatId).filter((m) => m.from !== "me" && !m.read)
    .length;
}
function getLastMsg(chatId) {
  const msgs = getChatMessages(chatId);
  return msgs.length ? msgs[msgs.length - 1] : null;
}
function markAllRead(chatId) {
  const msgs = getChatMessages(chatId);
  msgs.forEach((m) => (m.read = true));
  saveChatMessages(chatId, msgs);
}

function renderChatsPage() {
  renderChatsList();
  if (window.innerWidth >= 641) {
    // Desktop: show empty state panel on right
    const win = document.getElementById("chatWindow");
    if (win) win.classList.remove("hide");
    const bar = document.getElementById("chatWinBar");
    if (bar) bar.style.display = "none";
    const empty = document.getElementById("chatEmptyState");
    if (empty) {
      empty.style.display = "flex";
      empty.style.flexDirection = "column";
    }
  } else {
    // Mobile: always show list first, hide chat window
    const win = document.getElementById("chatWindow");
    if (win) win.classList.add("hide");
    activeChatId = null;
  }
}

function renderChatsList() {
  const c = document.getElementById("chatsList");
  if (!c) return;

  let items = [];
  CHAT_CONTACTS.forEach((cc) => {
    const u = getChatUser(cc.uid);
    items.push({
      id: cc.id,
      type: "direct",
      name: u.name,
      online: cc.online,
      lastMsg: getLastMsg(cc.id),
      unread: getUnreadCount(cc.id),
      verified: u.verified || false,
    });
  });
  getChatGroupsStore().forEach((g) => {
    items.push({
      id: g.id,
      type: "group",
      name: g.name,
      online: false,
      lastMsg: getLastMsg(g.id),
      unread: getUnreadCount(g.id),
    });
  });

  items.sort(
    (a, b) => (b.lastMsg ? b.lastMsg.ts : 0) - (a.lastMsg ? a.lastMsg.ts : 0),
  );

  const q = (
    document.getElementById("chatsSearchIn")?.value || ""
  ).toLowerCase();
  if (chatFilter === "direct") items = items.filter((i) => i.type === "direct");
  if (chatFilter === "groups") items = items.filter((i) => i.type === "group");
  if (chatFilter === "unread") items = items.filter((i) => i.unread > 0);
  if (q) items = items.filter((i) => i.name.toLowerCase().includes(q));

  if (!items.length) {
    c.innerHTML = `<div class="empty" style="padding:40px 20px"><div class="empty-ico">💬</div><div class="empty-sub">No chats found</div></div>`;
    return;
  }

  c.innerHTML = items
    .map((item) => {
      const isActive = item.id === activeChatId;
      let prevText = "Tap to start chatting";
      if (item.lastMsg) {
        const isMe = item.lastMsg.from === "me";
        const senderName = isMe
          ? "You"
          : item.type === "group"
            ? getChatUser(item.lastMsg.from).name.split(" ")[0]
            : "";
        prevText =
          (senderName ? senderName + ": " : "") +
          (item.lastMsg.img ? "📷 Photo" : item.lastMsg.txt);
      }
      const time = item.lastMsg ? fmtChatTime(item.lastMsg.ts) : "";
      return `<div class="chat-item${isActive ? " active" : ""}" id="ci_${item.id}" onclick="openChatWindow('${item.id}')">
      <div class="chat-item-av">
        ${getChatAvHTML(item.id, 46)}
        ${item.online ? '<div class="chat-item-online"></div>' : ""}
      </div>
      <div class="chat-item-body">
        <div class="chat-item-top">
          <span class="chat-item-name">${esc(item.name)}${item.verified ? " 🔱" : ""} ${item.type === "group" ? '<span class="chat-group-badge">Group</span>' : ""}</span>
          <span class="chat-item-time${item.unread ? " unread-time" : ""}">${time}</span>
        </div>
        <div class="chat-item-bottom">
          <span class="chat-item-prev${item.unread ? " bold" : ""}">${esc(prevText.substring(0, 55))}</span>
          ${item.unread ? `<span class="chat-unread-badge">${item.unread > 9 ? "9+" : item.unread}</span>` : ""}
        </div>
      </div>
    </div>`;
    })
    .join("");
}

/* ── Open Chat Window ── */
function openChatWindow(chatId) {
  activeChatId = chatId;
  markAllRead(chatId);

  document
    .querySelectorAll(".chat-item")
    .forEach((el) => el.classList.remove("active"));
  const el = document.getElementById("ci_" + chatId);
  if (el) el.classList.add("active");

  const isGroup = chatId.startsWith("cg");
  const win = document.getElementById("chatWindow");
  const bar = document.getElementById("chatWinBar");
  const empty = document.getElementById("chatEmptyState");

  if (win) win.classList.remove("hide");
  if (bar) bar.style.display = "flex";
  if (empty) empty.style.display = "none";

  const winAv = document.getElementById("chatWinAv");
  const winName = document.getElementById("chatWinName");
  const winSub = document.getElementById("chatWinSub");
  if (winAv) winAv.innerHTML = getChatAvHTML(chatId, 38);

  if (isGroup) {
    const g = getChatGroup(chatId);
    if (winName) winName.textContent = g ? g.name : "Group";
    if (winSub) winSub.textContent = g ? `${g.members.length} members` : "";
  } else {
    const cc = getChatContact(chatId);
    const u = cc ? getChatUser(cc.uid) : { name: "Unknown" };
    if (winName) winName.textContent = u.name + (u.verified ? " 🔱" : "");
    if (winSub)
      winSub.textContent = cc ? (cc.online ? "🟢 online" : cc.lastSeen) : "";
  }

  renderChatMessages(chatId);
  renderChatsList();
  setTimeout(() => document.getElementById("chatMsgInput")?.focus(), 100);
}

/* ── Render Messages ── */
function renderChatMessages(chatId) {
  const c = document.getElementById("chatWinMsgs");
  if (!c) return;
  const msgs = getChatMessages(chatId);
  const isGroup = chatId.startsWith("cg");
  let html = "",
    lastDate = "";

  msgs.forEach((m, idx) => {
    const d = new Date(m.ts);
    const dateStr = d.toDateString();
    if (dateStr !== lastDate) {
      const now = new Date();
      const yest = new Date(now);
      yest.setDate(now.getDate() - 1);
      const label =
        dateStr === now.toDateString()
          ? "Today"
          : dateStr === yest.toDateString()
            ? "Yesterday"
            : d.toLocaleDateString([], {
              day: "numeric",
              month: "long",
              year: "numeric",
            });
      html += `<div class="msg-date-sep"><span>${label}</span></div>`;
      lastDate = dateStr;
    }
    const isOut = m.from === "me";
    const u = isOut ? null : getChatUser(m.from);
    const prev = msgs[idx - 1];
    const showAv = !isOut && isGroup && (!prev || prev.from !== m.from);
    const avHtml = u
      ? `<div class="msg-av-small">${u.avatar ? `<img src="${u.avatar}">` : getIni(u.name)}</div>`
      : "";
    const avOrSpacer =
      !isOut && isGroup
        ? showAv
          ? avHtml
          : '<div class="msg-av-placeholder"></div>'
        : "";
    const tickClass = m.read ? "tick-read" : "tick-sent";
    const tickSvg = isOut
      ? `<svg class="msg-tick ${tickClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : "";

    html += `<div class="msg-row ${isOut ? "out" : "in"}">
      ${avOrSpacer}
      <div class="msg-bubble">
        ${showAv && u ? `<div class="msg-sender-name">${esc(u.name)}</div>` : ""}
        ${m.img ? `<img class="msg-bubble-img" src="${m.img}" alt="">` : ""}
        ${m.txt ? esc(m.txt) : ""}
        <div class="msg-meta">
          <span class="msg-time">${fmtMsgTime(m.ts)}</span>
          ${tickSvg}
        </div>
      </div>
    </div>`;
  });

  c.innerHTML =
    html ||
    `<div class="chat-empty-state"><div style="font-size:36px;margin-bottom:8px">👋</div><div style="font-size:14px;color:var(--t3)">Say hello!</div></div>`;
  c.scrollTop = c.scrollHeight;
}

/* ── Send Message ── */
function sendChatMessage() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  if (!activeChatId) return;
  const inp = document.getElementById("chatMsgInput");
  const txt = inp?.value?.trim() || "";
  if (!txt) return;
  const msgs = getChatMessages(activeChatId);
  msgs.push({
    id: "m" + Date.now(),
    from: "me",
    txt,
    ts: Date.now(),
    read: false,
  });
  saveChatMessages(activeChatId, msgs);
  inp.value = "";
  renderChatMessages(activeChatId);
  renderChatsList();
  simulateChatReply(activeChatId);
}

function simulateChatReply(chatId) {
  const delay = 1000 + Math.random() * 1500;
  const c = document.getElementById("chatWinMsgs");
  setTimeout(() => {
    if (activeChatId !== chatId || !c) return;
    const typingEl = document.createElement("div");
    typingEl.className = "msg-row in";
    typingEl.id = "typingIndicator";
    typingEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    c.appendChild(typingEl);
    c.scrollTop = c.scrollHeight;
  }, 400);

  setTimeout(() => {
    if (activeChatId !== chatId) return;
    const ti = document.getElementById("typingIndicator");
    if (ti) ti.remove();
    let from;
    if (chatId.startsWith("cg")) {
      const g = getChatGroup(chatId);
      const members = (groupBotMap[chatId] || (g ? g.members : [])).filter(
        (m) => m !== "me",
      );
      from = members[Math.floor(Math.random() * members.length)];
    } else {
      const cc = getChatContact(chatId);
      from = cc ? cc.uid : "u1";
    }
    const pool = chatsBotReplies[from] || [
      "🙏",
      "Great!",
      "Indeed!",
      "Jai Shri Ram!",
    ];
    const reply = pool[Math.floor(Math.random() * pool.length)];
    const msgs = getChatMessages(chatId);
    msgs.push({
      id: "m" + Date.now(),
      from,
      txt: reply,
      ts: Date.now(),
      read: true,
    });
    msgs.forEach((m) => {
      if (m.from === "me") m.read = true;
    });
    saveChatMessages(chatId, msgs);
    if (activeChatId === chatId) renderChatMessages(chatId);
    renderChatsList();
  }, delay);
}

/* ── Image Attach ── */
function handleChatImgAttach(e) {
  if (!CU || !activeChatId) {
    openOvl("authOvl");
    return;
  }
  const f = e.target?.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    const msgs = getChatMessages(activeChatId);
    msgs.push({
      id: "m" + Date.now(),
      from: "me",
      img: ev.target.result,
      txt: "",
      ts: Date.now(),
      read: false,
    });
    saveChatMessages(activeChatId, msgs);
    renderChatMessages(activeChatId);
    renderChatsList();
    simulateChatReply(activeChatId);
  };
  r.readAsDataURL(f);
}

/* ── Emoji ── */
function toggleChatEmoji() {
  const ep = document.getElementById("chatEmojiPicker");
  if (!ep) return;
  ep.classList.toggle("hide");
  if (!ep.classList.contains("hide") && !ep.innerHTML) {
    const emojis = [
      "🕉",
      "🙏",
      "🏔",
      "🛕",
      "📖",
      "🌸",
      "🔱",
      "💧",
      "🌅",
      "✨",
      "🪔",
      "📿",
      "🌊",
      "⛰️",
      "🌺",
      "🕯",
      "🌿",
      "🔔",
      "🎆",
      "🌙",
      "😊",
      "❤️",
      "🙌",
      "🎶",
      "🎊",
    ];
    ep.innerHTML = emojis
      .map(
        (em) =>
          `<button class="chat-emoji-btn2" onclick="insertChatEmoji('${em}')">${em}</button>`,
      )
      .join("");
  }
}
function insertChatEmoji(em) {
  const inp = document.getElementById("chatMsgInput");
  if (inp) {
    inp.value += em;
    inp.focus();
  }
  document.getElementById("chatEmojiPicker")?.classList.add("hide");
}

/* ── Filter & Search ── */
function setChatFilter(f, el) {
  chatFilter = f;
  document
    .querySelectorAll(".chats-ftab")
    .forEach((t) => t.classList.remove("on"));
  if (el) el.classList.add("on");
  renderChatsList();
}
function filterChats() {
  renderChatsList();
}

function filterDMSearch(q) {
  const c = document.getElementById("dmUserList");
  if (!c) return;
  const all = getUsers();
  const filtered = q
    ? all.filter(
      (u) =>
        u.name.toLowerCase().includes(q.toLowerCase()) ||
        u.handle.toLowerCase().includes(q.toLowerCase()),
    )
    : all;
  c.innerHTML = filtered
    .map(
      (u) => `<div class="dm-user-item" onclick="startDMWith('${u.id}')">
    <div class="av av36">${u.avatar ? `<img src="${u.avatar}">` : getIni(u.name)}</div>
    <div><div style="font-weight:600;font-size:14px">${u.name}${u.verified ? " 🔱" : ""}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div>
  </div>`,
    )
    .join("");
}

function startDMWith(uid) {
  closeOvl("newDMModal");
  let cc = CHAT_CONTACTS.find((c) => c.uid === uid);
  if (!cc) {
    const newId = "cc" + Date.now();
    CHAT_CONTACTS.push({ id: newId, uid, online: false, lastSeen: "recently" });
    cc = CHAT_CONTACTS[CHAT_CONTACTS.length - 1];
  }
  gp("chats");
  setTimeout(() => openChatWindow(cc.id), 100);
}

/* ── New Group ── */
function openNewGroupModal() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  selectedGroupMembers = [];
  const el = document.getElementById("ngName");
  if (el) el.value = "";
  const ml = document.getElementById("ngMemberList");
  if (!ml) return;
  ml.innerHTML = getUsers()
    .filter((u) => u.id !== CU.id)
    .map(
      (
        u,
      ) => `<div class="ng-member-item" onclick="toggleGroupMember('${u.id}')">
    <div class="ng-check" id="ngc_${u.id}"></div>
    <div class="av av36">${u.avatar ? `<img src="${u.avatar}">` : getIni(u.name)}</div>
    <div><div style="font-weight:600;font-size:14px">${u.name}</div><div style="font-size:12px;color:var(--t3)">@${u.handle}</div></div>
  </div>`,
    )
    .join("");
  openOvl("newGroupModal");
}
function toggleGroupMember(uid) {
  const check = document.getElementById("ngc_" + uid);
  const idx = selectedGroupMembers.indexOf(uid);
  if (idx > -1) {
    selectedGroupMembers.splice(idx, 1);
    check?.classList.remove("checked");
  } else {
    selectedGroupMembers.push(uid);
    check?.classList.add("checked");
  }
}
function createGroup() {
  const name = document.getElementById("ngName")?.value?.trim() || "";
  if (!name) {
    MC.warn("Please enter a group name");
    return;
  }
  if (selectedGroupMembers.length < 1) {
    MC.warn("Add at least 1 member");
    return;
  }
  const id = "cg" + Date.now();
  const newG = {
    id,
    type: "group",
    name,
    members: [CU.id, ...selectedGroupMembers],
    admin: CU.id,
    desc: "",
    emoji: "💬",
  };
  const gs = getChatGroupsStore();
  gs.push(newG);
  Store.s("chatGroups", gs);
  CHAT_GROUPS.push(newG);
  closeOvl("newGroupModal");
  renderChatsList();
  openChatWindow(id);
  MC.success(`Group "${name}" created! 🎉`);
}

/* ── New DM ── */
function openNewDMModal() {
  if (!CU) {
    openOvl("authOvl");
    return;
  }
  const inp = document.getElementById("dmSearchIn");
  if (inp) inp.value = "";
  filterDMSearch("");
  openOvl("newDMModal");
}

/* ── Chat Window Menu ── */
function toggleChatWinMenu() {
  document.getElementById("chatWinMenu")?.classList.toggle("hide");
}

function viewChatInfo() {
  document.getElementById("chatWinMenu")?.classList.add("hide");
  if (!activeChatId) return;
  if (activeChatId.startsWith("cg")) {
    const g = getChatGroup(activeChatId);
    MC.info(g ? `${g.name} · ${g.members.length} members 👥` : "Group info");
  } else {
    const cc = getChatContact(activeChatId);
    const u = getChatUser(cc?.uid || "");
    MC.info(
      `${u.name} · @${u.handle} ${cc?.online ? "🟢 online" : cc?.lastSeen || ""}`,
    );
  }
}
function clearChatMessages() {
  document.getElementById("chatWinMenu")?.classList.add("hide");
  if (!activeChatId) return;
  saveChatMessages(activeChatId, []);
  renderChatMessages(activeChatId);
  renderChatsList();
  MC.info("Messages cleared");
}
function deleteChatFromMenu() {
  document.getElementById("chatWinMenu")?.classList.add("hide");
  if (!activeChatId) return;
  saveChatMessages(activeChatId, []);
  closeChatWindow();
  MC.info("Chat deleted");
}

/* ── Close Chat (mobile back) ── */
function closeChatWindow() {
  activeChatId = null;
  document
    .querySelectorAll(".chat-item")
    .forEach((el) => el.classList.remove("active"));
  if (window.innerWidth < 641) {
    document.getElementById("chatWindow")?.classList.add("hide");
  } else {
    const bar = document.getElementById("chatWinBar");
    if (bar) bar.style.display = "none";
    const msgs = document.getElementById("chatWinMsgs");
    if (msgs)
      msgs.innerHTML = `<div class="chat-empty-state" id="chatEmptyState" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--t3);text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:12px">💬</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">Select a chat</div>
      <div style="font-size:13px">Choose a conversation from the left to start chatting.</div>
    </div>`;
    const winAv = document.getElementById("chatWinAv");
    if (winAv) winAv.innerHTML = "";
    const winName = document.getElementById("chatWinName");
    if (winName) winName.textContent = "";
    const winSub = document.getElementById("chatWinSub");
    if (winSub) winSub.textContent = "";
  }
  renderChatsList();
}

function updateChatTyping() {
  /* placeholder */
}

/* ── Close menus on outside click ── */
document.addEventListener("click", (e) => {
  if (
    !e.target.closest(".chat-emoji-btn") &&
    !e.target.closest("#chatEmojiPicker")
  ) {
    document.getElementById("chatEmojiPicker")?.classList.add("hide");
  }
  if (
    !e.target.closest("#chatWinMenuBtn") &&
    !e.target.closest("#chatWinMenu")
  ) {
    document.getElementById("chatWinMenu")?.classList.add("hide");
  }
});
