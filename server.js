require('dotenv').config();
const express = require('express');
const NodeCache = require('node-cache');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(express.json());
app.set('trust proxy', 1);

// ── CORS ──
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── SUPABASE ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── ADMIN ──
function adminOnly(req, res, next) {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ────────────────────────────────────────
//  HEALTH CHECK
// ────────────────────────────────────────
app.get('/', function(req, res) {
  res.json({ status: 'JisScroL API is running' });
});

// ────────────────────────────────────────
//  OPINIONS
// ────────────────────────────────────────

// GET /opinions/:post_id
app.get('/opinions/:post_id', async function(req, res) {
  const { data, error } = await supabase
    .from('opinions')
    .select('id, text, time, username, user_id, tier')
    .eq('post_id', req.params.post_id)
    .order('time', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /opinion
app.post('/opinions', async function(req, res) {
  const { post_id, text, username, user_id } = req.body;
  
  if (!post_id || !text || text.trim() === '') {
    return res.status(400).json({ error: 'post_id and text required' });
  }

  let tier = null;
  
  // Calculate tier if user_id exists
  if (user_id) {
    const { data: visitData } = await supabase
      .from('visits')
      .select('id')
      .eq('user_id', user_id);

    const count = visitData ? visitData.length : 0;
    if (count >= 365) tier = 'veteran';
    else if (count >= 30) tier = 'loyal';
    else if (count >= 7) tier = 'regular';
  }

  const cleanText = text.replace(/<[^>]*>/g, '').trim();
  if (cleanText.length > 300) {
    return res.status(400).json({ error: 'Max 300 chars' });
  }

  const { data, error } = await supabase
    .from('opinions')
    .insert([{ 
      post_id, 
      text: cleanText, 
      username,
      user_id,
      tier  // ← Add tier to insert
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data[0].id, tier });
});

// ── GET /admin/articles ──
app.get('/admin/articles', adminOnly, async function(req, res) {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /admin/opinions/:id
app.delete('/admin/opinions/:id', adminOnly, async function(req, res) {
  const { error } = await supabase
    .from('opinions')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET /admin/opinions
app.get('/admin/opinions', adminOnly, async function(req, res) {
  const { data, error } = await supabase
    .from('opinions')
    .select('*')
    .order('time', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ────────────────────────────────────────
//  RATINGS
// ────────────────────────────────────────

// GET /ratings/:post_id
app.get('/ratings/:post_id', async function(req, res) {
  const post_id = req.params.post_id;

  const { count: good } = await supabase
    .from('ratings')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', post_id)
    .eq('vote', 'good');

  const { count: bad } = await supabase
    .from('ratings')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', post_id)
    .eq('vote', 'bad');

  const total = (good || 0) + (bad || 0);

  res.json({
    good: good || 0,
    bad: bad || 0,
    total: total,
    goodPct: total ? Math.round(((good || 0) / total) * 100) : 50,
    badPct: total ? Math.round(((bad || 0) / total) * 100) : 50
  });
});

// POST /ratings
app.post('/ratings', async function(req, res) {
  const { post_id, vote } = req.body;

  if (!post_id || (vote !== 'good' && vote !== 'bad')) {
    return res.status(400).json({ error: 'Invalid' });
  }

  const { error } = await supabase
    .from('ratings')
    .insert([{ post_id, vote }]);

  if (error) return res.status(500).json({ error: error.message });

  const { count: good } = await supabase
    .from('ratings')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', post_id)
    .eq('vote', 'good');

  const { count: bad } = await supabase
    .from('ratings')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', post_id)
    .eq('vote', 'bad');

  const total = (good || 0) + (bad || 0);

  res.json({
    good: good || 0,
    bad: bad || 0,
    total: total
  });
});

// ── POST /visit ──
app.post('/visit', async function(req, res) {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // log the visit
  await supabase
    .from('visits')
    .upsert([{ user_id, visit_date: new Date().toISOString().split('T')[0] }], {
      onConflict: 'user_id,visit_date',
      ignoreDuplicates: true,
    });

  const { data, error } = await supabase
    .from('visits')
    .select('id')
    .eq('user_id', user_id);

  var count = data ? data.length : 0;
  // calculate tier
  var tier = null;
  if (count >= 365) tier = 'veteran';
  else if (count >= 30) tier = 'loyal';
  else if (count >= 7)  tier = 'regular';

  res.json({ visit_days: count, tier: tier });
});

// ─────────────────────────────────────────
//  MEDIA TYPE DETECTION
// ─────────────────────────────────────────
// Classifies a stored img/img2 URL so clients (web + Android) never have
// to sniff URLs themselves.
//
// classifyMedia() returns:
//   { type: 'image' | 'video' | 'embed', url, provider, embedUrl }
// - provider / embedUrl are only set for type 'embed'
// - clients add their own autoplay/mute params (and Twitch's `parent`)
//
// withMediaTypes() adds:
//   media[]               → new normalized shape (Android + updated web)
//   img_type / img2_type  → legacy vocabulary ('img' | 'video' | 'embed')
//                           so the old web frontend keeps working

const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|3gp|m3u8|mpd|ts)$/i;

function toEmbed(url) {
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const seg = url.pathname.split('/').filter(Boolean);
  let m;

  // YouTube
  if (['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const id =
      host === 'youtu.be' ? seg[0]
      : url.pathname === '/watch' ? url.searchParams.get('v')
      : (m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)) && m[1];
    if (!id || !/^[\w-]+$/.test(id)) return null;
    const e = new URL('https://www.youtube-nocookie.com/embed/' + id);
    const t = url.searchParams.get('start') || url.searchParams.get('t');
    if (t && /^\d+$/.test(t)) e.searchParams.set('start', t);
    return { provider: 'youtube', embedUrl: e.href };
  }

  // Vimeo
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    m = url.pathname.match(/^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/);
    return m ? { provider: 'vimeo', embedUrl: 'https://player.vimeo.com/video/' + m[1] } : null;
  }

  // Dailymotion
  if (host === 'dailymotion.com' || host === 'dai.ly') {
    const id = host === 'dai.ly'
      ? seg[0]
      : (m = url.pathname.match(/^\/(?:video|embed\/video)\/([^_/?]+)/)) && m[1];
    return id ? { provider: 'dailymotion', embedUrl: 'https://www.dailymotion.com/embed/video/' + id } : null;
  }

  // TikTok
  if (host === 'tiktok.com') {
    m = url.pathname.match(/^\/@[^/]+\/video\/(\d+)/) || url.pathname.match(/^\/embed\/v2\/(\d+)/);
    return m ? { provider: 'tiktok', embedUrl: 'https://www.tiktok.com/embed/v2/' + m[1] } : null;
  }

  // Instagram
  if (host === 'instagram.com') {
    m = url.pathname.match(/^\/(reel|p|tv)\/([\w-]+)/);
    return m ? { provider: 'instagram', embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed/` } : null;
  }

  // Facebook
  if (host === 'facebook.com' || host === 'fb.watch') {
    // already an embed URL → use it as-is (don't wrap it a second time)
    if (host === 'facebook.com' && url.pathname === '/plugins/video.php') {
      return { provider: 'facebook', embedUrl: url.href };
    }
    if (host === 'facebook.com') {
      const isVideo =
        url.pathname.replace(/\/+$/, '') === '/watch' ||
        /^\/(?:reel|videos)\/[\w.-]+/.test(url.pathname) ||
        /^\/share\/(?:v|r)\/[\w.-]+/.test(url.pathname) ||
        /^\/[\w.-]+\/videos\/[\w.-]+/.test(url.pathname);
      if (!isVideo) return null;
    }
    const e = new URL('https://www.facebook.com/plugins/video.php');
    e.searchParams.set('href', url.href);
    e.searchParams.set('show_text', '0');
    return { provider: 'facebook', embedUrl: e.href };
  }

  // Twitch (client must append &parent=<its host>)
  if (['twitch.tv', 'clips.twitch.tv', 'player.twitch.tv'].includes(host)) {
    const e = new URL('https://player.twitch.tv/');
    if (host === 'player.twitch.tv') {
      ['video', 'clip', 'channel'].forEach(function (k) {
        const v = url.searchParams.get(k);
        if (v) e.searchParams.set(k, v);
      });
      if (![...e.searchParams.keys()].length) return null;
    } else if (host === 'clips.twitch.tv') {
      if (!seg[0]) return null;
      e.searchParams.set('clip', seg[0]);
    } else if ((m = url.pathname.match(/^\/videos\/(\d+)/))) {
      e.searchParams.set('video', m[1]);
    } else if ((m = url.pathname.match(/^\/[^/]+\/clip\/([^/]+)/))) {
      e.searchParams.set('clip', m[1]);
    } else if (seg.length === 1) {
      e.searchParams.set('channel', seg[0]);
    } else {
      return null;
    }
    return { provider: 'twitch', embedUrl: e.href };
  }

  // Streamable
  if (host === 'streamable.com') {
    m = url.pathname.match(/^\/(?:e\/)?([\w-]+)/);
    return m ? { provider: 'streamable', embedUrl: 'https://streamable.com/e/' + m[1] } : null;
  }

  return null;
}

function classifyMedia(src, declaredType) {
  if (!src || typeof src !== 'string') return null;
  src = src.trim();
  if (!src) return null;

  const declared = (declaredType || '').toLowerCase();
  const declaredVideo = declared === 'video' || declared.startsWith('video/');
  const media = function (type) {
    return { type: type, url: src, provider: null, embedUrl: null };
  };

  // data: URIs (inline images / videos)
  if (/^data:/i.test(src)) {
    if (/^data:video\//i.test(src)) return media('video');
    if (/^data:image\//i.test(src)) return media('image');
    return null;
  }

  // Absolute URL?
  let url = null;
  try { url = new URL(src); } catch (e) { url = null; }

  if (url) {
    if (!/^https?:$/.test(url.protocol)) return null; // blocks javascript:, ftp:, etc.

    const embed = toEmbed(url);
    if (embed) return { type: 'embed', url: src, provider: embed.provider, embedUrl: embed.embedUrl };

    return (declaredVideo || VIDEO_EXT.test(url.pathname)) ? media('video') : media('image');
  }

  // Relative or protocol-less path ("/vids/a.mp4", "videos/a.mp4", "//cdn.site/a.mp4"):
  // can't be an embed, so judge by declared type / file extension on the raw path.
  const path = src.split(/[?#]/)[0];
  return (declaredVideo || VIDEO_EXT.test(path)) ? media('video') : media('image');
}

function withMediaTypes(article) {
  const m1 = classifyMedia(article.img, article.img_type);
  const m2 = classifyMedia(article.img2, article.img2_type);

  // old frontend vocabulary: "img" | "video" | "embed"
  const legacy = m => (m ? (m.type === 'image' ? 'img' : m.type) : null);

  return {
    ...article,
    img_type: legacy(m1),
    img2_type: legacy(m2),
    media: [m1, m2].filter(Boolean),
  };
}

// ─────────────────────────────────────────
//  ARTICLES
// ─────────────────────────────────────────
app.get('/articles', async function(req, res) {
    var category = req.query.category;

    if (!category) return res.status(400).json({ error: 'category required' });

    // HOME — all categories, recency first
    if (category === 'trends') {
        const { data, error } = await supabase
            .from('articles')
            .select('*');

        if (error) return res.status(500).json({ error: error.message });

        const scored = data.map(article => {
            const now = Date.now();
            const created = new Date(article.created_at).getTime();
            const daysSincePost = (now - created) / (1000 * 60 * 60 * 24);

            const recencyScore = 100 * Math.exp(-daysSincePost / 7);
            const engagementBonus =
                (article.comment_count || 0) * 2 +
                (article.like_count || 0) * 1.5;

            const baseScore = recencyScore + engagementBonus;
            const randomFactor = (Math.random() - 0.5) * 0.2;

            return { ...article, _score: baseScore * (1 + randomFactor) };
        });

        return res.json(scored.sort((a, b) => b._score - a._score).map(withMediaTypes));
    }

    // TRENDS — newpage focused, others mixed in, engagement scored
    if (category === 'newpage') {
        const { data, error } = await supabase
            .from('articles')
            .select('*');

        if (error) return res.status(500).json({ error: error.message });

        const scored = data.map(article => {
            const engagementScore =
                (article.comment_count || 0) * 3 +
                (article.like_count || 0) * 2;

            // newpage articles get priority boost
            const categoryBonus = article.category === 'newpage' ? 50 : 0;

            const randomFactor = (Math.random() - 0.5) * 0.4;

            return { ...article, _score: (engagementScore + categoryBonus) * (1 + randomFactor) };
        });

        return res.json(scored.sort((a, b) => b._score - a._score).map(withMediaTypes));
    }

    // SPORTS — sports only, recency scored
    const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('category', category);

    if (error) return res.status(500).json({ error: error.message });

    const scored = data.map(article => {
        const now = Date.now();
        const created = new Date(article.created_at).getTime();
        const daysSincePost = (now - created) / (1000 * 60 * 60 * 24);

        const recencyScore = 100 * Math.exp(-daysSincePost / 7);
        const engagementBonus =
            (article.comment_count || 0) * 2 +
            (article.like_count || 0) * 1.5;

        const baseScore = recencyScore + engagementBonus;
        const randomFactor = (Math.random() - 0.5) * 0.2;

        return { ...article, _score: baseScore * (1 + randomFactor) };
    });

    return res.json(scored.sort((a, b) => b._score - a._score).map(withMediaTypes));
});

// ─────────────────────────────────────────
//  SHARE PREVIEW  (/share/:id → OG tags, then redirect to the frontend)
// ─────────────────────────────────────────
const FRONTEND = 'https://jisscroln.vercel.app';
const DEFAULT_IMG = FRONTEND + '/pics/share-default.png'; // 1200x630, under 300 KB
const SITE_NAME = 'JiScroL';
const THEME_COLOR = '#6ea0c9';
const TWITTER_HANDLE = '';
const FALLBACK_DESC = 'Tap to read the full story and join the conversation on JiScroL.';

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const qs = (v) => String(Array.isArray(v) ? v[0] : (v || ''));

function clip(s, n) {
  s = String(s || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function safeImage(u) {
  try {
    const url = new URL(u, FRONTEND);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : DEFAULT_IMG;
  } catch (e) {
    return DEFAULT_IMG;
  }
}

// Cloudinary serves a 1200x630 copy, which gives WhatsApp the big card
function shrinkImage(u) {
  return u.includes('res.cloudinary.com') && u.includes('/upload/')
    ? u.replace('/upload/', '/upload/w_1200,h_630,c_fill,g_auto,q_auto,f_jpg/')
    : u;
}

function imageType(u) {
  const p = u.split('?')[0].toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

app.get('/share/:id', async function (req, res) {
  const id = req.params.id;
  let title = 'The JiScroL';
  let desc = FALLBACK_DESC;
  let image = DEFAULT_IMG;
  let target = FRONTEND + '/comments/?post_id=' + encodeURIComponent(id);
  let shareUrl = FRONTEND + '/share/' + encodeURIComponent(id);
  let published = '';
  let section = '';

  try {
    if (req.query.news === 'uganda') {
      title = qs(req.query.headline) || title;
      desc = clip(qs(req.query.content), 200) || desc;
      image = qs(req.query.image) || image;
      const q = new URLSearchParams(req.query).toString();
      target = FRONTEND + '/comments/?' + q;
      shareUrl = shareUrl + '?' + q;
    } else {
      const { data, error } = await supabase
        .from('articles').select('*').eq('id', id).single();

      if (!error && data) {
        const article = withMediaTypes(data);
        title = article.headline || title;
        desc = clip(article.body, 200) || desc;
        const img = (article.media || []).find(function (m) { return m.type === 'image'; });
        image = (img && img.url) || article.thumbnail || article.thumbnail_url || image;
        section = article.category || '';
        const d = new Date(article.created_at);
        if (!isNaN(d.getTime())) published = d.toISOString();
      }
    }
  } catch (err) {
    console.error('share lookup failed:', err.message);
  }

  title = clip(title, 100);
  image = safeImage(image);
  const isDefault = image === DEFAULT_IMG;
  image = shrinkImage(image);
  const knownSize = isDefault || image.includes('w_1200,h_630');
  const ogType = image.includes('f_jpg') ? 'image/jpeg' : imageType(image);
  const alt = title;

  const tags = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(desc) + '">',
    '<meta name="robots" content="noindex">',
    '<meta name="theme-color" content="' + THEME_COLOR + '">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="' + esc(SITE_NAME) + '">',
    '<meta property="og:url" content="' + esc(shareUrl) + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:image" content="' + esc(image) + '">',
    '<meta property="og:image:secure_url" content="' + esc(image) + '">',
    '<meta property="og:image:type" content="' + ogType + '">',
    '<meta property="og:image:alt" content="' + esc(alt) + '">',
    '<meta property="og:locale" content="en_US">'
  ];

  if (knownSize) {
    tags.push('<meta property="og:image:width" content="1200">');
    tags.push('<meta property="og:image:height" content="630">');
  }
  if (published) tags.push('<meta property="article:published_time" content="' + esc(published) + '">');
  if (section) tags.push('<meta property="article:section" content="' + esc(section) + '">');

  tags.push('<meta name="twitter:card" content="summary_large_image">');
  tags.push('<meta name="twitter:title" content="' + esc(title) + '">');
  tags.push('<meta name="twitter:description" content="' + esc(desc) + '">');
  tags.push('<meta name="twitter:image" content="' + esc(image) + '">');
  tags.push('<meta name="twitter:image:alt" content="' + esc(alt) + '">');
  if (TWITTER_HANDLE) tags.push('<meta name="twitter:site" content="' + esc(TWITTER_HANDLE) + '">');

  const redirectJs = JSON.stringify(target).replace(/</g, '\\u003c');

  res.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  res.type('html').send(
    '<!DOCTYPE html><html lang="en"><head>' + tags.join('') + '</head><body>' +
    '<script>location.replace(' + redirectJs + ');</script>' +
    '<a href="' + esc(target) + '">Continue to ' + esc(SITE_NAME) + '</a>' +
    '</body></html>'
  );
});

// ─────────────────────────────────────────
//  DISCOVER  (keywords taken straight from article text)
// ─────────────────────────────────────────
function dcShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DC_STOP = new Set((
  'the and for that with this from have has had was were are been will would could should about after before ' +
  'into over than then them they their there these those what when where which while who whom whose your you ' +
  'our out not but all any can its also more most other some such only own same too very just said says say ' +
  'him her his she how why new now one two get got let may might must per via off because between during ' +
  'each few both again here against above below once according told year years day days time week ' +
  'monday tuesday wednesday thursday friday saturday sunday january february march april june july august ' +
  'september october november december mr mrs ms dr hon sir gen prof president minister news read more ' +
  'share comment comments follow like people government police officials'
).split(' '));

const DC_CAPS_STOP = new Set(['THE', 'AND', 'FOR', 'NEW', 'NOT', 'ALL', 'BUT', 'HOW', 'WHY', 'WHO', 'NOW']);

function dcClean(t) {
  return String(t || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// returns Map(slug -> text exactly as written in the article)
function dcExtract(text, isHeadline) {
  const clean = dcClean(text);
  const out = new Map();
  if (!clean) return out;

  const letters = clean.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  const allCaps = letters.length > 0 && upper / letters.length > 0.6;

  if (!allCaps) {
    // acronyms: NSSF, URA
    (clean.match(/\b[A-Z]{2,6}\b/g) || []).forEach(function (a) {
      if (!DC_CAPS_STOP.has(a)) out.set(a.toLowerCase(), a);
    });

    // names: Nvidia, Stanbic Bank, Yoweri Museveni
    const re = /\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,}){0,2}\b/g;
    let m;
    while ((m = re.exec(clean))) {
      const words = m[0].split(' ');
      while (words.length && DC_STOP.has(words[0].toLowerCase())) words.shift();
      while (words.length && DC_STOP.has(words[words.length - 1].toLowerCase())) words.pop();
      if (!words.length) continue;

      const before = clean.slice(0, m.index).trimEnd();
      const sentenceStart = before === '' || /[.!?:]$/.test(before);
      if (words.length === 1 && sentenceStart && m[0] === words[0]) continue;

      const name = words.join(' ');
      if (name.length < 4) continue;
      out.set(name.toLowerCase(), name);
    }
  }

  // plain words, headline only
  if (isHeadline) {
    (clean.match(/[A-Za-z]{4,}/g) || []).forEach(function (w) {
      const slug = w.toLowerCase();
      if (DC_STOP.has(slug) || out.has(slug)) return;
      out.set(slug, w);
    });
  }

  return out;
}

function dcContains(article, slug) {
  const re = new RegExp('\\b' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  return re.test(dcClean(article.headline) + ' ' + dcClean(article.body));
}

let dcCache = { at: 0, index: null, byId: null };
const DC_TTL = 10 * 60 * 1000;

async function dcGetIndex() {
  if (dcCache.index && Date.now() - dcCache.at < DC_TTL) return dcCache;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);

  const byId = {};
  const index = {};

  function add(slug, text, id, weight) {
    if (!index[slug]) index[slug] = { forms: {}, score: 0, ids: [] };
    const e = index[slug];
    e.forms[text] = (e.forms[text] || 0) + 1;
    e.score += weight;
    if (e.ids.indexOf(id) === -1) e.ids.push(id);
  }

  data.forEach(function (article) {
    byId[article.id] = article;
    dcExtract(article.headline, true).forEach(function (text, slug) { add(slug, text, article.id, 3); });
    dcExtract(article.body, false).forEach(function (text, slug) { add(slug, text, article.id, 1); });
  });

  // must appear in 2+ articles, but not in almost all of them
  const maxShare = Math.max(5, data.length * 0.4);
  Object.keys(index).forEach(function (slug) {
    const n = index[slug].ids.length;
    if (n < 2 || n > maxShare) delete index[slug];
  });

  // drop "stanbic" when "stanbic bank" covers nearly the same articles
  const slugs = Object.keys(index);
  slugs.forEach(function (short) {
    slugs.forEach(function (long) {
      if (short !== long && index[short] && index[long] &&
          long.split(' ').indexOf(short) !== -1 &&
          index[long].ids.length >= index[short].ids.length * 0.8) {
        delete index[short];
      }
    });
  });

  // display text = the form most often written in the articles
  Object.keys(index).forEach(function (slug) {
    const forms = index[slug].forms;
    index[slug].name = Object.keys(forms).sort(function (a, b) { return forms[b] - forms[a]; })[0];
  });

  console.log('discover: scanned', data.length, 'articles, kept', Object.keys(index).length, 'keywords');
  dcCache = { at: Date.now(), index: index, byId: byId };
  return dcCache;
}

app.get('/articles/discover', async function (req, res) {
  try {
    res.set('Cache-Control', 'no-store');
    const { index, byId } = await dcGetIndex();

    // ?term=nssf -> only articles that really contain it, shuffled
    const rawTerm = qs(req.query.term);
    if (rawTerm) {
      const slug = String(rawTerm).toLowerCase().trim().replace(/^#/, '');
      const entry = index[slug];
      if (!entry) return res.status(404).json({ error: 'keyword not found', term: slug });

      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      const matched = entry.ids
        .map(function (id) { return byId[id]; })
        .filter(function (row) { return dcContains(row, slug); });

      const articles = dcShuffle(matched).slice(0, limit).map(function (row) {
        const out = withMediaTypes(row);
        out.snippet = clip(row.body, 200);
        delete out.body;
        out.link = FRONTEND + '/comments/?post_id=' + encodeURIComponent(row.id);
        return out;
      });

      return res.json({ keyword: entry.name, total: matched.length, articles: articles });
    }

    // no term -> keyword chips
    const pool = Object.keys(index)
      .map(function (slug) {
        return {
          keyword: slug,
          name: index[slug].name,
          count: index[slug].ids.length,
          score: index[slug].score
        };
      })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 40);

    const limit = Math.min(parseInt(req.query.limit, 10) || 15, 40);
    return res.json(dcShuffle(pool).slice(0, limit));
  } catch (err) {
    console.error('discover crashed:', err);
    return res.status(500).json({ error: err.message });
  }
});
app.get('/stories', async function(req, res) {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /charts ──
app.get('/charts', async function(req, res) {
  const { data, error } = await supabase
    .from('charts')
    .select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /songs ──
app.get('/songs', async function(req, res) {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .order('rank', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /tickers ──
app.get('/tickers', async function(req, res) {
  const { data, error } = await supabase
    .from('tickers')
    .select('text')
    .eq('active', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /polls ──
app.get('/polls', async function(req, res) {
  const { data, error } = await supabase
    .from('polls')
    .select('*')
    .order('id', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PUT /admin/polls/:id ──
app.put('/admin/polls/:id', adminOnly, async function(req, res) {
  const { id } = req.params;
  const { img, text } = req.body;

  const updates = {};
  if (img  !== undefined) updates.img  = img;
  if (text !== undefined) updates.text = text;

  const { error } = await supabase
    .from('polls')
    .update(updates)
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /admin/articles ──
app.post('/admin/articles', adminOnly, async function(req, res) {
  const { id, category, label, headline, img, img2, body, time, link, read_link, read_text } = req.body;
  if (!category || !headline) return res.status(400).json({ error: 'category and headline required' });

  const { error } = await supabase
    .from('articles')
    .insert([{ id, category, label, headline, img, img2, body, time, link, read_link, read_text }]);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── DELETE /admin/articles/:id ──
app.delete('/admin/articles/:id', adminOnly, async function(req, res) {
  const { error } = await supabase.from('articles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /admin/stories ──
app.post('/admin/stories', adminOnly, async function(req, res) {
  const { id, cat, badge, cc, title, snippet, body, img, author, initials, time, read_time } = req.body;
  if (!id || !title) return res.status(400).json({ error: 'id and title required' });
  const { error } = await supabase.from('stories').insert([{ id, cat, badge, cc, title, snippet, body, img, author, initials, time, read_time }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /admin/tickers ──
app.post('/admin/tickers', adminOnly, async function(req, res) {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const { error } = await supabase.from('tickers').insert([{ text }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── DELETE /admin/tickers/:id ──
app.delete('/admin/tickers/:id', adminOnly, async function(req, res) {
  const { error } = await supabase.from('tickers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── PUT /admin/charts/:id ──
app.put('/admin/charts/:id', adminOnly, async function(req, res) {
  const { img, link } = req.body;
  const { error } = await supabase.from('charts').update({ img, link }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /admin/songs ──
app.post('/admin/songs', adminOnly, async function(req, res) {
  const { rank, trend, name, artist, days, img } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { error } = await supabase.from('songs').insert([{ rank, trend, name, artist, days, img }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── DELETE /admin/songs/:id ──
app.delete('/admin/songs/:id', adminOnly, async function(req, res) {
  const { error } = await supabase.from('songs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────
//  SEARCH
// ─────────────────────────────────────────
function searchTerms(q) {
  return String(q || '')
    .split(/\s+/)
    .map(function (t) { return t.replace(/[,()"'\\%_*]/g, '').trim(); })
    .filter(Boolean)
    .slice(0, 5);
}

// each word must appear in at least one of the columns (any case, partial words OK)
function matchAll(query, cols, terms) {
  terms.forEach(function (t) {
    query = query.or(cols.map(function (c) { return c + '.ilike.*' + t + '*'; }).join(','));
  });
  return query;
}

function rows(label, result) {
  if (result.error) console.error('search ' + label + ':', result.error.message);
  return result.data || [];
}

app.get('/search', async function (req, res) {
  var terms = searchTerms(req.query.q);
  if (!terms.length) return res.json({ articles: [], stories: [], songs: [] });

  const [articles, stories, songs] = await Promise.all([
    // select only columns that always exist (img_type / img2_type may not be real columns);
    // withMediaTypes() works out image/video from the URL itself
    matchAll(
      supabase.from('articles')
        .select('id, category, headline, img, img2, time')
        .limit(20),
      ['headline', 'category', 'body'], terms),
    matchAll(
      supabase.from('stories')
        .select('id, title, snippet, img, cat')
        .limit(20),
      ['title', 'snippet', 'cat'], terms),
    matchAll(
      supabase.from('songs')
        .select('id, name, artist, img, rank')
        .limit(20),
      ['name', 'artist'], terms)
  ]);

  res.json({
    articles: rows('articles', articles).map(withMediaTypes),
    stories:  rows('stories', stories),
    songs:    rows('songs', songs)
  });
});

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;

const COMPETITIONS = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function footballGet(path) {
  const res = await fetch('https://api.football-data.org/v4' + path, {
    headers: { 'X-Auth-Token': FOOTBALL_API_KEY }
  });
  if (!res.ok) throw new Error(res.status + ' ' + path);
  return res.json();
}

async function fetchMatches() {
  const results = await Promise.allSettled(
    COMPETITIONS.map((c) => footballGet(`/competitions/${c}/matches?dateFrom=${day(-4)}&dateTo=${day(4)}`))
  );
  results.forEach((r, i) => {

    if (r.status === 'fulfilled') cache.set('fm_' + COMPETITIONS[i], r.value.matches || [], 0);
    else console.error('Football matches failed:', COMPETITIONS[i], r.reason.message);
  });
}

function splitMatches() {
  const all = COMPETITIONS.flatMap((c) => cache.get('fm_' + c) || []);
  const t = (m) => new Date(m.utcDate).getTime();
  return {
    live: all.filter((m) => ['IN_PLAY', 'PAUSED'].includes(m.status)).sort((a, b) => t(a) - t(b)),
    upcoming: all.filter((m) => ['SCHEDULED', 'TIMED'].includes(m.status)).sort((a, b) => t(a) - t(b)),
    played: all.filter((m) => m.status === 'FINISHED').sort((a, b) => t(b) - t(a))
  };
}

function nextMatchDelay() {
  const { live, upcoming } = splitMatches();
  if (live.length) return 60 * 1000;                          // a match is on: every minute (6 calls)
  const soon = upcoming.some((m) => new Date(m.utcDate) - Date.now() < 30 * 60 * 1000);
  return soon ? 5 * 60 * 1000 : 30 * 60 * 1000;               // kickoff close: 5 min, else 30 min
}

async function matchLoop() {
  try { await fetchMatches(); } catch (e) { console.error('Football loop:', e.message); }
  setTimeout(matchLoop, nextMatchDelay());
}
matchLoop();

async function fetchStandings() {
  for (const c of COMPETITIONS) {
    try { cache.set('fs_' + c, await footballGet(`/competitions/${c}/standings`), 0); }
    catch (e) { console.error('Standings failed:', e.message); }
    await sleep(7000);
  }
}
setTimeout(function standingsLoop() {
  fetchStandings().finally(() => setTimeout(standingsLoop, 3600000));
}, 65000);

app.get('/footstat', (req, res) => {
  const { live, upcoming, played } = splitMatches();
  res.json({
    live,
    upcoming,
    played: played.slice(0, 30),
    matches: upcoming,   
    delayed: true        
  });
});

app.get('/standings', (req, res) => {
  res.json({ standings: COMPETITIONS.map((c) => cache.get('fs_' + c)).filter(Boolean) });
});

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const SPORTS_NEWS_QUERY = 'sports OR football OR basketball OR tennis OR athletics';
const PREMIER_LEAGUE_CLUBS = [
  'arsenal',
  'chelsea',
  'liverpool',
  'man city',
  'manchester united',
  'tottenham',
  'newcastle',
  'aston villa',
  'west ham',
  'brighton'
];
const BLOCKED_SPORTS_TERMS = ['nfl', 'nba', 'cricket', 'rugby', 'casino', 'betting odds'];

const NEWS_QUERIES = [
  'Uganda',
  'Africa NOT Uganda',
  'technology OR AI',
  'Africa AND technology',
  SPORTS_NEWS_QUERY
];

function newsArticle(article) {
  return {
    title: article.title,
    source: article.source && article.source.name,
    image: article.urlToImage,
    link: article.url,
    popularity: article.description || '',
    publishedAt: article.publishedAt
  };
}

function isRelevantSportsArticle(article) {
  const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();
  if (BLOCKED_SPORTS_TERMS.some(term => text.includes(term))) return false;
  return text.includes('premier league') || PREMIER_LEAGUE_CLUBS.some(club => text.includes(club));
}

function normalizedNewsUrl(link) {
  try {
    const url = new URL(link);
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch (e) {
    return String(link || '').trim();
  }
}

function normalizedNewsTitle(title) {
  return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function dedupeNewsArticles(articles, existingUrls, existingTitles) {
  const urls = new Set(existingUrls || []);
  const titles = new Set(existingTitles || []);
  return articles.filter(article => {
    const url = normalizedNewsUrl(article.link);
    const title = normalizedNewsTitle(article.title);
    if (!url || !title || urls.has(url) || titles.has(title)) return false;
    urls.add(url);
    titles.add(title);
    return true;
  });
}

async function storeSportsNews(articles) {
  const { data: existing, error: selectError } = await supabase
    .from('articles')
    .select('link, headline');

  if (selectError) throw selectError;

  const fresh = dedupeNewsArticles(
    articles,
    (existing || []).map(article => normalizedNewsUrl(article.link)),
    (existing || []).map(article => normalizedNewsTitle(article.headline))
  );
  if (!fresh.length) return 0;

  const rows = fresh.map(article => ({
    category: 'newpage',
    headline: article.title,
    body: article.popularity,
    img: article.image,
    time: article.publishedAt,
    link: article.link
  }));
  const { error: insertError } = await supabase.from('articles').insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}

async function fetchNews() {
  try {
    const results = await Promise.all(NEWS_QUERIES.map(async (q) => {
      const pageSize = q === SPORTS_NEWS_QUERY ? 30 : 10;
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=${pageSize}&apiKey=${NEWS_API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('NewsAPI returned ' + response.status);
      const data = await response.json();
      if (data.status !== 'ok') throw new Error(data.message || 'NewsAPI request failed');

      return (data.articles || [])
        .filter(a => a.title && a.url && a.title !== '[Removed]')
        .filter(a => q !== SPORTS_NEWS_QUERY || isRelevantSportsArticle(a))
        .map(newsArticle);
    }));

    const sportsArticles = dedupeNewsArticles(
      results[NEWS_QUERIES.indexOf(SPORTS_NEWS_QUERY)]
    );
    if (sportsArticles.length) {
      try {
        const stored = await storeSportsNews(sportsArticles);
        console.log(`Stored ${stored} new Premier League news articles`);
      } catch (e) {
        console.error('Sports news storage error:', e.message);
      }
      cache.set('news_sports', sportsArticles, 0);
    }

    const mixed = [];
    const seenUrls = new Set();
    const seenTitles = new Set();
    const maxLen = Math.max(...results.map(r => r.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of results) {
        const item = list[i];
        const url = item && normalizedNewsUrl(item.link);
        const title = item && normalizedNewsTitle(item.title);
        if (item && !seenUrls.has(url) && !seenTitles.has(title)) {
          seenUrls.add(url);
          seenTitles.add(title);
          mixed.push(item);
        }
      }
    }

    if (mixed.length) {
      cache.set('news_uganda', mixed, 0);
      console.log(`Cached ${mixed.length} mixed news`);
    }
  } catch (e) {
    console.error('News API error:', e.message);
  }
}

fetchNews();


setInterval(fetchNews, 7200000);


app.get('/news/uganda', (req, res) => {
  const articles = cache.get('news_uganda') || [];
  res.json({ articles });
});

app.get('/news/sports', (req, res) => {
  const articles = cache.get('news_sports') || [];
  res.json({ articles });
});

// ── START ──
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('JisScroL API running on port ' + PORT);
});