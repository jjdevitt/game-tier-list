const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const DOCS_ASSETS_DIR = path.join(DOCS_DIR, 'assets');
const STATIC_INDEX_HTML = path.join(ROOT_DIR, 'index.html');
const STATIC_ROOT_HTML = path.join(ROOT_DIR, 'tier_list.html');
const STATIC_DOCS_HTML = path.join(DOCS_DIR, 'index.html');
const STYLES_CSS_PATH = path.join(ROOT_DIR, 'styles.css');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hashGradient(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 48) % 360;
  return `linear-gradient(145deg, hsl(${h1}, 48%, 24%), hsl(${h2}, 55%, 14%))`;
}

function getInitials(name) {
  const words = String(name || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '🎮';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function buildStaticPages() {
  const serverMod = require('./server.js');
  const state = serverMod.buildState();
  const baseStyles = fs.existsSync(STYLES_CSS_PATH) ? fs.readFileSync(STYLES_CSS_PATH, 'utf8') : '';

  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DOCS_ASSETS_DIR)) {
    fs.mkdirSync(DOCS_ASSETS_DIR, { recursive: true });
  }

  const KNOWN_STEAM_COVERS = {
    'aperture desk job': {
      url: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1902490/library_600x900.jpg',
      fallbackUrl: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1902490/header.jpg',
      steamAppId: 1902490
    }
  };

  function prepareGameCover(item) {
    const c = item.cover || KNOWN_STEAM_COVERS[item.id] || null;
    let rootImgUrl = '';
    let docsImgUrl = '';
    const fallbacks = [];

    if (c) {
      if (c.steamAppId) {
        fallbacks.push(
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${c.steamAppId}/library_600x900.jpg`,
          `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${c.steamAppId}/header.jpg`
        );
      }
      if (c.remoteUrl && !fallbacks.includes(c.remoteUrl)) fallbacks.push(c.remoteUrl);
      if (c.fallbackUrl && !fallbacks.includes(c.fallbackUrl)) fallbacks.push(c.fallbackUrl);
      if (c.tinyUrl && !fallbacks.includes(c.tinyUrl)) fallbacks.push(c.tinyUrl);

      if (c.localFile) {
        const cleanRel = c.localFile.replace(/^\/+/, '');
        const srcAbs = path.join(ROOT_DIR, cleanRel);
        if (fs.existsSync(srcAbs)) {
          const fileName = path.basename(cleanRel);
          const destAbs = path.join(DOCS_ASSETS_DIR, fileName);
          try {
            fs.copyFileSync(srcAbs, destAbs);
          } catch (_) {}
          rootImgUrl = `assets/${fileName}`;
          docsImgUrl = `assets/${fileName}`;
        }
      } else if (c.url && c.url.startsWith('data:image/')) {
        // Keep exact custom clipboard-pasted / uploaded image data URL so it works 100% standalone
        rootImgUrl = c.url;
        docsImgUrl = c.url;
      } else if (c.url) {
        const cleanUrl = c.url.replace(/^\/+assets\//, 'assets/');
        rootImgUrl = cleanUrl;
        docsImgUrl = cleanUrl;
      }
    }

    if (!rootImgUrl && fallbacks.length > 0) {
      rootImgUrl = fallbacks[0];
      docsImgUrl = fallbacks[0];
    }

    item._rootImgUrl = rootImgUrl;
    item._docsImgUrl = docsImgUrl;
    item._fallbacks = fallbacks;
  }

  let totalRanked = 0;
  for (const tier of state.tiers) {
    totalRanked += tier.items.length;
    for (const item of tier.items) {
      prepareGameCover(item);
    }
  }
  for (const item of state.unranked) {
    prepareGameCover(item);
  }

  const totalUnranked = state.unranked.length;
  const totalLibrary = totalRanked + totalUnranked;

  function renderGameCardHtml(game, tierId, isDocsFolder) {
    const primaryUrl = isDocsFolder ? game._docsImgUrl : game._rootImgUrl;
    const fallbacks = (game._fallbacks || []).filter((u) => u && u !== primaryUrl);
    const platforms = game.platforms || [];
    const platBadges = platforms
      .map(
        (p) =>
          `<span class="plat-badge plat-${escapeHtml(p)}">${
            p === 'Switch' ? 'NSW' : escapeHtml(p)
          }</span>`
      )
      .join('');

    const hoursBadge =
      game.steamHours !== null && game.steamHours !== undefined && game.steamHours > 0
        ? `<span class="hours-badge">${escapeHtml(game.steamHours)}h</span>`
        : '';

    const needsLazyLookup = !primaryUrl ? 'true' : 'false';
    const imgHtml = primaryUrl
      ? `<img
          class="card-cover-img"
          src="${escapeHtml(primaryUrl)}"
          data-fallbacks="${escapeHtml(JSON.stringify(fallbacks))}"
          alt="${escapeHtml(game.name)}"
          loading="lazy"
          draggable="false"
        />`
      : '';

    return `
      <div
        class="game-card static-card"
        data-game-id="${escapeHtml(game.id)}"
        data-game-name="${escapeHtml(game.name)}"
        data-tier="${escapeHtml(tierId)}"
        data-platforms="${escapeHtml(platforms.join(','))}"
        data-hours="${game.steamHours !== null && game.steamHours !== undefined ? escapeHtml(game.steamHours) : ''}"
        data-needs-lookup="${needsLazyLookup}"
        title="${escapeHtml(game.name)}${
          platforms.length ? ` (${escapeHtml(platforms.join(', '))})` : ''
        }${game.steamHours ? ` • ${escapeHtml(game.steamHours)} hrs on Steam` : ''}"
      >
        <div class="card-fallback-art" style="background: ${hashGradient(game.name)}">
          <div class="fallback-initials">${escapeHtml(getInitials(game.name))}</div>
          <div class="fallback-title">${escapeHtml(game.name)}</div>
        </div>
        ${imgHtml}
        <div class="card-top-meta">
          <div class="platform-dots">${platBadges}</div>
          ${hoursBadge}
        </div>
        <div class="card-title-overlay">
          <div class="card-title-text">${escapeHtml(game.name)}</div>
        </div>
      </div>`;
  }

  function renderHtmlDocument(isDocsFolder) {
    const tierColors = {
      S: 'var(--tier-s)',
      A: 'var(--tier-a)',
      B: 'var(--tier-b)',
      C: 'var(--tier-c)',
      D: 'var(--tier-d)'
    };

    const tierRowsHtml = state.tiers
      .map((tier) => {
        const cardsHtml =
          tier.items.length === 0
            ? `<div class="tier-empty-placeholder">No games ranked in ${escapeHtml(tier.id)}-Tier</div>`
            : tier.items.map((g) => renderGameCardHtml(g, tier.id, isDocsFolder)).join('');

        return `
        <div class="tier-row" data-tier="${escapeHtml(tier.id)}">
          <div class="tier-label-col">
            <div class="tier-badge-letter" style="background: ${tierColors[tier.id] || '#888'}">${escapeHtml(
              tier.shortLabel || tier.id
            )}</div>
            <div class="tier-name-title">${escapeHtml(tier.id)}-Tier</div>
            <div class="tier-desc">${escapeHtml(tier.description)}</div>
            <div class="tier-count-pill">${tier.items.length} ${
              tier.items.length === 1 ? 'Game' : 'Games'
            }</div>
          </div>
          <div class="tier-items-dropzone" data-tier="${escapeHtml(tier.id)}">
            ${cardsHtml}
          </div>
        </div>`;
      })
      .join('\n');

    // Sort unranked alphabetically by default just like the local app
    const sortedUnranked = [...state.unranked].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    const unrankedCardsHtml = sortedUnranked
      .map((g) => renderGameCardHtml(g, 'UNRANKED', isDocsFolder))
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Video Game Tier List</title>
  <style>
${baseStyles}

/* Static page overrides */
.game-card.static-card {
  cursor: default;
}
.game-card.static-card.hidden-card {
  display: none !important;
}
  </style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <div class="logo-badge">🎮</div>
      <div>
        <h1>Video Game Tier List</h1>
        <p class="subtitle">
          Synced with <code>tier_list.md</code>, <code>library.csv</code> &amp; local <code>assets/</code>
        </p>
      </div>
    </div>

    <div class="header-stats" id="headerStats">
      <div class="stat-pill">
        <span class="stat-value" id="rankedCount">${totalRanked}</span>
        <span class="stat-label">Ranked</span>
      </div>
      <div class="stat-pill">
        <span class="stat-value" id="unrankedCount">${totalUnranked}</span>
        <span class="stat-label">Unranked</span>
      </div>
      <div class="stat-pill">
        <span class="stat-value" id="totalCount">${totalLibrary}</span>
        <span class="stat-label">Total Library</span>
      </div>
    </div>
  </header>

  <main class="app-main">
    <!-- Tier List Board -->
    <section class="tier-board-section">
      <div class="section-header">
        <h2>Ranked Tiers</h2>
        <span class="hint-text">${totalRanked} games ranked from S-Tier down to D-Tier</span>
      </div>
      <div class="tier-board" id="tierBoard">
        ${tierRowsHtml}
      </div>
    </section>

    <!-- Unranked Pool -->
    <section class="unranked-section" id="unrankedSection">
      <div class="unranked-header">
        <div class="unranked-title-group">
          <h2>Unranked Library</h2>
          <span class="badge-count" id="unrankedFilteredCount">${totalUnranked} games</span>
        </div>

        <div class="unranked-controls">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input
              type="text"
              id="searchInput"
              placeholder="Search unranked games..."
              autocomplete="off"
            />
            <button type="button" class="clear-search hidden" id="clearSearchBtn" title="Clear search">✕</button>
          </div>

          <div class="platform-filters" id="platformFilters">
            <button type="button" class="filter-pill active" data-platform="ALL">All</button>
            <button type="button" class="filter-pill" data-platform="Steam">Steam</button>
            <button type="button" class="filter-pill" data-platform="PS4">PS4</button>
            <button type="button" class="filter-pill" data-platform="PS5">PS5</button>
            <button type="button" class="filter-pill" data-platform="Switch">Switch</button>
          </div>

          <div class="sort-box">
            <label for="sortSelect">Sort:</label>
            <select id="sortSelect">
              <option value="alpha">Name (A–Z)</option>
              <option value="hours-desc">Steam Hours (High → Low)</option>
              <option value="platforms-desc">Most Platforms</option>
            </select>
          </div>
        </div>
      </div>

      <div class="unranked-dropzone" id="unrankedDropzone" data-tier="UNRANKED">
        <div class="unranked-grid" id="unrankedGrid">
          ${unrankedCardsHtml}
        </div>
      </div>
    </section>
  </main>

  <script>
    (() => {
      // Handle image fallback chain if a local asset isn't found
      document.querySelectorAll('.card-cover-img').forEach((img) => {
        let fallbacks = [];
        try {
          fallbacks = JSON.parse(img.dataset.fallbacks || '[]');
        } catch (_) {}
        let idx = 0;
        img.addEventListener('error', () => {
          if (idx < fallbacks.length) {
            img.src = fallbacks[idx++];
          } else {
            img.remove();
          }
        });
      });

      // Unranked search, platform filter, and sorting
      const unrankedGrid = document.getElementById('unrankedGrid');
      const unrankedCards = Array.from(unrankedGrid.querySelectorAll('.game-card'));
      const unrankedFilteredCount = document.getElementById('unrankedFilteredCount');
      const searchInput = document.getElementById('searchInput');
      const clearSearchBtn = document.getElementById('clearSearchBtn');
      const platformFilters = document.getElementById('platformFilters');
      const sortSelect = document.getElementById('sortSelect');

      let searchQuery = '';
      let activePlatform = 'ALL';
      let sortMode = 'alpha';
      const totalUnranked = unrankedCards.length;

      function applyUnrankedFilterAndSort() {
        const q = searchQuery.trim().toLowerCase();
        let visibleCount = 0;

        unrankedCards.forEach((card) => {
          const name = (card.dataset.gameName || '').toLowerCase();
          const plats = (card.dataset.platforms || '').split(',').filter(Boolean);
          const matchPlat = activePlatform === 'ALL' || plats.includes(activePlatform);
          const matchQuery = !q || name.includes(q);
          const visible = matchPlat && matchQuery;
          card.classList.toggle('hidden-card', !visible);
          if (visible) visibleCount++;
        });

        unrankedCards.sort((a, b) => {
          if (sortMode === 'hours-desc') {
            const ha = parseFloat(a.dataset.hours || '0') || 0;
            const hb = parseFloat(b.dataset.hours || '0') || 0;
            if (hb !== ha) return hb - ha;
          } else if (sortMode === 'platforms-desc') {
            const pa = (a.dataset.platforms || '').split(',').filter(Boolean).length;
            const pb = (b.dataset.platforms || '').split(',').filter(Boolean).length;
            if (pb !== pa) return pb - pa;
          }
          return (a.dataset.gameName || '').localeCompare(b.dataset.gameName || '', undefined, {
            sensitivity: 'base'
          });
        });

        const frag = document.createDocumentFragment();
        unrankedCards.forEach((c) => frag.appendChild(c));
        unrankedGrid.appendChild(frag);

        unrankedFilteredCount.textContent =
          visibleCount === totalUnranked
            ? totalUnranked + ' games'
            : visibleCount + ' of ' + totalUnranked + ' games';
      }

      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        clearSearchBtn.classList.toggle('hidden', !searchQuery);
        applyUnrankedFilterAndSort();
      });

      clearSearchBtn.addEventListener('click', () => {
        searchQuery = '';
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        applyUnrankedFilterAndSort();
      });

      platformFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-pill');
        if (!btn) return;
        platformFilters.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activePlatform = btn.dataset.platform;
        applyUnrankedFilterAndSort();
      });

      sortSelect.addEventListener('change', (e) => {
        sortMode = e.target.value;
        applyUnrankedFilterAndSort();
      });

      // Lazy cover lookup for any unranked card without a pre-downloaded asset
      const queue = [];
      let active = 0;
      const MAX_CONCURRENT = 3;

      function normalizeName(s) {
        return String(s || '').trim().toLowerCase();
      }

      async function fetchDynamicCover(card) {
        const gameName = card.dataset.gameName || '';
        const cleaned = gameName
          .replace(/\\s*\\((20\\d\\d|19\\d\\d|Cloud Version).*?\\)/gi, '')
          .replace(/\\s*-\\s*(Multiplayer|Single Player|Complete Edition|Enhanced Edition|Anniversary Edition)$/gi, '')
          .trim();

        try {
          const csRes = await fetch(
            'https://www.cheapshark.com/api/1.0/games?title=' + encodeURIComponent(cleaned) + '&limit=5'
          );
          if (csRes.ok) {
            const items = await csRes.json();
            if (Array.isArray(items) && items.length > 0) {
              const normClean = normalizeName(cleaned);
              const best =
                items.find((it) => normalizeName(it.external) === normClean && it.steamAppID) ||
                items.find((it) => it.steamAppID) ||
                items[0];
              if (best) {
                const primary = best.steamAppID
                  ? 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' +
                    best.steamAppID +
                    '/library_600x900.jpg'
                  : best.thumb;
                const fallback = best.steamAppID
                  ? 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/' +
                    best.steamAppID +
                    '/header.jpg'
                  : best.thumb;
                if (primary) {
                  attachImg(card, primary, fallback);
                  return;
                }
              }
            }
          }
        } catch (_) {}

        try {
          const wikiRes = await fetch(
            'https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&prop=pageimages&generator=search&gsrsearch=' +
              encodeURIComponent(cleaned + ' video game') +
              '&gsrlimit=3&pithumbsize=400'
          );
          if (wikiRes.ok) {
            const data = await wikiRes.json();
            if (data && data.query && data.query.pages) {
              const pages = Object.values(data.query.pages).sort((a, b) => (a.index || 99) - (b.index || 99));
              for (const p of pages) {
                if (p.thumbnail && p.thumbnail.source) {
                  attachImg(card, p.thumbnail.source, null);
                  return;
                }
              }
            }
          }
        } catch (_) {}
      }

      function attachImg(card, src, fallback) {
        if (card.querySelector('.card-cover-img')) return;
        const img = document.createElement('img');
        img.className = 'card-cover-img';
        img.alt = card.dataset.gameName || '';
        img.loading = 'lazy';
        img.draggable = false;
        img.onerror = () => {
          if (fallback && img.src !== fallback) {
            img.src = fallback;
          } else {
            img.remove();
          }
        };
        img.src = src;
        card.appendChild(img);
      }

      function processQueue() {
        while (active < MAX_CONCURRENT && queue.length > 0) {
          const card = queue.shift();
          active++;
          fetchDynamicCover(card).finally(() => {
            active--;
            processQueue();
          });
        }
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const card = entry.target;
              observer.unobserve(card);
              queue.push(card);
              processQueue();
            }
          });
        },
        { rootMargin: '250px 0px' }
      );

      document.querySelectorAll('.game-card[data-needs-lookup="true"]').forEach((card) => {
        observer.observe(card);
      });
    })();
  </script>
</body>
</html>`;
  }

  const rootHtmlContent = renderHtmlDocument(false);
  fs.writeFileSync(STATIC_INDEX_HTML, rootHtmlContent, 'utf8');
  fs.writeFileSync(STATIC_ROOT_HTML, rootHtmlContent, 'utf8');
  fs.writeFileSync(STATIC_DOCS_HTML, renderHtmlDocument(true), 'utf8');

  return {
    indexHtml: STATIC_INDEX_HTML,
    rootHtml: STATIC_ROOT_HTML,
    docsHtml: STATIC_DOCS_HTML,
    totalRanked,
    totalUnranked
  };
}

if (require.main === module) {
  const res = buildStaticPages();
  console.log(
    `Generated static pages (${res.totalRanked} ranked, ${res.totalUnranked} unranked):`
  );
  console.log(' -', res.indexHtml);
  console.log(' -', res.rootHtml);
  console.log(' -', res.docsHtml);
}

module.exports = { buildStaticPages };
