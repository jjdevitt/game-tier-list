const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const TIER_LIST_PATH = path.join(ROOT_DIR, 'tier_list.md');
const LIBRARY_CSV_PATH = path.join(ROOT_DIR, 'library.csv');
const COVERS_CACHE_PATH = path.join(ROOT_DIR, 'covers.json');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

// Ensure local assets store exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

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

const SUPPORTED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

// Load or initialize cover art metadata cache
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

function normalizeName(name) {
  return String(name || '')
    .replace(/\\([!#*_\[\]()])/g, '$1')
    .trim()
    .toLowerCase();
}

function gameSlug(name) {
  const slug = normalizeName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'game';
}

function unescapeMarkdown(text) {
  return String(text || '').replace(/\\([!#*_\[\]()])/g, '$1').trim();
}

function escapeMarkdown(text) {
  return String(text || '').replace(/!/g, '\\!');
}

// Check if a local image file already exists in assets/ for this game
function findLocalAssetForGame(gameName) {
  const key = normalizeName(gameName);
  const slug = gameSlug(gameName);
  const cached = coversCache[key];

  // If the user explicitly replaced the cover with a custom one (removing the local asset),
  // do not fall back to scanning assets/ unless localFile is explicitly set.
  if (cached && cached.isCustom && !cached.localFile) {
    return null;
  }

  // 1. Check recorded localFile in covers.json
  if (cached && cached.localFile) {
    const cleanRel = cached.localFile.replace(/^\/+/, '').replace(/\\/g, '/');
    const absPath = path.join(ROOT_DIR, cleanRel);
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      const mtime = Math.floor(fs.statSync(absPath).mtimeMs);
      return {
        url: `${cleanRel}?v=${mtime}`,
        localFile: cleanRel,
        hasLocalAsset: true,
        remoteUrl: cached.remoteUrl || null,
        source: 'local'
      };
    }
  }

  // 2. Scan assets/ directory for matching slug.<ext>
  for (const ext of SUPPORTED_IMAGE_EXTS) {
    const relPath = `assets/${slug}${ext}`;
    const absPath = path.join(ROOT_DIR, relPath);
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      const mtime = Math.floor(fs.statSync(absPath).mtimeMs);
      const entry = {
        ...(cached || {}),
        url: `${relPath}?v=${mtime}`,
        localFile: relPath,
        hasLocalAsset: true,
        isCustom: false,
        source: 'local'
      };
      coversCache[key] = entry;
      saveCoversCache();
      return entry;
    }
  }

  return null;
}

// Delete any existing local asset file(s) in assets/ for this game
function removeLocalAssetForGame(gameName) {
  const key = normalizeName(gameName);
  const slug = gameSlug(gameName);
  const removedFiles = [];

  const cached = coversCache[key];
  if (cached && cached.localFile) {
    const absPath = path.join(ROOT_DIR, cached.localFile);
    if (fs.existsSync(absPath) && absPath.startsWith(ASSETS_DIR)) {
      try {
        fs.unlinkSync(absPath);
        removedFiles.push(cached.localFile);
      } catch (err) {
        console.error('Failed to delete local asset:', absPath, err.message);
      }
    }
    delete cached.localFile;
    cached.hasLocalAsset = false;
  }

  // Also remove any files matching slug.<ext> in assets/
  for (const ext of SUPPORTED_IMAGE_EXTS) {
    const relPath = `assets/${slug}${ext}`;
    const absPath = path.join(ROOT_DIR, relPath);
    if (fs.existsSync(absPath)) {
      try {
        fs.unlinkSync(absPath);
        if (!removedFiles.includes(relPath)) removedFiles.push(relPath);
      } catch (err) {
        console.error('Failed to delete slug asset:', absPath, err.message);
      }
    }
  }

  saveCoversCache();
  return removedFiles;
}

// Download a remote image buffer via http/https
function fetchRemoteBuffer(targetUrl, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return reject(new Error('Invalid remote URL'));
    }
    const client = targetUrl.startsWith('https') ? https : http;
    const req = client.get(
      targetUrl,
      {
        headers: {
          'User-Agent': 'GameTierListApp/1.0 (Local Tier List Manager)',
          Accept: 'image/*,*/*;q=0.8'
        },
        timeout: 10000
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          return fetchRemoteBuffer(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (buffer.length < 100) {
            return reject(new Error('Downloaded image is too small / empty'));
          }
          const contentType = (res.headers['content-type'] || '').toLowerCase();
          resolve({ buffer, contentType, finalUrl: targetUrl });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Image download timed out'));
    });
  });
}

function detectExtension(contentType, urlStr = '') {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('svg')) return '.svg';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';

  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    for (const ext of SUPPORTED_IMAGE_EXTS) {
      if (pathname.endsWith(ext)) return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch (_) {}
  return '.jpg';
}

// Download image from URL (with optional fallback URLs) and save to assets/<slug>.<ext>
async function downloadAndSaveAsset(gameName, candidateUrls, metadata = {}) {
  const urls = (Array.isArray(candidateUrls) ? candidateUrls : [candidateUrls]).filter(Boolean);
  let downloaded = null;
  let usedUrl = null;

  for (const u of urls) {
    try {
      downloaded = await fetchRemoteBuffer(u);
      usedUrl = u;
      break;
    } catch (_) {
      // Try next candidate URL
    }
  }

  if (!downloaded) {
    throw new Error('Could not download image from candidate URLs');
  }

  // Remove any previous local asset before writing the new one
  removeLocalAssetForGame(gameName);

  const ext = detectExtension(downloaded.contentType, usedUrl);
  const slug = gameSlug(gameName);
  const relPath = `assets/${slug}${ext}`;
  const absPath = path.join(ROOT_DIR, relPath);

  fs.writeFileSync(absPath, downloaded.buffer);
  const mtime = Math.floor(fs.statSync(absPath).mtimeMs);

  const key = normalizeName(gameName);
  const record = {
    ...metadata,
    url: `${relPath}?v=${mtime}`,
    localFile: relPath,
    hasLocalAsset: true,
    remoteUrl: usedUrl,
    source: metadata.source || 'local',
    updatedAt: Date.now()
  };

  coversCache[key] = record;
  saveCoversCache();
  return record;
}

// Save a base64 Data URL directly to assets/<slug>.<ext>
function saveDataUrlAsset(gameName, dataUrl, metadata = {}) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image data URL');
  }
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length < 50) {
    throw new Error('Uploaded image is empty');
  }

  // Remove old local asset first
  const removedFiles = removeLocalAssetForGame(gameName);

  const ext = detectExtension(contentType);
  const slug = gameSlug(gameName);
  const relPath = `assets/${slug}${ext}`;
  const absPath = path.join(ROOT_DIR, relPath);

  fs.writeFileSync(absPath, buffer);
  const mtime = Math.floor(fs.statSync(absPath).mtimeMs);

  const key = normalizeName(gameName);
  const record = {
    ...metadata,
    url: `${relPath}?v=${mtime}`,
    localFile: relPath,
    hasLocalAsset: true,
    remoteUrl: metadata.remoteUrl || null,
    source: metadata.source || 'custom-upload',
    removedFiles,
    updatedAt: Date.now()
  };

  coversCache[key] = record;
  saveCoversCache();
  return record;
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

