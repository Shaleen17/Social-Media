const HASHTAG_RE = /(^|\s)#([a-z0-9_]{2,40})/gi;

const REVIEW_PATTERNS = [
  {
    flag: "spam_phrase",
    pattern:
      /\b(?:free money|guaranteed profit|crypto giveaway|dm on telegram|click here now|limited time offer)\b/i,
  },
  {
    flag: "spam_contact",
    pattern:
      /\b(?:whatsapp me|telegram me|join my channel|message me privately|dm for details)\b/i,
  },
  {
    flag: "explicit_content",
    pattern: /\b(?:porn|xxx|nude|sex cam|onlyfans)\b/i,
  },
  {
    flag: "violent_language",
    pattern: /\b(?:kill you|shoot up|bomb threat|stab you)\b/i,
  },
  {
    flag: "hate_speech",
    pattern: /\b(?:racial slur|ethnic cleansing|genocide now)\b/i,
  },
];

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeHashtagTag(tag = "") {
  const normalized = String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9_]/g, "");

  return normalized ? `#${normalized}` : "";
}

function extractHashtags(...values) {
  const tags = new Set();

  values
    .flat()
    .filter(Boolean)
    .forEach((value) => {
      const source = String(value || "");
      let match;
      while ((match = HASHTAG_RE.exec(source)) !== null) {
        const normalized = normalizeHashtagTag(match[2]);
        if (normalized) tags.add(normalized);
      }
      HASHTAG_RE.lastIndex = 0;
    });

  return Array.from(tags).slice(0, 24);
}

function buildSearchText(...values) {
  return values
    .flat()
    .filter(Boolean)
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ")
    .slice(0, 8000);
}

function moderateTextContent(values = [], options = {}) {
  const rawValues = Array.isArray(values) ? values : [values];
  const text = buildSearchText(rawValues);
  const hashtags = extractHashtags(rawValues, options.extraHashtags || []);
  const flags = new Set();
  const matchedTerms = [];
  const lower = text.toLowerCase();
  const links = text.match(/https?:\/\/\S+/gi) || [];
  const mentions = text.match(/@\w+/g) || [];
  const emojis = text.match(/[\u{1F300}-\u{1FAFF}]/gu) || [];

  if (hashtags.length >= 12) {
    flags.add("hashtag_stuffing");
  }

  if (links.length >= 3) {
    flags.add("spam_links");
  }

  if (mentions.length >= 8) {
    flags.add("mention_spam");
  }

  if (emojis.length >= 20) {
    flags.add("emoji_flood");
  }

  REVIEW_PATTERNS.forEach(({ flag, pattern }) => {
    if (pattern.test(lower)) {
      flags.add(flag);
      matchedTerms.push(flag);
    }
  });

  if (/(.)\1{10,}/.test(lower)) {
    flags.add("repetitive_text");
  }

  if (/(https?:\/\/\S+).*\1/i.test(text)) {
    flags.add("duplicate_links");
  }

  if (lower.length >= 2000 && lower.split(/\s+/).length < 40) {
    flags.add("low_entropy_text");
  }

  const reviewFlags = Array.from(flags);
  const status = reviewFlags.length ? "needs_review" : "approved";

  return {
    status,
    score: Math.min(1, reviewFlags.length * 0.3),
    flags: reviewFlags,
    matchedTerms,
    hashtags,
    searchText: buildSearchText(text, hashtags.join(" ")),
    reviewedAt: new Date(),
  };
}

function moderateMediaAsset(asset = {}) {
  const flags = new Set();
  const mimeType = String(asset.mimeType || "").toLowerCase();
  const name = normalizeText(asset.name || "");
  const size = Math.max(0, Number(asset.size) || 0);
  const duration = Math.max(0, Number(asset.duration) || 0);

  if (size >= 40 * 1024 * 1024) {
    flags.add("oversized_asset");
  }

  if (mimeType.startsWith("video/") && duration >= 30 * 60) {
    flags.add("long_form_video");
  }

  if (mimeType === "application/octet-stream") {
    flags.add("unclassified_upload");
  }

  if (/\b(?:torrent|keygen|crack)\b/i.test(name)) {
    flags.add("suspicious_filename");
  }

  const reviewFlags = Array.from(flags);
  return {
    status: reviewFlags.length ? "needs_review" : "approved",
    score: Math.min(1, reviewFlags.length * 0.35),
    flags: reviewFlags,
    reviewedAt: new Date(),
  };
}

function mergeModerationSignals(...signals) {
  const items = signals.filter(Boolean);
  const flags = Array.from(
    new Set(items.flatMap((item) => (Array.isArray(item.flags) ? item.flags : [])))
  );
  const score = items.reduce(
    (max, item) => Math.max(max, Number(item.score) || 0),
    0
  );

  return {
    status: flags.length ? "needs_review" : "approved",
    score,
    flags,
    reviewedAt: new Date(),
  };
}

module.exports = {
  buildSearchText,
  extractHashtags,
  mergeModerationSignals,
  moderateMediaAsset,
  moderateTextContent,
  normalizeHashtagTag,
  normalizeText,
};
