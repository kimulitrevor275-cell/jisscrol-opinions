// ─────────────────────────────────────────
//  JisScroL API — Opinions + Ratings
//  Stack: Express + lowdb + dotenv
//  Deploy: Render
// ─────────────────────────────────────────

require('dotenv').config();
const express = require('express');
const { JSONFilePreset } = require('lowdb/node');
const app = express();

app.use(express.json());

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function adminOnly(req, res, next) {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function startServer() {
  const db = await JSONFilePreset('opinions.json', { opinions: [], ratings: [] });
if (!db.data.ratings) {
  db.data.ratings = [];
  await db.write();
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

  app.get('/opinions/:post_id', function(req, res) {
    var result = db.data.opinions
      .filter(function(o) { return o.post_id === req.params.post_id; })
      .reverse().slice(0, 50);
    res.json(result);
  });

  app.post('/opinions', async function(req, res) {
    var post_id = req.body.post_id;
    var text    = req.body.text;
    if (!post_id || !text || text.trim() === '') {
      return res.status(400).json({ error: 'post_id and text are required' });
    }
    if (text.length > 300) {
      return res.status(400).json({ error: 'Max 300 characters' });
    }
    var opinion = {
      id     : Date.now(),
      post_id: post_id,
      text   : text.trim(),
      time   : new Date().toISOString(),
    };
    db.data.opinions.push(opinion);
    await db.write();
    res.json({ success: true, id: opinion.id });
  });

  app.delete('/admin/opinions/:id', adminOnly, async function(req, res) {
    var id = Number(req.params.id);
    db.data.opinions = db.data.opinions.filter(function(o) { return o.id !== id; });
    await db.write();
    res.json({ success: true });
  });

  app.get('/admin/opinions', adminOnly, function(req, res) {
    res.json(db.data.opinions.slice().reverse());
  });

  // ────────────────────────────────────────
  //  RATINGS
  // ────────────────────────────────────────

  // GET /ratings/:post_id — get good/bad counts + percentages
  app.get('/ratings/:post_id', function(req, res) {
    var all  = db.data.ratings.filter(function(r) { return r.post_id === req.params.post_id; });
    var good = all.filter(function(r) { return r.vote === 'good'; }).length;
    var bad  = all.filter(function(r) { return r.vote === 'bad'; }).length;
    var total = good + bad;
    res.json({
      good      : good,
      bad       : bad,
      total     : total,
      goodPct   : total ? Math.round((good / total) * 100) : 0,
      badPct    : total ? Math.round((bad  / total) * 100) : 0,
    });
  });

  // POST /ratings — submit a vote { post_id, vote: "good" | "bad" }
  app.post('/ratings', async function(req, res) {
    var post_id = req.body.post_id;
    var vote    = req.body.vote;
    if (!post_id || (vote !== 'good' && vote !== 'bad')) {
      return res.status(400).json({ error: 'post_id and vote (good/bad) are required' });
    }
    db.data.ratings.push({
      id     : Date.now(),
      post_id: post_id,
      vote   : vote,
      time   : new Date().toISOString(),
    });
    await db.write();

    // return updated counts immediately
    var all  = db.data.ratings.filter(function(r) { return r.post_id === post_id; });
    var good = all.filter(function(r) { return r.vote === 'good'; }).length;
    var bad  = all.filter(function(r) { return r.vote === 'bad'; }).length;
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

  // ── START ──
  var PORT = process.env.PORT || 3000;
  app.listen(PORT, function() {
    console.log('JisScroL API running on port ' + PORT);
  });
}

startServer();