const CANONICAL_TITLE_MAP = {
  'batman: arkham asylum goty edition': 'Batman: Arkham Asylum',
  'bioshock remastered': 'BioShock',
  'bioshock 2 remastered': 'BioShock 2',
  'borderlands goty': 'Borderlands',
  'borderlands goty enhanced': 'Borderlands',
  'call of duty: modern warfare 2 (2009) - multiplayer': 'Call of Duty: Modern Warfare 2 (2009)',
  'control ultimate edition': 'Control',
  'dark messiah of might & magic multi-player': 'Dark Messiah of Might & Magic',
  'dark messiah of might & magic single player': 'Dark Messiah of Might & Magic',
  'darksiders warmastered edition': 'Darksiders',
  'darksiders ii deathinitive edition': 'Darksiders II',
  'diablo iii: eternal collection': 'Diablo III',
  'diablo iii: reaper of souls - ultimate evil edition': 'Diablo III',
  "don't starve together": "Don't Starve",
  'dragon age: origins - ultimate edition': 'Dragon Age: Origins',
  'half-life 2: deathmatch': 'Half-Life 2',
  'half-life deathmatch: source': 'Half-Life 2',
  'hitman: world of assassination (cloud version)': 'HITMAN 3',
  'killing floor mod: defence alliance 2': 'Killing Floor',
  'quake iii: team arena': 'Quake III Arena',
  'red faction: guerrilla steam edition': 'Red Faction: Guerrilla',
  'red faction guerrilla re-mars-tered': 'Red Faction: Guerrilla',
  's.t.a.l.k.e.r.: shadow of chornobyl - enhanced edition': 'S.T.A.L.K.E.R.: Shadow of Chernobyl',
  'serious sam classic: the first encounter': 'Serious Sam: The First Encounter',
  'serious sam hd: the first encounter': 'Serious Sam: The First Encounter',
  'serious sam classics: revolution': 'Serious Sam: The First Encounter',
  'serious sam fusion 2017 (beta)': 'Serious Sam: The First Encounter',
  'serious sam classic: the second encounter': 'Serious Sam: The Second Encounter',
  'serious sam hd: the second encounter': 'Serious Sam: The Second Encounter',
  "sid meier's civilization iv: beyond the sword": "Sid Meier's Civilization IV",
  "sid meier's civilization iv: colonization": "Sid Meier's Civilization IV",
  "sid meier's civilization iv: warlords": "Sid Meier's Civilization IV",
  'warhammer 40,000: dawn of war ii - anniversary edition': 'Warhammer 40,000: Dawn of War II',
  'warhammer 40,000: dawn of war ii - chaos rising': 'Warhammer 40,000: Dawn of War II',
  'warhammer 40,000: dawn of war ii - retribution': 'Warhammer 40,000: Dawn of War II',
  'aion collectors edition': 'Aion',
  'command & conquer remastered collection': 'Command & Conquer',
  'dead or alive 5 last round': 'DEAD OR ALIVE 5',
  'diablo ii: resurrected': 'Diablo II',
  'dying light: the following - enhanced edition': 'Dying Light',
  'mario kart 8 deluxe': 'Mario Kart 8',
  'new super mario bros. u deluxe': 'New Super Mario Bros. U',
  'ori and the blind forest: definitive edition': 'Ori and the Blind Forest',
  'plants vs. zombies: game of the year': 'Plants vs. Zombies',
  'poker night at the inventory (2010 original version)': 'Poker Night at the Inventory',
  'railroad tycoon 2: platinum': 'Railroad Tycoon 2',
  'rocksmith 2014 edition - remastered': 'Rocksmith 2014',
  "sid meier's civilization iii: complete": "Sid Meier's Civilization III",
  'star wars: the force unleashed ultimate sith edition': 'STAR WARS: The Force Unleashed',
  "super mario 3d world + bowser's fury": 'Super Mario 3D World',
  'the witcher 2: assassins of kings enhanced edition': 'The Witcher 2: Assassins of Kings',
  'the witcher 3: wild hunt - complete edition': 'The Witcher 3: Wild Hunt',
  'unreal tournament 3: black edition': 'Unreal Tournament 3'
};

