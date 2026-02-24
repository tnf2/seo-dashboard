const fetch = require('node-fetch');
const db = require('./db');

function getCredentials() {
  const login = db.prepare("SELECT value FROM settings WHERE key='dataforseo_login'").get()?.value;
  const password = db.prepare("SELECT value FROM settings WHERE key='dataforseo_password'").get()?.value;
  return { login, password };
}

function getAuth() {
  const { login, password } = getCredentials();
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

function logCost(endpoint, cost) {
  db.prepare('INSERT INTO api_costs (endpoint, cost) VALUES (?, ?)').run(endpoint, cost);
}

async function apiCall(endpoint, body, costPerCall = 0) {
  const auth = getAuth();
  const url = `https://api.dataforseo.com/v3${endpoint}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  
  if (costPerCall > 0) {
    logCost(endpoint, costPerCall);
  }

  return data;
}

// Check rank for a single keyword
async function checkKeywordRank(keyword, domain) {
  const body = [{
    keyword: keyword,
    location_code: 2840, // US
    language_code: 'en',
    device: 'desktop',
    os: 'windows',
    depth: 100
  }];

  const data = await apiCall('/serp/google/organic/live/regular', body, 0.002);
  
  if (!data.tasks?.[0]?.result?.[0]?.items) {
    return { position: null, url: null, serpData: data };
  }

  const items = data.tasks[0].result[0].items;
  const match = items.find(item => 
    item.domain === domain || item.url?.includes(domain)
  );

  return {
    position: match ? match.rank_absolute : null,
    url: match ? match.url : null,
    serpData: data.tasks[0].result[0]
  };
}

// Get keyword suggestions
async function getKeywordSuggestions(keywords, locationCode = 2840) {
  const body = [{
    keywords: Array.isArray(keywords) ? keywords : [keywords],
    location_code: locationCode,
    language_code: 'en',
    include_seed_keyword: false,
    limit: 50
  }];

  const data = await apiCall('/keywords_data/google_ads/keywords_for_keywords/live', body, 0.025);
  
  if (!data.tasks?.[0]?.result) return [];

  return data.tasks[0].result.map(item => ({
    keyword: item.keyword,
    searchVolume: item.search_volume,
    competition: item.competition,
    cpc: item.cpc
  })).filter(item => item.searchVolume > 0);
}

// Scan all ranked keywords for a domain
async function scanRankedKeywords(domain) {
  const body = [{
    target: domain,
    location_code: 2840,
    language_code: 'en',
    limit: 100
  }];

  const data = await apiCall('/dataforseo_labs/google/ranked_keywords/live', body);

  // Log actual cost from response
  const cost = data.cost || 0.05;
  logCost('dataforseo_labs/ranked_keywords', cost);

  if (!data.tasks?.[0]?.result?.[0]?.items) {
    return { keywords: [], cost };
  }

  const items = data.tasks[0].result[0].items;
  const keywords = items.map(item => ({
    keyword: item.keyword_data?.keyword,
    position: item.ranked_serp_element?.serp_item?.rank_absolute || null,
    search_volume: item.keyword_data?.keyword_info?.search_volume || 0,
    url: item.ranked_serp_element?.serp_item?.url || null,
    competition: item.keyword_data?.keyword_info?.competition || null,
    cpc: item.keyword_data?.keyword_info?.cpc || 0
  })).filter(k => k.keyword);

  return { keywords, cost };
}

module.exports = { checkKeywordRank, getKeywordSuggestions, scanRankedKeywords, logCost };
