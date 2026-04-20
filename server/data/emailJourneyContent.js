const CAMPAIGN_KEY = "tirth-sutra-journey-v1";
const CAMPAIGN_NAME = "1-Year Tirth Sutra Email Journey";
const EMAILS_PER_WEEK = 3;
const TOTAL_WEEKS = 52;

const PLATFORM_URL =
  process.env.EMAIL_CAMPAIGN_DEFAULT_CTA_URL ||
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  "https://shaleen17.github.io/Tirth-Sutra/";
const SOCIAL_URL = process.env.EMAIL_CAMPAIGN_SOCIAL_URL || PLATFORM_URL;
const MISSION_URL = process.env.EMAIL_CAMPAIGN_MISSION_URL || PLATFORM_URL;
const SHOP_URL = process.env.EMAIL_CAMPAIGN_SHOP_URL || PLATFORM_URL;

function email(stage, subject, paragraphs, options = {}) {
  return {
    stage,
    subject,
    previewText:
      options.previewText ||
      paragraphs[0] ||
      "A weekly note from the Tirth Sutra spiritual journey.",
    paragraphs,
    bullets: options.bullets || [],
    ctaLabel: options.ctaLabel || "Explore Tirth Sutra",
    ctaUrl: options.ctaUrl || PLATFORM_URL,
    category: options.category || "spiritual-journey",
  };
}