function getCanonicalTitle(rawName) {
  const norm = normalizeName(rawName);
  return CANONICAL_TITLE_MAP[norm] || String(rawName || '').trim();
}

function parseLibraryCSV() {
  if (!fs.existsSync(LIBRARY_CSV_PATH)) {
    return [];
  }
  const content = fs.readFileSync(LIBRARY_CSV_PATH, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const mergedMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const rawName = cols[0];
    if (!rawName) continue;
    const name = getCanonicalTitle(rawName);
    const norm = normalizeName(name);

    const platforms = [];
    if (cols[1] && cols[1].toUpperCase() === 'X') platforms.push('Steam');
    if (cols[2] && cols[2].toUpperCase() === 'X') platforms.push('PS4');
    if (cols[3] && cols[3].toUpperCase() === 'X') platforms.push('PS5');
    if (cols[4] && cols[4].toUpperCase() === 'X') platforms.push('Switch');

    const hoursRaw = cols[5] ? parseFloat(cols[5]) : null;
    const steamHours = !isNaN(hoursRaw) && hoursRaw !== null ? hoursRaw : null;

    if (!mergedMap.has(norm)) {
      mergedMap.set(norm, {
        name,
        platforms: new Set(platforms),
        steamHours
      });
    } else {
      const existing = mergedMap.get(norm);
      platforms.forEach((p) => existing.platforms.add(p));
      if (steamHours !== null) {
        existing.steamHours =
          existing.steamHours !== null
            ? Number((existing.steamHours + steamHours).toFixed(1))
            : steamHours;
      }
    }
  }

  const games = [];
  for (const entry of mergedMap.values()) {
    const platList = entry.platforms.has('Steam') ? ['Steam'] : Array.from(entry.platforms);
    games.push({
      name: entry.name,
      platforms: platList,
      steamHours: entry.steamHours
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

  for (const line of lines) {
    const tableMatch = line.match(/^\|\s*\*\*([SABCD])-Tier\*\*\s*\|\s*([^|]+)\|/i);
    if (tableMatch) {
      const tierId = tableMatch[1].toUpperCase();
      const desc = tableMatch[2].trim();
      if (desc) descriptions[tierId] = desc;
    }
  }

  let currentTier = null;
  let foundDetailedBullets = false;
  const seenGlobal = new Set();

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
        const rawName = getCanonicalTitle(unescapeMarkdown(bulletMatch[1].replace(/^\*\*|\*\*$/g, '')));
        const norm = normalizeName(rawName);
        if (!seenGlobal.has(norm)) {
          seenGlobal.add(norm);
          tierMap[currentTier].push(rawName);
          foundDetailedBullets = true;
        }
      }
    }
  }

  if (!foundDetailedBullets) {
    for (const line of lines) {
      const rowMatch = line.match(/^\|\s*\*\*([SABCD])-Tier\*\*\s*\|[^|]+\|[^|]+\|\s*([^|]+)\|/i);
      if (rowMatch) {
        const tierId = rowMatch[1].toUpperCase();
        const gamesCell = unescapeMarkdown(rowMatch[2]);
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

// Search external APIs for cover candidates
async function searchCoverCandidates(query) {
  const candidates = [];
  const seenUrls = new Set();

  const cleaned = query
    .replace(/\s*\((20\d\d|19\d\d|Cloud Version).*?\)/gi, '')
    .replace(/\s*-\s*(Multiplayer|Single Player|Complete Edition|Enhanced Edition|Anniversary Edition)$/gi, '')
    .trim();

  const searchTerms = [query];
  if (cleaned && cleaned !== query) searchTerms.push(cleaned);

  // 1. Steam Store Search
  for (const term of searchTerms) {
    try {
      const steamUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
      const data = await httpsGetJson(steamUrl);
      if (data && Array.isArray(data.items)) {
        for (const item of data.items.slice(0, 6)) {
          if (item && item.id) {
            const boxUrl = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/library_600x900.jpg`;
            const headerUrl = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`;
            if (!seenUrls.has(boxUrl)) {
              seenUrls.add(boxUrl);
              candidates.push({
                title: `${item.name} (Box Art)`,
                url: boxUrl,
                fallbackUrl: headerUrl,
                tinyUrl: item.tiny_image || null,
                steamAppId: item.id,
                source: 'steam'
              });
            }
            if (!seenUrls.has(headerUrl)) {
              seenUrls.add(headerUrl);
              candidates.push({
                title: `${item.name} (Header)`,
                url: headerUrl,
                fallbackUrl: item.tiny_image || null,
                steamAppId: item.id,
                source: 'steam-header'
              });
            }
          }
        }
      }
      if (candidates.length > 0) break;
    } catch (_) {}
  }

  // 2. Wikipedia PageImages
  for (const term of [`${cleaned} (video game)`, cleaned]) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(
        term
      )}&gsrlimit=5&pithumbsize=500`;
      const data = await httpsGetJson(wikiUrl);
      if (data && data.query && data.query.pages) {
        const pages = Object.values(data.query.pages).sort((a, b) => (a.index || 99) - (b.index || 99));
        for (const page of pages) {
          if (page.thumbnail && page.thumbnail.source && !seenUrls.has(page.thumbnail.source)) {
            seenUrls.add(page.thumbnail.source);
            candidates.push({
              title: `${page.title} (Wikipedia)`,
              url: page.thumbnail.source,
              fallbackUrl: null,
              source: 'wikipedia'
            });
          }
        }
      }
      if (candidates.length >= 8) break;
    } catch (_) {}
  }

  return candidates;
}

// Fetch cover art for a game: checks custom override or local assets/ first, otherwise downloads to assets/
async function fetchCoverForGame(gameName) {
  const key = normalizeName(gameName);
  const cached = coversCache[key];

  // 1. If the user explicitly changed this cover to a custom cover, return it without calling APIs
  if (cached && cached.isCustom && cached.url) {
    return cached;
  }

  // 2. If a local asset already exists in assets/, return it immediately without calling APIs!
  const existingLocal = findLocalAssetForGame(gameName);
  if (existingLocal) {
    return existingLocal;
  }

  // 3. If covers.json already has a known remote URL (e.g. seeded Steam cover), download it to assets/
  if (cached && cached.url && /^https?:\/\//i.test(cached.url)) {
    try {
      const saved = await downloadAndSaveAsset(
        gameName,
        [cached.url, cached.fallbackUrl, cached.tinyUrl],
        { steamAppId: cached.steamAppId, source: cached.source || 'steam' }
      );
      return saved;
    } catch (_) {
      // If server cannot reach external internet right now, return the cached entry so browser can handle it
      return cached;
    }
  }

  // 4. Query external APIs (Steam + Wikipedia) and download to assets/
  const candidates = await searchCoverCandidates(gameName);
  if (candidates.length > 0) {
    const best = candidates[0];
    try {
      const saved = await downloadAndSaveAsset(
        gameName,
        [best.url, best.fallbackUrl, best.tinyUrl],
        { steamAppId: best.steamAppId, source: best.source }
      );
      return saved;
    } catch (_) {
      // Return candidate URL so browser can fetch & upload to /api/cover-cache
      coversCache[key] = best;
      saveCoversCache();
      return best;
    }
  }

  return { url: null, source: 'none' };
}

function getCoverForState(gameName) {
  const key = normalizeName(gameName);
  const cached = coversCache[key];
  if (cached && cached.isCustom && cached.url) {
    return cached;
  }
  const local = findLocalAssetForGame(gameName);
  if (local) return local;
  return cached || null;
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
      return {
        id: norm,
        name,
        canonicalName,
        platforms: libEntry ? libEntry.platforms : [],
        steamHours: libEntry ? libEntry.steamHours : null,
        cover: getCoverForState(name)
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
        cover: getCoverForState(g.name)
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
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function readRequestBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

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

  // API: Fetch or resolve cover art for a game (checks local assets/ first)
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

  // API: Search candidate covers for the "Change Cover Art" modal
  if (req.method === 'GET' && pathname === '/api/cover/search') {
    const query = parsedUrl.searchParams.get('q');
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing q parameter' }));
      return;
    }
    try {
      const candidates = await searchCoverCandidates(query);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ candidates }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Save client-resolved cover art to local assets/ store
  if (req.method === 'POST' && pathname === '/api/cover-cache') {
    try {
      const body = await readRequestBody(req);
      const { name, cover, dataUrl } = JSON.parse(body);
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing game name' }));
        return;
      }

      const key = normalizeName(name);
      if (coversCache[key] && coversCache[key].isCustom) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, cover: coversCache[key] }));
        return;
      }

      // If local asset already exists, do not overwrite during background auto-caching
      const existing = findLocalAssetForGame(name);
      if (existing) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, cover: existing }));
        return;
      }

      if (dataUrl) {
        const saved = saveDataUrlAsset(name, dataUrl, cover || {});
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, cover: saved }));
        return;
      }

      if (cover && cover.url) {
        try {
          const saved = await downloadAndSaveAsset(
            name,
            [cover.url, cover.fallbackUrl, cover.tinyUrl],
            cover
          );
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, cover: saved }));
          return;
        } catch (_) {
          coversCache[normalizeName(name)] = cover;
          saveCoversCache();
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, cover: coversCache[normalizeName(name)] || cover }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: User explicitly changes cover art (removes existing local asset and saves the new cover)
  if (req.method === 'POST' && pathname === '/api/cover/change') {
    try {
      const body = await readRequestBody(req);
      const { name, imageUrl, fallbackUrl, dataUrl, source } = JSON.parse(body);
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing game name' }));
        return;
      }

      // Always remove existing local asset in assets/ first
      const removedFiles = removeLocalAssetForGame(name);
      const key = normalizeName(name);

      // Case 1: User selected/entered a new URL or uploaded a custom image to save instead of the local asset
      const customUrl = imageUrl || dataUrl;
      if (customUrl) {
        const customRecord = {
          url: customUrl,
          fallbackUrl: fallbackUrl || null,
          isCustom: true,
          hasLocalAsset: false,
          localFile: null,
          remoteUrl: imageUrl || null,
          source: source || (dataUrl ? 'custom-upload' : 'custom-url'),
          removedFiles,
          updatedAt: Date.now()
        };
        coversCache[key] = customRecord;
        saveCoversCache();
        try {
          require('./build-static.js').buildStaticPages();
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, removedFiles, cover: customRecord }));
        return;
      }

      // Case 2: Reset / clear cover art (remove local asset and clear cache entry so it can be re-fetched)
      delete coversCache[key];
      saveCoversCache();
      try {
        require('./build-static.js').buildStaticPages();
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, removedFiles, cover: null }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Save updated tier list to tier_list.md
  if (req.method === 'POST' && pathname === '/api/save') {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const tiersData = payload.tiers || {};
      const descriptions = payload.descriptions || {};
      const markdown = generateTierListMD(tiersData, descriptions);
      fs.writeFileSync(TIER_LIST_PATH, markdown, 'utf8');
      try {
        require('./build-static.js').buildStaticPages();
      } catch (_) {}
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
    return;
  }

  // Static files (serve interactive editor at '/' when running locally; /index.html is the static GitHub Pages build)
  let safePath = pathname === '/' ? '/editor.html' : decodeURIComponent(pathname);
  const filePath = path.join(ROOT_DIR, path.normalize(safePath));
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isAsset = safePath.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
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
  ASSETS_DIR,
  gameSlug,
  findLocalAssetForGame,
  removeLocalAssetForGame,
  downloadAndSaveAsset,
  saveDataUrlAsset,
  parseLibraryCSV,
  parseTierListMD,
  generateTierListMD,
  buildState,
  fetchCoverForGame
};
