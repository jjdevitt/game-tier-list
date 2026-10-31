const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const TIER_LIST_PATH = path.join(ROOT_DIR, 'tier_list.md');
const LIBRARY_CSV_PATH = path.join(ROOT_DIR, 'library.csv');
const COVERS_CACHE_PATH = path.join(ROOT_DIR, 'covers.json');

const DEFAULT_TIERS = [
  {
    id: 'S',
    label: 'S-Tier',
    shortLabel: 'S',
    description: 'Exceptional masterpieces and personal favorites',
    color: '#ff5252'
  },
  {
    id: 'A',
    label: 'A-Tier',
    shortLabel: 'A',
    description: 'Outstanding titles with fantastic gameplay and design',
    color: '#ff9800'
  },
  {
    id: 'B',
    label: 'B-Tier',
    shortLabel: 'B',
    description: 'Solid, enjoyable games worth playing',
    color: '#ffeb3b'
  },
  {
    id: 'C',
    label: 'C-Tier',
    shortLabel: 'C',
    description: 'Decent casual fun, but limited depth or appeal',
    color: '#4caf50'
  },
  {
    id: 'D',
    label: 'D-Tier',
    shortLabel: 'D',
    description: 'Underwhelming or frustrating experiences',
    color: '#42a5f5'
  }
];

// Load or initialize cover art cache
let coversCache = {};
if (fs.existsSync(COVERS_CACHE_PATH)) {
  try {
    coversCache = JSON.parse(fs.readFileSync(COVERS_CACHE_PATH, 'utf8'));
  } catch (err) {
    console.error('Failed to read covers.json:', err.message);
    coversCache = {};
  }
}

