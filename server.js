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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
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
    .select('id, text, time, username')
    .eq('post_id', req.params.post_id)
    .order('time', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /opinions
app.post('/opinions', async function(req, res) {
  const { post_id, text, username, user_id } = req.body;
  if (!post_id || !text || text.trim() === '') {
    return res.status(400).json({ error: 'post_id and text are required' });

console.log('username received:', username);
  }
const cleanText = text.replace(/<[^>]*>/g, '').trim();
  if (text.length > 300) {
    return res.status(400).json({ error: 'Max 300 characters' });
  }

  const { data, error } = await supabase
    .from('opinions')
   .insert([{ post_id, text: cleanText, username: username || 'Anonymous', user_id: user_id || null }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data[0].id });
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
  const { data, error } = await supabase
    .from('ratings')
    .select('vote')
    .eq('post_id', req.params.post_id);

  if (error) return res.status(500).json({ error: error.message });

  var good  = data.filter(function(r) { return r.vote === 'good'; }).length;
  var bad   = data.filter(function(r) { return r.vote === 'bad';  }).length;
  var total = good + bad;

  res.json({
    good    : good,
    bad     : bad,
    total   : total,
    goodPct : total ? Math.round((good / total) * 100) : 50,
    badPct  : total ? Math.round((bad  / total) * 100) : 50,
  });
});

// POST /ratings
app.post('/ratings', async function(req, res) {
  const { post_id, vote } = req.body;
  if (!post_id || (vote !== 'good' && vote !== 'bad')) {
    return res.status(400).json({ error: 'post_id and vote (good/bad) are required' });
  }

  const { error } = await supabase
    .from('ratings')
    .insert([{ post_id, vote }]);

  if (error) return res.status(500).json({ error: error.message });

  // return updated counts
  const { data } = await supabase
    .from('ratings')
    .select('vote')
    .eq('post_id', post_id);

  var good  = data.filter(function(r) { return r.vote === 'good'; }).length;
  var bad   = data.filter(function(r) { return r.vote === 'bad';  }).length;
  var total = good + bad;

  res.json({
    success : true,
    good    : good,
    bad     : bad,
    total   : total,
    goodPct : Math.round((good / total) * 100),
    badPct  : Math.round((bad  / total) * 100),
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

// ── START ──
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('JisScroL API running on port ' + PORT);
});

