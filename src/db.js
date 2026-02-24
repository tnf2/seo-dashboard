const Database = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'seo.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db = null;
let _SQL = null;

// Synchronous-looking wrapper around sql.js
// Must call initSync() before use (awaited once at startup)
const db = new Proxy({}, {
  get(_, prop) {
    if (prop === 'initSync') return initSync;
    if (prop === 'prepare') return (sql) => ({
      run(...params) {
        const stmt = _db.prepare(sql);
        if (params.length) stmt.bind(params);
        stmt.step();
        stmt.free();
        const r = _db.exec('SELECT last_insert_rowid() as id, changes() as c');
        _save();
        return { 
          lastInsertRowid: r.length ? r[0].values[0][0] : 0, 
          changes: r.length ? r[0].values[0][1] : 0 
        };
      },
      get(...params) {
        const stmt = _db.prepare(sql);
        if (params.length) stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = _db.prepare(sql);
        if (params.length) stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
        return results;
      }
    });
    if (prop === 'exec') return (sql) => { _db.run(sql); _save(); };
    if (prop === 'pragma') return (str) => { try { _db.run(`PRAGMA ${str}`); } catch(e) {} };
    return undefined;
  }
});

function _save() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initSync() {
  _SQL = await Database();
  
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new _SQL.Database(buf);
  } else {
    _db = new _SQL.Database();
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(site_id, keyword)
    );
    CREATE TABLE IF NOT EXISTS rank_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      position INTEGER,
      url TEXT,
      serp_data TEXT,
      checked_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS keyword_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      search_volume INTEGER,
      competition REAL,
      cpc REAL,
      discovered_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_visibility (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      model TEXT,
      mentioned INTEGER DEFAULT 0,
      context TEXT,
      checked_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS api_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      cost REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(site_id, query)
    );
    CREATE TABLE IF NOT EXISTS reddit_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      subreddits TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(site_id, keyword)
    );
    CREATE TABLE IF NOT EXISTS reddit_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL REFERENCES reddit_keywords(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL,
      title TEXT,
      subreddit TEXT,
      url TEXT,
      score INTEGER DEFAULT 0,
      num_comments INTEGER DEFAULT 0,
      author TEXT,
      created_utc INTEGER,
      is_opportunity INTEGER DEFAULT 0,
      seen INTEGER DEFAULT 0,
      found_at TEXT DEFAULT (datetime('now')),
      UNIQUE(post_id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rank_checks_keyword ON rank_checks(keyword_id, checked_at);
    CREATE INDEX IF NOT EXISTS idx_keywords_site ON keywords(site_id);
    CREATE INDEX IF NOT EXISTS idx_api_costs_date ON api_costs(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_visibility_site ON ai_visibility(site_id, checked_at);
    CREATE INDEX IF NOT EXISTS idx_reddit_mentions_site ON reddit_mentions(site_id, found_at);
    CREATE INDEX IF NOT EXISTS idx_reddit_keywords_site ON reddit_keywords(site_id);
  `);

  const defaults = {
    dataforseo_login: 'h@candy.software',
    dataforseo_password: 'b8effaeafee353d5',
    check_frequency: 'daily',
    rank_check_cron: '0 6 * * *',
    discovery_cron: '0 7 * * 1',
    ai_visibility_cron: '0 8 * * 1',
    budget_alert: '50',
    reddit_check_cron: '0 */6 * * *'
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insertSetting.run(k, v);
  }

  const row = db.prepare('SELECT COUNT(*) as c FROM sites').get();
  if (row.c === 0) {
    const res = db.prepare('INSERT INTO sites (name, domain) VALUES (?, ?)').run('OPTCG Market', 'optcg.market');
    const siteId = res.lastInsertRowid;

    const insertKw = db.prepare('INSERT OR IGNORE INTO keywords (site_id, keyword) VALUES (?, ?)');
    for (const kw of [
      'one piece tcg', 'one piece card game', 'optcg',
      'where to buy one piece cards', 'one piece cards for sale',
      'one piece tcg discord', 'buy one piece cards',
      'sell one piece cards', 'one piece booster box'
    ]) { insertKw.run(siteId, kw); }

    const insertAiQ = db.prepare('INSERT OR IGNORE INTO ai_queries (site_id, query) VALUES (?, ?)');
    insertAiQ.run(siteId, 'best one piece tcg marketplace');
    insertAiQ.run(siteId, 'where to buy one piece cards online');

    console.log('Seeded database with OPTCG Market and keywords');
  }

  console.log('Database initialized');
}

module.exports = db;
