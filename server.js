// ─────────────────────────────────────────
//  JisScroL API — Opinions + Ratings
//  Stack: Express + Supabase + dotenv
//  Deploy: Render
// ─────────────────────────────────────────

require('dotenv').config();
const express    = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

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

app.get('/articles', async function(req, res) {
    var category = req.query.category;
    
    let query = supabase
        .from('articles')
        .select('*');
    
    if (category) query = query.eq('category', category);
    
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    
    const scored = data.map(article => {
        const now = Date.now();
        const created = new Date(article.created_at).getTime();
        const daysSincePost = (now - created) / (1000 * 60 * 60 * 24);
        
        const recencyScore = 100 * Math.exp(-daysSincePost / 7);
        const engagementBonus = (article.comment_count || 0) * 2 + (article.like_count || 0) * 1.5;
        
        // Add random noise (±10% of total score)
        const baseScore = recencyScore + engagementBonus;
        const randomFactor = (Math.random() - 0.5) * 0.2; // ±10%
        const finalScore = baseScore * (1 + randomFactor);
        
        return { ...article, _score: finalScore };
    });
    
    return res.json(scored.sort((a, b) => b._score - a._score));
});
// ── GET /stories ──
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

// ── GET /search ──
app.get('/search', async function(req, res) {
  var q = req.query.q;
  if (!q) return res.json([]);

  const [articles, stories, songs] = await Promise.all([
    supabase.from('articles').select('id, category, headline, img, time').ilike('headline', '%' + q + '%'),
    supabase.from('stories').select('id, title, snippet, img, cat').ilike('title', '%' + q + '%'),
    supabase.from('songs').select('id, name, artist, img, rank').ilike('name', '%' + q + '%')
  ]);

  res.json({
    articles : articles.data || [],
    stories  : stories.data  || [],
    songs    : songs.data    || []
  });
});

// ── START ──
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('JisScroL API running on port ' + PORT);
});


