const express = require('express');
const router = express.Router();
const db = require('../db');
const { runRankChecks, runKeywordDiscovery, runRedditChecks } = require('../scheduler');
const { checkKeywordRank, getKeywordSuggestions, scanRankedKeywords } = require('../dataforseo');

// ============ SITES ============

router.get('/sites', (req, res) => {
  res.json(db.prepare('SELECT * FROM sites ORDER BY name').all());
});

router.post('/sites', (req, res) => {
  const { name, domain } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'name and domain required' });
  try {
    const r = db.prepare('INSERT INTO sites (name, domain) VALUES (?, ?)').run(name, domain);
    res.json({ id: r.lastInsertRowid, name, domain });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/sites/:id', (req, res) => {
  db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ KEYWORDS ============

router.get('/sites/:siteId/keywords', (req, res) => {
  const keywords = db.prepare('SELECT * FROM keywords WHERE site_id = ? ORDER BY keyword').all(req.params.siteId);
  res.json(keywords);
});

router.post('/sites/:siteId/keywords', (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  try {
    const r = db.prepare('INSERT INTO keywords (site_id, keyword) VALUES (?, ?)').run(req.params.siteId, keyword);
    res.json({ id: r.lastInsertRowid, site_id: +req.params.siteId, keyword });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/keywords/:id', (req, res) => {
  db.prepare('DELETE FROM keywords WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ RANK DATA ============

router.get('/sites/:siteId/ranks', (req, res) => {
  const rows = db.prepare(`
    SELECT k.keyword, k.id as keyword_id, rc.position, rc.url, rc.checked_at
    FROM keywords k
    LEFT JOIN rank_checks rc ON rc.keyword_id = k.id
    WHERE k.site_id = ?
    ORDER BY k.keyword, rc.checked_at DESC
  `).all(req.params.siteId);

  // Group by keyword
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.keyword]) {
      grouped[row.keyword] = { keyword: row.keyword, keyword_id: row.keyword_id, checks: [] };
    }
    if (row.checked_at) {
      grouped[row.keyword].checks.push({
        position: row.position,
        url: row.url,
        checked_at: row.checked_at
      });
    }
  }

  res.json(Object.values(grouped));
});

// Rank history for a single keyword (for charts)
router.get('/keywords/:id/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const rows = db.prepare(
    'SELECT position, url, checked_at FROM rank_checks WHERE keyword_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).all(req.params.id, limit);
  res.json(rows.reverse());
});

// ============ SERP SNAPSHOT ============

router.get('/keywords/:id/serp', (req, res) => {
  const row = db.prepare(
    'SELECT serp_data, checked_at FROM rank_checks WHERE keyword_id = ? AND serp_data IS NOT NULL ORDER BY checked_at DESC LIMIT 1'
  ).get(req.params.id);
  
  if (!row) return res.json({ items: [], checked_at: null });
  
  try {
    const data = JSON.parse(row.serp_data);
    const items = (data.items || []).filter(i => i.type === 'organic').slice(0, 10).map(i => ({
      position: i.rank_absolute,
      title: i.title,
      url: i.url,
      domain: i.domain,
      description: i.description
    }));
    res.json({ items, checked_at: row.checked_at });
  } catch {
    res.json({ items: [], checked_at: row.checked_at });
  }
});

// ============ MOVERS ============

router.get('/sites/:siteId/movers', (req, res) => {
  const keywords = db.prepare('SELECT * FROM keywords WHERE site_id = ?').all(req.params.siteId);
  const movers = [];

  for (const kw of keywords) {
    const checks = db.prepare(
      'SELECT position, checked_at FROM rank_checks WHERE keyword_id = ? ORDER BY checked_at DESC LIMIT 2'
    ).all(kw.id);

    if (checks.length >= 2 && checks[0].position != null && checks[1].position != null) {
      const change = checks[1].position - checks[0].position; // positive = improved
      if (change !== 0) {
        movers.push({
          keyword: kw.keyword,
          keyword_id: kw.id,
          current: checks[0].position,
          previous: checks[1].position,
          change
        });
      }
    }
  }

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  res.json(movers);
});

// ============ KEYWORD DISCOVERY ============

router.get('/sites/:siteId/suggestions', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM keyword_suggestions WHERE site_id = ? ORDER BY search_volume DESC LIMIT 100'
  ).all(req.params.siteId);
  res.json(rows);
});

// ============ AI VISIBILITY ============

router.get('/sites/:siteId/ai-queries', (req, res) => {
  res.json(db.prepare('SELECT * FROM ai_queries WHERE site_id = ?').all(req.params.siteId));
});

router.post('/sites/:siteId/ai-queries', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  try {
    const r = db.prepare('INSERT INTO ai_queries (site_id, query) VALUES (?, ?)').run(req.params.siteId, query);
    res.json({ id: r.lastInsertRowid, query });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/ai-queries/:id', (req, res) => {
  db.prepare('DELETE FROM ai_queries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/sites/:siteId/ai-visibility', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM ai_visibility WHERE site_id = ? ORDER BY checked_at DESC LIMIT 100'
  ).all(req.params.siteId);
  res.json(rows);
});

// ============ COST TRACKER ============