function saveCoversCache() {
  try {
    fs.writeFileSync(COVERS_CACHE_PATH, JSON.stringify(coversCache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save covers.json:', err.message);
  }
}

// Parse a single CSV line handling quotes
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeName(name) {
  return name
    .replace(/\\([!#*_\[\]()])/g, '$1')
    .trim()
    .toLowerCase();
}

function unescapeMarkdown(text) {
  return text.replace(/\\([!#*_\[\]()])/g, '$1').trim();
}

function escapeMarkdown(text) {
  return text.replace(/!/g, '\\!');
}

function parseLibraryCSV() {
  if (!fs.existsSync(LIBRARY_CSV_PATH)) {
    return [];
  }
  const content = fs.readFileSync(LIBRARY_CSV_PATH, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const games = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const name = cols[0];
    if (!name) continue;
    const norm = normalizeName(name);
    if (seen.has(norm)) continue;
    seen.add(norm);

    const platforms = [];
    if (cols[1] && cols[1].toUpperCase() === 'X') platforms.push('Steam');
    if (cols[2] && cols[2].toUpperCase() === 'X') platforms.push('PS4');
    if (cols[3] && cols[3].toUpperCase() === 'X') platforms.push('PS5');
    if (cols[4] && cols[4].toUpperCase() === 'X') platforms.push('Switch');

    const hoursRaw = cols[5] ? parseFloat(cols[5]) : null;
    const steamHours = !isNaN(hoursRaw) && hoursRaw !== null ? hoursRaw : null;

    games.push({
      name,
      platforms,
      steamHours
    });
  }
  return games;
}

function parseTierListMD(libraryGames) {
  const libByNorm = new Map();
  for (const g of libraryGames) {
    libByNorm.set(normalizeName(g.name), g);
  }

  const tierMap = {
    S: [],
    A: [],
    B: [],
    C: [],
    D: []
  };
  const descriptions = {};
  for (const t of DEFAULT_TIERS) {
    descriptions[t.id] = t.description;
  }

  if (!fs.existsSync(TIER_LIST_PATH)) {
    return { tierMap, descriptions };
  }

  const content = fs.readFileSync(TIER_LIST_PATH, 'utf8');
  const lines = content.split(/\r?\n/);

  // Parse descriptions from summary table if present
  for (const line of lines) {
    const tableMatch = line.match(/^\|\s*\*\*([SABCD])-Tier\*\*\s*\|\s*([^|]+)\|/i);
    if (tableMatch) {
      const tierId = tableMatch[1].toUpperCase();
      const desc = tableMatch[2].trim();
      if (desc) descriptions[tierId] = desc;
    }
  }

  // Parse Detailed Tier List section first (prefer bullet list)
  let currentTier = null;
  let foundDetailedBullets = false;

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+\*\*([SABCD])-Tier/i) || line.match(/^##\s+([SABCD])-Tier/i);
    if (headerMatch) {
      currentTier = headerMatch[1].toUpperCase();
      continue;
    }
    if (line.startsWith('# ')) {
      currentTier = null;
    }
    if (currentTier && tierMap[currentTier]) {
      const bulletMatch = line.match(/^\*\s+\*\*(.+?)\*\*\s*$/) || line.match(/^[-*]\s+(.+?)\s*$/);
      if (bulletMatch) {
        const rawName = unescapeMarkdown(bulletMatch[1].replace(/^\*\*|\*\*$/g, ''));
        if (!tierMap[currentTier].some((n) => normalizeName(n) === normalizeName(rawName))) {
          tierMap[currentTier].push(rawName);
          foundDetailedBullets = true;
        }
      }
    }
  }

  // Fallback to summary table if no detailed bullets were found
  if (!foundDetailedBullets) {
    for (const line of lines) {
      const rowMatch = line.match(/^\|\s*\*\*([SABCD])-Tier\*\*\s*\|[^|]+\|[^|]+\|\s*([^|]+)\|/i);
      if (rowMatch) {
        const tierId = rowMatch[1].toUpperCase();
        const gamesCell = unescapeMarkdown(rowMatch[2]);
        // Only used as fallback
        const names = gamesCell.split(',').map((s) => s.trim()).filter(Boolean);
        for (const rawName of names) {
          const matchedLib = libByNorm.get(normalizeName(rawName));
          const canonicalName = matchedLib ? matchedLib.name : rawName;
          tierMap[tierId].push(canonicalName);
        }
      }
    }
  }

  return { tierMap, descriptions };
}

function generateTierListMD(tiersData, descriptions = {}) {
  const orderedIds = ['S', 'A', 'B', 'C', 'D'];
  let totalRanked = 0;
  for (const id of orderedIds) {
    const list = tiersData[id] || [];
    totalRanked += list.length;
  }

  const lines = [];
  lines.push('# **Video Game Tier List**');
  lines.push('');
  lines.push('# **Overview**');
  lines.push('');
  lines.push(
    `A compilation of the ${totalRanked} video ${totalRanked === 1 ? 'game' : 'games'} ranked across our sessions, organized from S-Tier down to D-Tier.`
  );
  lines.push('');
  lines.push('# **Tier Breakdown Summary**');
  lines.push('');
  lines.push('| Tier | Description | Count | Games |');
  lines.push('| :---- | :---- | :---- | :---- |');

  for (const tierMeta of DEFAULT_TIERS) {
    const id = tierMeta.id;
    const desc = descriptions[id] || tierMeta.description;
    const games = tiersData[id] || [];
    const count = games.length;
    const gamesFormatted = games.map((g) => escapeMarkdown(g)).join(', ');
    lines.push(`| **${id}-Tier** | ${desc} | ${count} | ${gamesFormatted} |`);
  }

  lines.push('');
  lines.push('# **Detailed Tier List**');

  for (const tierMeta of DEFAULT_TIERS) {
    const id = tierMeta.id;
    const games = tiersData[id] || [];
    const count = games.length;
    const gameWord = count === 1 ? 'Game' : 'Games';
    lines.push('');
    lines.push(`## **${id}-Tier (${count} ${gameWord})**`);
    lines.push('');
    games.forEach((gameName, idx) => {
      const escaped = escapeMarkdown(gameName);
      const trailing = idx < games.length - 1 ? '  ' : '';
      lines.push(`* **${escaped}**${trailing}`);
    });
  }

  lines.push('');
  lines.push('');
  return lines.join('\n');
}

// Helper for HTTPS GET JSON
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'GameTierListApp/1.0 (Local Tier List Manager)'
        },
        timeout: 8000
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpsGetJson(res.headers.location).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// Fetch cover art from Steam Store Search API, fallback to Wikipedia API
async function fetchCoverForGame(gameName) {
  const key = normalizeName(gameName);
  if (coversCache[key] && coversCache[key].url) {
    return coversCache[key];
  }

  // Clean up edition suffixes for better search hits if exact fails
  const searchTerms = [gameName];
  const cleaned = gameName
    .replace(/\s*\((20\d\d|19\d\d|Cloud Version).*?\)/gi, '')
    .replace(/\s*-\s*(Multiplayer|Single Player|Complete Edition|Enhanced Edition|Anniversary Edition)$/gi, '')
    .trim();
  if (cleaned && cleaned !== gameName) {
    searchTerms.push(cleaned);
  }

  // 1. Try Steam Store Search API
  for (const term of searchTerms) {
    try {
      const steamUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
      const data = await httpsGetJson(steamUrl);
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        // Find best match
        const normTerm = normalizeName(term);
        let best = data.items.find((it) => normalizeName(it.name) === normTerm) || data.items[0];
        if (best && best.id) {
          // Steam provides high-res library 600x900 vertical box art and header 460x215 art
          const result = {
            url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${best.id}/library_600x900.jpg`,
            fallbackUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${best.id}/header.jpg`,
            tinyUrl: best.tiny_image || null,
            steamAppId: best.id,
            source: 'steam'
          };
          coversCache[key] = result;
          saveCoversCache();
          return result;
        }
      }
    } catch (err) {
      // Ignore and try next source
    }
  }

  // 2. Try Wikipedia PageImages API (great for Nintendo Switch / PlayStation exclusives)
  for (const term of [`${cleaned} (video game)`, cleaned]) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query& format=json&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(
        term
      )}&gsrlimit=3&pithumbsize=400&format=json`;
      const data = await httpsGetJson(wikiUrl);
      if (data && data.query && data.query.pages) {
        const pages = Object.values(data.query.pages).sort((a, b) => (a.index || 99) - (b.index || 99));
        for (const page of pages) {
          if (page.thumbnail && page.thumbnail.source) {
            const result = {
              url: page.thumbnail.source,
              fallbackUrl: null,
              source: 'wikipedia'
            };
            coversCache[key] = result;
            saveCoversCache();
            return result;
          }
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  return { url: null, source: 'none' };
}

function buildState() {
  const libraryGames = parseLibraryCSV();
  const { tierMap, descriptions } = parseTierListMD(libraryGames);

  const libByNorm = new Map();
  for (const g of libraryGames) {
    libByNorm.set(normalizeName(g.name), g);
  }

  const rankedNormSet = new Set();
  const tiers = DEFAULT_TIERS.map((meta) => {
    const names = tierMap[meta.id] || [];
    const items = names.map((name) => {
      const norm = normalizeName(name);
      rankedNormSet.add(norm);
      const libEntry = libByNorm.get(norm);
      const canonicalName = libEntry ? libEntry.name : name;
      const displayName = name; // Preserve display casing from tier_list or library
      return {
        id: norm,
        name: displayName,
        canonicalName,
        platforms: libEntry ? libEntry.platforms : [],
        steamHours: libEntry ? libEntry.steamHours : null,
        cover: coversCache[norm] || null
      };
    });

    return {
      ...meta,
      description: descriptions[meta.id] || meta.description,
      items
    };
  });

  const unranked = [];
  for (const g of libraryGames) {
    const norm = normalizeName(g.name);
    if (!rankedNormSet.has(norm)) {
      unranked.push({
        id: norm,
        name: g.name,
        canonicalName: g.name,
        platforms: g.platforms,
        steamHours: g.steamHours,
        cover: coversCache[norm] || null
      });
    }
  }

  return {
    tiers,
    unranked,
    totalLibraryCount: libraryGames.length
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API: Get current tier list + library state
  if (req.method === 'GET' && pathname === '/api/state') {
    try {
      const state = buildState();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(state));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Fetch cover art for a game (cached in covers.json)
  if (req.method === 'GET' && pathname === '/api/cover') {
    const gameName = parsedUrl.searchParams.get('name');
    if (!gameName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing name parameter' }));
      return;
    }
    try {
      const cover = await fetchCoverForGame(gameName);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(cover));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Save client-resolved cover art into covers.json
  if (req.method === 'POST' && pathname === '/api/cover-cache') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { name, cover } = JSON.parse(body);
        if (name && cover && cover.url) {
          coversCache[normalizeName(name)] = cover;
          saveCoversCache();
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Save updated tier list to tier_list.md
  if (req.method === 'POST' && pathname === '/api/save') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const tiersData = payload.tiers || {};
        const descriptions = payload.descriptions || {};
        const markdown = generateTierListMD(tiersData, descriptions);
        fs.writeFileSync(TIER_LIST_PATH, markdown, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            savedAt: new Date().toISOString(),
            file: 'tier_list.md'
          })
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static files
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT_DIR, path.normalize(safePath));
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Video Game Tier List server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  parseLibraryCSV,
  parseTierListMD,
  generateTierListMD,
  buildState,
  fetchCoverForGame
};