const customWeeks = [
  {
    title: "Introduction to the Journey",
    emails: [
      email("Inspiration", "Welcome to the Path of Tirth Sutra", [
        "Namaste, and welcome to the Tirth Sutra community.",
        "Here we believe that every journey toward a sacred place is also a journey toward the self.",
        "Pilgrimage is not tourism. It is a practice of humility, patience, and devotion. Over the coming weeks, we will share stories, wisdom, rituals, and opportunities to serve dharma.",
        "Let your journey begin today.",
      ], {
        ctaLabel: "Explore the Tirth Sutra Platform",
        ctaUrl: PLATFORM_URL,
        category: "welcome",
      }),
      email("Knowledge", "Why Pilgrimage Still Matters Today", [
        "In ancient India, pilgrims walked thousands of kilometers to reach sacred places.",
        "The purpose was transformation. Walking slowly toward a temple quiets the mind, softens the ego, and strengthens devotion.",
        "At Tirth Sutra, we aim to revive this spirit of meaningful journeys.",
      ], {
        ctaLabel: "Discover sacred journeys",
      }),
      email("Action", "Your First Step Toward a Spiritual Life", [
        "Spirituality does not begin only in temples. It begins with awareness in everyday life.",
        "A small daily practice can transform your inner world.",
      ], {
        bullets: [
          "5 minutes of silence",
          "Gratitude before meals",
          "Respect for nature",
          "Compassion for animals",
        ],
        ctaLabel: "Join the Tirth Sutra community",
        ctaUrl: SOCIAL_URL,
      }),
    ],
  },
  {
    title: "Meaning of Tirth",
    emails: [
      email("Inspiration", "What is a Tirth?", [
        "A Tirth is a crossing point between the human world and the divine.",
        "Sacred places exist to remind us of a higher purpose. Every temple, river, and pilgrimage path holds centuries of spiritual energy.",
      ], {
        ctaLabel: "Discover sacred places",
      }),
      email("Knowledge", "Walking Meditation", [
        "Our ancestors insisted on walking during pilgrimage because walking becomes meditation.",
        "Every step can become prayer when the mind is steady and the intention is pure.",
      ], {
        ctaLabel: "Learn more about mindful travel",
      }),
      email("Action", "A Pilgrim's Story", [
        "One pilgrim once said, \"I left home seeking God and returned discovering myself.\"",
        "That is the magic of pilgrimage. The outer road slowly opens the inner path.",
      ], {
        ctaLabel: "Read spiritual stories",
      }),
    ],
  },
  {
    title: "Dharm Sansthan Service",
    emails: [
      email("Inspiration", "Service is the Highest Dharma", [
        "In Indian philosophy, Seva is greater than ritual.",
        "Helping people, protecting nature, and supporting communities are all acts of dharma.",
      ], {
        ctaLabel: "Explore Dharm Sansthan",
        ctaUrl: MISSION_URL,
        category: "seva",
      }),
      email("Knowledge", "The Power of Community", [
        "A spiritual society grows when people work together for dharma.",
        "Temples, dharmashalas, food services, and education centers are built through collective effort.",
      ], {
        ctaLabel: "Learn how you can contribute",
        category: "seva",
      }),
      email("Action", "Small Acts of Dharma", [
        "You do not need to build temples to serve dharma. Small acts done with sincerity also matter.",
      ], {
        bullets: [
          "Feed animals",
          "Support pilgrims",
          "Plant trees",
          "Help the needy",
        ],
        ctaLabel: "Start serving today",
        category: "seva",
      }),
    ],
  },
  {
    title: "Gau Sutra Cow Protection",
    emails: [
      email("Inspiration", "Why Cows are Sacred in Dharma", [
        "In Indian culture, the cow represents nurturing, life, and ecological balance.",
        "Protecting cows is not only tradition. It is also environmental wisdom.",
      ], {
        ctaLabel: "Learn about Gau Sutra",
        category: "gau-sutra",
      }),
      email("Knowledge", "The Role of Gaushalas", [
        "Gaushalas protect abandoned cows and preserve indigenous breeds.",
        "They are living examples of compassion, responsibility, and community care.",
      ], {
        ctaLabel: "Support cow protection",
        category: "gau-sutra",
      }),
      email("Action", "Living with Compassion", [
        "Spirituality is incomplete without compassion toward animals.",
        "Protecting nature is protecting dharma.",
      ], {
        ctaLabel: "Explore Gau Sutra initiatives",
        category: "gau-sutra",
      }),
    ],
  },
  {
    title: "Temple Wisdom",
    emails: [
      email("Inspiration", "Why Temples Were Built", [
        "Ancient temples were designed as energy centers for meditation.",
        "Their architecture, rituals, and sound were created to guide the mind inward.",
      ], {
        ctaLabel: "Discover temple science",
        category: "temple-wisdom",
      }),
      email("Knowledge", "The Meaning of Darshan", [
        "Darshan means seeing and being seen by the divine.",
        "It is not only visiting a temple. It is experiencing presence.",
      ], {
        ctaLabel: "Read about sacred rituals",
        category: "temple-wisdom",
      }),
      email("Action", "Temple Etiquette", [
        "Before entering a temple, prepare the mind as carefully as the body.",
      ], {
        bullets: [
          "Silence the mind",
          "Leave ego outside",
          "Offer gratitude",
        ],
        ctaLabel: "Explore sacred traditions",
        category: "temple-wisdom",
      }),
    ],
  },
  {
    title: "Spiritual Lifestyle",
    emails: [
      email("Inspiration", "Begin Your Day with Dharma", [
        "A spiritual morning does not need to be complicated.",
        "Begin with gratitude, a short silence, and one verse or thought that lifts your mind.",
      ], {
        bullets: ["1 minute gratitude", "5 minutes meditation", "Read a spiritual verse"],
        ctaLabel: "Learn daily practices",
        category: "daily-practice",
      }),
      email("Knowledge", "Spiritual Minimalism", [
        "A spiritual life values simplicity over excess.",
        "Less distraction creates more clarity. More clarity creates better devotion.",
      ], {
        ctaLabel: "Explore mindful living",
        category: "daily-practice",
      }),
      email("Action", "The Inner Temple", [
        "The greatest temple exists within you.",
        "Meditation is the doorway. Step inside for a few quiet minutes today.",
      ], {
        ctaLabel: "Start your meditation journey",
        category: "daily-practice",
      }),
    ],
  },
  {
    title: "Sacred Travel",
    emails: [
      email("Inspiration", "Sacred Destinations of India", [
        "India holds thousands of sacred pilgrimage sites.",
        "Each one carries history, devotion, and stories that can awaken the heart.",
      ], {
        ctaLabel: "Discover sacred destinations",
        category: "travel-guide",
      }),
      email("Knowledge", "Preparing for a Pilgrimage", [
        "Before starting a pilgrimage, prepare the body, the mind, and the intention.",
        "A clear intention turns travel into sadhana.",
      ], {
        ctaLabel: "Read pilgrimage guide",
        category: "travel-guide",
      }),
      email("Action", "Pilgrimage Packing List", [
        "A simple bag can support a peaceful yatra when it carries the right essentials.",
      ], {
        bullets: [
          "Comfortable footwear",
          "Water bottle",
          "Mantra book",
          "Simple clothing",
        ],
        ctaLabel: "See full checklist",
        category: "travel-guide",
      }),
    ],
  },
  {
    title: "Spiritual Knowledge",
    emails: [
      email("Inspiration", "Wisdom from Ancient Sutras", [
        "Ancient sutras teach discipline, compassion, and awareness.",
        "Their wisdom remains timeless because human struggles remain similar across ages.",
      ], {
        ctaLabel: "Read spiritual teachings",
        category: "spiritual-knowledge",
      }),
      email("Knowledge", "The Meaning of Dharma", [
        "Dharma is not only religion.",
        "Dharma means living in harmony with truth, duty, compassion, and balance.",
      ], {
        ctaLabel: "Learn more",
        category: "spiritual-knowledge",
      }),
      email("Action", "Living with Awareness", [
        "A spiritual life is simply living with awareness in every moment.",
        "Begin with one conscious breath before your next action.",
      ], {
        ctaLabel: "Start mindful living",
        category: "spiritual-knowledge",
      }),
    ],
  },
  {
    title: "Sacred Shop and Gifts",
    emails: [
      email("Inspiration", "Sacred Items for Your Spiritual Journey", [
        "Sacred tools can help remind the mind of its higher direction.",
        "Explore malas, rudraksha, and symbols that support daily practice.",
      ], {
        bullets: ["Malas", "Rudraksha", "Sacred symbols"],
        ctaLabel: "Visit the Tirth Sutra shop",
        ctaUrl: SHOP_URL,
        category: "shop",
      }),
      email("Knowledge", "Why Rudraksha Matters", [
        "Rudraksha beads are traditionally associated with clarity, focus, and spiritual discipline.",
        "For many seekers, they become a daily reminder to return to mantra and stillness.",
      ], {
        ctaLabel: "Explore sacred products",
        ctaUrl: SHOP_URL,
        category: "shop",
      }),
      email("Action", "Spiritual Gifts", [
        "Looking for a meaningful gift?",
        "Choose something that supports spiritual growth, remembrance, and a calmer daily life.",
      ], {
        ctaLabel: "Explore gift collection",
        ctaUrl: SHOP_URL,
        category: "shop",
      }),
    ],
  },
];

