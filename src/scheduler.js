const cron = require('node-cron');
const db = require('./db');
const { checkKeywordRank, getKeywordSuggestions } = require('./dataforseo');

let jobs = {};

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

async function runRankChecks() {
  console.log('[Scheduler] Starting rank checks...');
  const sites = db.prepare('SELECT * FROM sites').all();
  
  for (const site of sites) {
    const keywords = db.prepare('SELECT * FROM keywords WHERE site_id = ?').all(site.id);
    
    for (const kw of keywords) {
      try {
        // Check if already checked today
        const existing = db.prepare(
          "SELECT id FROM rank_checks WHERE keyword_id = ? AND date(checked_at) = date('now')"
        ).get(kw.id);
        
        if (existing) {
          console.log(`[Scheduler] Skipping "${kw.keyword}" — already checked today`);
          continue;
        }

        const result = await checkKeywordRank(kw.keyword, site.domain);
        
        db.prepare(
          'INSERT INTO rank_checks (keyword_id, position, url, serp_data) VALUES (?, ?, ?, ?)'
        ).run(kw.id, result.position, result.url, JSON.stringify(result.serpData));
        
        console.log(`[Scheduler] ${kw.keyword}: position ${result.position || 'not found'}`);
        
        // Rate limit: 200ms between calls
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`[Scheduler] Error checking "${kw.keyword}":`, err.message);
      }
    }
  }
  console.log('[Scheduler] Rank checks complete');
}

async function runKeywordDiscovery() {
  console.log('[Scheduler] Starting keyword discovery...');
  const sites = db.prepare('SELECT * FROM sites').all();
  
  for (const site of sites) {
    const keywords = db.prepare('SELECT keyword FROM keywords WHERE site_id = ?').all(site.id);
    const seedKeywords = keywords.slice(0, 5).map(k => k.keyword);
    
    if (seedKeywords.length === 0) continue;
    
    try {
      const suggestions = await getKeywordSuggestions(seedKeywords);
      const insert = db.prepare(
        'INSERT INTO keyword_suggestions (site_id, keyword, search_volume, competition, cpc) VALUES (?, ?, ?, ?, ?)'
      );
      
      for (const s of suggestions) {
        try {
          insert.run(site.id, s.keyword, s.searchVolume, s.competition, s.cpc);
        } catch (e) { /* dupe */ }
      }
      
      console.log(`[Scheduler] Found ${suggestions.length} suggestions for ${site.name}`);
    } catch (err) {
      console.error(`[Scheduler] Discovery error for ${site.name}:`, err.message);
    }
  }
}

function start() {
  // Stop existing jobs
  Object.values(jobs).forEach(j => j.stop());
  jobs = {};

  const rankCron = getSetting('rank_check_cron') || '0 6 * * *';
  const discoveryCron = getSetting('discovery_cron') || '0 7 * * 1';
  const aiCron = getSetting('ai_visibility_cron') || '0 8 * * 1';

  if (cron.validate(rankCron)) {
    jobs.rank = cron.schedule(rankCron, runRankChecks);
    console.log(`[Scheduler] Rank checks scheduled: ${rankCron}`);
  }

  if (cron.validate(discoveryCron)) {
    jobs.discovery = cron.schedule(discoveryCron, runKeywordDiscovery);
    console.log(`[Scheduler] Keyword discovery scheduled: ${discoveryCron}`);
  }

  if (cron.validate(aiCron)) {
    jobs.ai = cron.schedule(aiCron, () => {
      console.log('[Scheduler] AI visibility check — framework ready, actual querying TBD');
    });
    console.log(`[Scheduler] AI visibility scheduled: ${aiCron}`);
  }
}

module.exports = { start, runRankChecks, runKeywordDiscovery };