router.get('/costs', (req, res) => {
  const total = db.prepare('SELECT COALESCE(SUM(cost),0) as total FROM api_costs').get().total;
  const today = db.prepare("SELECT COALESCE(SUM(cost),0) as total FROM api_costs WHERE date(created_at) = date('now')").get().total;
  const thisWeek = db.prepare("SELECT COALESCE(SUM(cost),0) as total FROM api_costs WHERE created_at >= datetime('now', '-7 days')").get().total;
  const thisMonth = db.prepare("SELECT COALESCE(SUM(cost),0) as total FROM api_costs WHERE created_at >= datetime('now', '-30 days')").get().total;
  const recent = db.prepare('SELECT * FROM api_costs ORDER BY created_at DESC LIMIT 50').all();
  const budget = db.prepare("SELECT value FROM settings WHERE key = 'budget_alert'").get()?.value || '50';

  res.json({ total, today, thisWeek, thisMonth, recent, budget: +budget });
});

// ============ SETTINGS ============

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

router.put('/settings', (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
  for (const [k, v] of Object.entries(req.body)) {
    upsert.run(k, String(v), String(v));
  }
  // Restart scheduler with new cron values
  const scheduler = require('../scheduler');
  scheduler.start();
  res.json({ ok: true });
});

// ============ MANUAL TRIGGERS ============

router.post('/run/rank-check', async (req, res) => {
  try {
    await runRankChecks();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run/discovery', async (req, res) => {
  try {
    await runKeywordDiscovery();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check single keyword rank on demand
router.post('/keywords/:id/check', async (req, res) => {
  const kw = db.prepare('SELECT k.*, s.domain FROM keywords k JOIN sites s ON s.id = k.site_id WHERE k.id = ?').get(req.params.id);
  if (!kw) return res.status(404).json({ error: 'keyword not found' });

  try {
    const result = await checkKeywordRank(kw.keyword, kw.domain);
    db.prepare(
      'INSERT INTO rank_checks (keyword_id, position, url, serp_data) VALUES (?, ?, ?, ?)'
    ).run(kw.id, result.position, result.url, JSON.stringify(result.serpData));
    res.json({ position: result.position, url: result.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ SCAN SITE (Ranked Keywords) ============

router.post('/sites/:siteId/scan', async (req, res) => {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.siteId);
  if (!site) return res.status(404).json({ error: 'site not found' });

  try {
    const { keywords, cost } = await scanRankedKeywords(site.domain);

    let newCount = 0;
    for (const kw of keywords) {
      const r = db.prepare('INSERT OR IGNORE INTO keywords (site_id, keyword) VALUES (?, ?)').run(req.params.siteId, kw.keyword);
      if (r.changes > 0) newCount++;
      const kwRow = db.prepare('SELECT id FROM keywords WHERE site_id = ? AND keyword = ?').get(req.params.siteId, kw.keyword);
      if (kwRow && kw.position) {
        db.prepare('INSERT INTO rank_checks (keyword_id, position, url) VALUES (?, ?, ?)').run(kwRow.id, kw.position, kw.url);
      }
    }

    res.json({
      found: keywords.length,
      newAdded: newCount,
      alreadyTracked: keywords.length - newCount,
      cost,
      keywords
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ REDDIT MONITOR ============

router.get('/sites/:siteId/reddit-keywords', (req, res) => {
  res.json(db.prepare('SELECT * FROM reddit_keywords WHERE site_id = ? ORDER BY keyword').all(req.params.siteId));
});

router.post('/sites/:siteId/reddit-keywords', (req, res) => {
  const { keyword, subreddits } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  try {
    const subs = JSON.stringify(subreddits || []);
    const r = db.prepare('INSERT INTO reddit_keywords (site_id, keyword, subreddits) VALUES (?, ?, ?)').run(req.params.siteId, keyword, subs);
    res.json({ id: r.lastInsertRowid, site_id: +req.params.siteId, keyword, subreddits: subs });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/reddit-keywords/:id', (req, res) => {
  db.prepare('DELETE FROM reddit_mentions WHERE keyword_id = ?').run(req.params.id);
  db.prepare('DELETE FROM reddit_keywords WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/sites/:siteId/reddit-mentions', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const unseen = req.query.unseen === '1' ? 'AND rm.seen = 0' : '';
  const opOnly = req.query.opportunities === '1' ? 'AND rm.is_opportunity = 1' : '';
  const rows = db.prepare(`
    SELECT rm.*, rk.keyword as matched_keyword
    FROM reddit_mentions rm
    JOIN reddit_keywords rk ON rk.id = rm.keyword_id
    WHERE rm.site_id = ? ${unseen} ${opOnly}
    ORDER BY rm.created_utc DESC
    LIMIT ?
  `).all(req.params.siteId, limit);
  res.json(rows);
});

router.put('/reddit-mentions/:id/seen', (req, res) => {
  db.prepare('UPDATE reddit_mentions SET seen = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/reddit-mentions/mark-all-seen', (req, res) => {
  const { siteId } = req.body;
  if (siteId) {
    db.prepare('UPDATE reddit_mentions SET seen = 1 WHERE site_id = ?').run(siteId);
  }
  res.json({ ok: true });
});

router.post('/run/reddit-check', async (req, res) => {
  try {
    await runRedditChecks();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