const generatedThemes = [
  ["Sacred Rivers", "A river teaches movement without losing its essence.", "In dharmic tradition, rivers are remembered as mothers because they nourish body, land, and spirit.", "Offer gratitude before using water today.", "Discover sacred rivers", "nature"],
  ["Dharmashala Humility", "Simple shelter can teach deep humility.", "Dharmashalas remind pilgrims that comfort is not the goal of yatra. Simplicity is part of the training.", "Choose one simple habit this week.", "Explore Dharm Sansthan", "seva"],
  ["Mantra Practice", "A mantra gives the wandering mind a sacred home.", "Repeating a name or verse with attention can steady breath, speech, and thought.", "Repeat one mantra for five minutes.", "Learn mantra practice", "daily-practice"],
  ["Food as Prasad", "Food becomes sacred when received with gratitude.", "Prasad reminds us that nourishment is grace, not entitlement.", "Pause before your next meal and offer thanks.", "Read about sacred rituals", "ritual"],
  ["Temple Sounds", "Bells, conch, and kirtan awaken attention.", "Sound in temples is used to clear distraction and invite presence.", "Listen to one devotional track with full attention.", "Explore temple traditions", "temple-wisdom"],
  ["Pilgrim Health", "A strong yatra starts with a cared-for body.", "Stretching, hydration, and rest protect the body so the mind can stay devotional.", "Prepare a simple yatra health kit.", "See travel wellness tips", "travel-guide"],
  ["Sacred Architecture", "Temple architecture points the senses toward stillness.", "From the garbhagriha to the shikhara, every part carries symbolic meaning.", "Notice one temple detail and reflect on it.", "Discover temple science", "temple-wisdom"],
  ["Community Satsang", "Satsang keeps devotion warm.", "Company shapes consciousness. Spiritual company can gently pull the mind toward truth.", "Join or create one small satsang moment.", "Join the community", "community"],
  ["Caring for Elders", "Serving elders is a living form of worship.", "Many traditions place elder care near the heart of dharma because gratitude begins at home.", "Call or help one elder this week.", "Explore service stories", "seva"],
  ["Tree Planting Seva", "Planting a tree is service to lives you may never meet.", "Nature care and dharma care are deeply connected.", "Plant, water, or protect one tree.", "Start serving nature", "seva"],
  ["Festival Mindset", "A festival is not only a date. It is an inner preparation.", "Fasting, prayer, music, and charity help festivals become transformation rather than noise.", "Choose one festival vow.", "Explore festival wisdom", "festival"],
  ["Kashi Reflection", "Some sacred cities feel like scriptures written in stone.", "Kashi reminds seekers of impermanence, devotion, and liberation.", "Read one story about a sacred city.", "Discover sacred destinations", "travel-guide"],
  ["Kedarnath Courage", "High mountains teach surrender and courage together.", "A difficult path can purify intention when walked with humility.", "Take one disciplined step today.", "Read pilgrimage guide", "travel-guide"],
  ["Ram Mandir Devotion", "Devotion becomes powerful when it becomes character.", "Sri Ram is remembered not only through worship, but through truth, duty, and restraint.", "Practice one act of maryada today.", "Explore sacred stories", "spiritual-knowledge"],
  ["Somnath Resilience", "Some temples teach us how devotion rises again.", "Somnath stands as a reminder that faith can rebuild after loss.", "Return to one good habit you dropped.", "Discover temple stories", "temple-wisdom"],
  ["Tirupati Discipline", "Devotion grows through discipline and consistency.", "A vow, a queue, a climb, or a simple offering can train patience.", "Keep one small vow for seven days.", "Explore sacred journeys", "daily-practice"],
  ["Meenakshi Beauty", "Beauty can become a doorway to reverence.", "Sacred art is not decoration alone. It teaches the heart through form, color, and story.", "Observe sacred art without rushing.", "Discover temple art", "temple-wisdom"],
  ["Pilgrim Etiquette", "Respect is the first offering at any sacred place.", "Dress, speech, cleanliness, and patience protect the sanctity of shared spaces.", "Practice quiet respect in one public place.", "See etiquette tips", "travel-guide"],
  ["Digital Dharma", "Even online spaces can carry dharma.", "What we share, like, and comment can either create noise or spread wisdom.", "Share one uplifting thought today.", "Follow Tirth Sutra", "community"],
  ["Charity with Dignity", "True charity protects the dignity of the receiver.", "Seva is not performance. It is responsibility done with humility.", "Give quietly where it is needed.", "Learn how to contribute", "seva"],
  ["Daily Silence", "Silence is not empty. It is full of awareness.", "A few quiet minutes can reveal how restless the mind has become.", "Sit silently for five minutes.", "Start mindful living", "daily-practice"],
  ["Sacred Reading", "One verse can become a companion for the day.", "Reading slowly lets wisdom move from memory into conduct.", "Read one verse and carry it with you.", "Read spiritual teachings", "spiritual-knowledge"],
  ["Gau Seva Compassion", "Care for cows is a training in gentleness.", "Gau seva connects compassion, ecology, and gratitude for nourishment.", "Support one act of animal care.", "Explore Gau Sutra", "gau-sutra"],
  ["Pilgrim Stories", "Every pilgrim carries a hidden story.", "Stories from the path help us remember that transformation looks different for every seeker.", "Write one line from your own journey.", "Read spiritual stories", "community"],
  ["Sacred Marketplace", "A sacred product should support practice, not vanity.", "Choose objects that remind you to pray, serve, and simplify.", "Keep one sacred reminder near your workspace.", "Visit the shop", "shop"],
  ["Children and Dharma", "Children learn dharma by watching daily conduct.", "Small family rituals can plant deep roots of gratitude and respect.", "Teach one simple prayer or value.", "Explore family practices", "daily-practice"],
  ["Women in Pilgrimage", "Many sacred journeys are held together by the devotion of mothers, daughters, and sisters.", "Their stories show endurance, service, and quiet leadership.", "Honor one woman who shaped your values.", "Read community stories", "community"],
  ["Youth and Purpose", "Young seekers need purpose more than pressure.", "Dharma gives direction without taking away curiosity.", "Choose one meaningful skill to build.", "Join the Tirth Sutra community", "community"],
  ["Sacred Cleanliness", "Clean spaces support clean attention.", "Temple cleaning, river care, and waste reduction are practical forms of worship.", "Clean one shared space this week.", "Start serving today", "seva"],
  ["Yatra Budgeting", "A peaceful pilgrimage is planned with honesty.", "Budgeting for travel, food, donation, and emergency needs reduces stress on the path.", "Plan one future yatra responsibly.", "Read pilgrimage guide", "travel-guide"],
  ["Breath and Prayer", "Breath can become a quiet mala.", "When breath slows, speech softens and awareness deepens.", "Take twelve slow breaths before sleep.", "Learn mindful breathing", "daily-practice"],
  ["Sacred Music", "Bhajan turns memory into devotion.", "A song can carry philosophy into the heart faster than argument.", "Listen and sing one bhajan fully.", "Explore devotional inspiration", "community"],
  ["Festival Seva", "The best festival decoration is kindness.", "Food distribution, cleaning, and helping visitors make celebration meaningful.", "Serve during the next festival.", "Explore service opportunities", "festival"],
  ["Monsoon Yatra Care", "Weather is part of the pilgrimage teacher.", "Rain asks for preparation, patience, and respect for nature's timing.", "Check weather and safety before travel.", "See travel checklist", "travel-guide"],
  ["Winter Pilgrimage", "Cold journeys ask for warmth in body and heart.", "Layering, rest, and humility keep winter yatra safe.", "Prepare one winter travel essential.", "Read travel tips", "travel-guide"],
  ["Sacred Photography", "A photo should preserve reverence, not disturb worship.", "Before capturing a sacred moment, ask whether the camera serves memory or ego.", "Take fewer, more mindful photos.", "Share your photo", "community"],
  ["Volunteer Spotlight", "Every platform of dharma is built by unseen hands.", "Volunteers carry the work forward through time, skill, and devotion.", "Offer one skill for service.", "Meet our volunteers", "seva"],
  ["Ritual Meaning", "Ritual is body language for the soul.", "Lighting a lamp, offering flowers, and folding hands train attention through action.", "Light a lamp with full awareness.", "Read about sacred rituals", "ritual"],
  ["Pilgrim Safety", "Safety protects the purpose of the journey.", "Good preparation, emergency contacts, and local respect keep yatra steady.", "Save one emergency contact before travel.", "See yatra safety tips", "travel-guide"],
  ["Dharma at Work", "Work can become worship when done with honesty.", "Duty, fairness, and focus are also spiritual practices.", "Do one task today without distraction.", "Explore mindful living", "daily-practice"],
  ["Gratitude Practice", "Gratitude turns ordinary life into prasad.", "Naming blessings trains the mind away from complaint and toward humility.", "Write three things you received today.", "Start daily gratitude", "daily-practice"],
  ["One Year Reflection", "A long journey is completed through small steps.", "Looking back helps us see how repeated practice slowly changes the heart.", "Choose the next step in your spiritual journey.", "Continue with Tirth Sutra", "welcome"],
  ["Renew Your Sankalp", "A sankalp gives direction to devotion.", "After a year of learning, choose one vow that can guide your next season.", "Write one clear spiritual intention.", "Begin the next journey", "daily-practice"],
];

