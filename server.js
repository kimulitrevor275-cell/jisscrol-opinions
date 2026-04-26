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

async function startServer() {
  const db = await JSONFilePreset('opinions.json', { opinions: [] });

  function adminOnly(req, res, next) {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  app.get('/', function(req, res) {
    res.json({ status: 'JisScroL Opinions API running' });
  });

  app.get('/opinions/:post_id', function(req, res) {
    var result = db.data.opinions
      .filter(function(o) { return o.post_id === req.params.post_id; })
      .reverse()
      .slice(0, 50);
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

  var PORT = process.env.PORT || 3000;
  app.listen(PORT, function() {
    console.log('JisScroL API running on port ' + PORT);
  });
}

startServer();