function buildGeneratedWeek(theme) {
  const [title, inspiration, knowledge, action, ctaLabel, category] = theme;
  return {
    title,
    emails: [
      email("Inspiration", `${title}: A Gentle Reminder`, [
        inspiration,
        "Carry this thought lightly through the day and let it shape one small action.",
      ], {
        ctaLabel,
        category,
      }),
      email("Knowledge", `The Wisdom Behind ${title}`, [
        knowledge,
        "When we understand the meaning behind a practice, devotion becomes more steady and less mechanical.",
      ], {
        ctaLabel,
        category,
      }),
      email("Action", `Practice ${title} This Week`, [
        action,
        "Small, repeated actions build a spiritual life more reliably than rare moments of intensity.",
      ], {
        ctaLabel,
        category,
      }),
    ],
  };
}

function getEmailJourneyWeeks() {
  const weeks = customWeeks.concat(generatedThemes.map(buildGeneratedWeek));
  return weeks.slice(0, TOTAL_WEEKS);
}

function getEmailJourneyContent() {
  return getEmailJourneyWeeks().flatMap((week, weekIndex) =>
    week.emails.map((item, sequenceIndex) => ({
      ...item,
      campaignKey: CAMPAIGN_KEY,
      campaignName: CAMPAIGN_NAME,
      weekTitle: week.title,
      weekNumber: weekIndex + 1,
      sequenceInWeek: sequenceIndex + 1,
      contentIndex: weekIndex * EMAILS_PER_WEEK + sequenceIndex + 1,
      contentKey: `${CAMPAIGN_KEY}-w${String(weekIndex + 1).padStart(2, "0")}-e${sequenceIndex + 1}`,
    }))
  );
}

module.exports = {
  CAMPAIGN_KEY,
  CAMPAIGN_NAME,
  EMAILS_PER_WEEK,
  TOTAL_WEEKS,
  getEmailJourneyWeeks,
  getEmailJourneyContent,
};
