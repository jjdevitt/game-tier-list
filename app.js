(() => {
  // Application State
  let appState = {
    tiers: [],
    unranked: [],
    totalLibraryCount: 0
  };
  let initialSnapshot = '';
  let isDirty = false;

  // Filter & Sort state for Unranked pool
  let searchQuery = '';
  let activePlatform = 'ALL';
  let sortMode = 'alpha';

  // Drag & Drop state
  let draggedGameId = null;
  let draggedSourceTier = null;

  // Cover fetching queue & cache
  const coverMemoryCache = new Map();
  const pendingCoverFetches = new Set();
  const coverQueue = [];
  let activeWorkers = 0;
  const MAX_CONCURRENT_COVER_FETCHES = 3;

  // DOM Elements
  const tierBoardEl = document.getElementById('tierBoard');
  const unrankedGridEl = document.getElementById('unrankedGrid');
  const unrankedDropzoneEl = document.getElementById('unrankedDropzone');
  const rankedCountEl = document.getElementById('rankedCount');
  const unrankedCountEl = document.getElementById('unrankedCount');
  const totalCountEl = document.getElementById('totalCount');
  const unrankedFilteredCountEl = document.getElementById('unrankedFilteredCount');
  const unsavedBadgeEl = document.getElementById('unsavedBadge');
  const saveBtn = document.getElementById('saveBtn');
  const saveBtnText = document.getElementById('saveBtnText');
  const resetBtn = document.getElementById('resetBtn');
  const previewBtn = document.getElementById('previewBtn');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const platformFiltersEl = document.getElementById('platformFilters');
  const sortSelect = document.getElementById('sortSelect');
  const previewModal = document.getElementById('previewModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const copyMdBtn = document.getElementById('copyMdBtn');
  const markdownPreviewText = document.getElementById('markdownPreviewText');
  const toastContainer = document.getElementById('toastContainer');

  const TIER_COLORS = {
    S: 'var(--tier-s)',
    A: 'var(--tier-a)',
    B: 'var(--tier-b)',
    C: 'var(--tier-c)',
    D: 'var(--tier-d)'
  };

  // IntersectionObserver for lazy-loading cover art as cards scroll into view
  const cardObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cardEl = entry.target;
          const gameName = cardEl.dataset.gameName;
          const gameId = cardEl.dataset.gameId;
          cardObserver.unobserve(cardEl);
          if (gameName && gameId) {
            enqueueCoverLookup(gameId, gameName);
          }
        }
      }
    },
    { rootMargin: '250px 0px' }
  );

  function normalizeName(name) {
    return String(name || '')
      .replace(/\\([!#*_\[\]()])/g, '$1')
      .trim()
      .toLowerCase();
  }

  function escapeMarkdown(text) {
    return String(text || '').replace(/!/g, '\\!');
  }

  function unescapeMarkdown(text) {
    return String(text || '').replace(/\\([!#*_\[\]()])/g, '$1').trim();
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
    const words = name
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return '🎮';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  function snapshotState() {
    return JSON.stringify(
      appState.tiers.map((t) => ({
        id: t.id,
        items: t.items.map((g) => g.id)
      }))
    );
  }

  function updateDirtyStatus() {
    const current = snapshotState();
    isDirty = current !== initialSnapshot;
    unsavedBadgeEl.classList.toggle('hidden', !isDirty);
    resetBtn.classList.toggle('hidden', !isDirty);
    saveBtn.classList.toggle('pulse-dirty', isDirty);
  }

  // Generate tier_list.md content on the client (for preview and fallback save)
  function generateTierListMarkdown() {
    let totalRanked = 0;
    for (const tier of appState.tiers) {
      totalRanked += tier.items.length;
    }

    const lines = [];
    lines.push('# **Video Game Tier List**');
    lines.push('');
    lines.push('# **Overview**');
    lines.push('');
    lines.push(
      `A compilation of the ${totalRanked} video ${
        totalRanked === 1 ? 'game' : 'games'
      } ranked across our sessions, organized from S-Tier down to D-Tier.`
    );
    lines.push('');
    lines.push('# **Tier Breakdown Summary**');
    lines.push('');
    lines.push('| Tier | Description | Count | Games |');
    lines.push('| :---- | :---- | :---- | :---- |');

    for (const tier of appState.tiers) {
      const count = tier.items.length;
      const gamesFormatted = tier.items.map((g) => escapeMarkdown(g.name)).join(', ');
      lines.push(`| **${tier.id}-Tier** | ${tier.description} | ${count} | ${gamesFormatted} |`);
    }

    lines.push('');
    lines.push('# **Detailed Tier List**');

    for (const tier of appState.tiers) {
      const count = tier.items.length;
      const gameWord = count === 1 ? 'Game' : 'Games';
      lines.push('');
      lines.push(`## **${tier.id}-Tier (${count} ${gameWord})**`);
      lines.push('');
      tier.items.forEach((game, idx) => {
        const escaped = escapeMarkdown(game.name);
        const trailing = idx < tier.items.length - 1 ? '  ' : '';
        lines.push(`* **${escaped}**${trailing}`);
      });
    }

    lines.push('');
    lines.push('');
    return lines.join('\n');
  }

  // Fallback client-side parser if server API isn't running
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

  async function loadInitialState() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('API unavailable');
      const data = await res.json();
      appState = data;
      // Populate memory cover cache from initial state
      for (const tier of appState.tiers) {
        for (const item of tier.items) {
          if (item.cover && item.cover.url) {
            coverMemoryCache.set(item.id, item.cover);
          }
        }
      }
      for (const item of appState.unranked) {
        if (item.cover && item.cover.url) {
          coverMemoryCache.set(item.id, item.cover);
        }
      }
      initialSnapshot = snapshotState();
      renderAll();
    } catch (err) {
      // Fallback: fetch static files directly
      await loadStaticFallback();
    }
  }

  async function loadStaticFallback() {
    try {
      const [csvRes, mdRes, coversRes] = await Promise.all([
        fetch('./library.csv'),
        fetch('./tier_list.md'),
        fetch('./covers.json').catch(() => null)
      ]);
      const csvText = await csvRes.text();
      const mdText = await mdRes.text();
      const coversJson = coversRes && coversRes.ok ? await coversRes.json() : {};

      Object.entries(coversJson).forEach(([k, v]) => {
        if (v && v.url) coverMemoryCache.set(k, v);
      });

      const csvLines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const libGames = [];
      const libMap = new Map();

      for (let i = 1; i < csvLines.length; i++) {
        const cols = parseCSVLine(csvLines[i]);
        const name = cols[0];
        if (!name) continue;
        const norm = normalizeName(name);
        if (libMap.has(norm)) continue;
        const platforms = [];
        if (cols[1] === 'X') platforms.push('Steam');
        if (cols[2] === 'X') platforms.push('PS4');
        if (cols[3] === 'X') platforms.push('PS5');
        if (cols[4] === 'X') platforms.push('Switch');
        const steamHours = cols[5] ? parseFloat(cols[5]) : null;
        const entry = { id: norm, name, canonicalName: name, platforms, steamHours };
        libGames.push(entry);
        libMap.set(norm, entry);
      }

      const defaultTiers = [
        { id: 'S', label: 'S-Tier', shortLabel: 'S', description: 'Exceptional masterpieces and personal favorites' },
        { id: 'A', label: 'A-Tier', shortLabel: 'A', description: 'Outstanding titles with fantastic gameplay and design' },
        { id: 'B', label: 'B-Tier', shortLabel: 'B', description: 'Solid, enjoyable games worth playing' },
        { id: 'C', label: 'C-Tier', shortLabel: 'C', description: 'Decent casual fun, but limited depth or appeal' },
        { id: 'D', label: 'D-Tier', shortLabel: 'D', description: 'Underwhelming or frustrating experiences' }
      ];

      const tierMap = { S: [], A: [], B: [], C: [], D: [] };
      let currentTier = null;
      for (const line of mdText.split(/\r?\n/)) {
        const hMatch = line.match(/^##\s+\*\*([SABCD])-Tier/i);
        if (hMatch) {
          currentTier = hMatch[1].toUpperCase();
          continue;
        }
        if (currentTier && tierMap[currentTier]) {
          const bMatch = line.match(/^\*\s+\*\*(.+?)\*\*\s*$/);
          if (bMatch) {
            tierMap[currentTier].push(unescapeMarkdown(bMatch[1]));
          }
        }
      }

      const rankedSet = new Set();
      appState.tiers = defaultTiers.map((meta) => {
        const items = (tierMap[meta.id] || []).map((rawName) => {
          const norm = normalizeName(rawName);
          rankedSet.add(norm);
          const lib = libMap.get(norm);
          return {
            id: norm,
            name: rawName,
            canonicalName: lib ? lib.name : rawName,
            platforms: lib ? lib.platforms : [],
            steamHours: lib ? lib.steamHours : null,
            cover: coverMemoryCache.get(norm) || null
          };
        });
        return { ...meta, items };
      });

      appState.unranked = libGames
        .filter((g) => !rankedSet.has(g.id))
        .map((g) => ({ ...g, cover: coverMemoryCache.get(g.id) || null }));
      appState.totalLibraryCount = libGames.length;
      initialSnapshot = snapshotState();
      renderAll();
    } catch (err) {
      showToast('Failed to load tier_list.md or library.csv: ' + err.message, true);
    }
  }

  // Cover Art Resolution Queue (Server + Browser CORS Fallback)
  function enqueueCoverLookup(gameId, gameName) {
    if (coverMemoryCache.has(gameId) || pendingCoverFetches.has(gameId)) {
      return;
    }
    pendingCoverFetches.add(gameId);
    coverQueue.push({ gameId, gameName });
    processCoverQueue();
  }

  async function processCoverQueue() {
    while (activeWorkers < MAX_CONCURRENT_COVER_FETCHES && coverQueue.length > 0) {
      const task = coverQueue.shift();
      activeWorkers++;
      resolveCoverArt(task.gameId, task.gameName)
        .catch(() => {})
        .finally(() => {
          activeWorkers--;
          processCoverQueue();
        });
    }
  }

  async function resolveCoverArt(gameId, gameName) {
    // 1. Try server endpoint first
    try {
      const res = await fetch(`/api/cover?name=${encodeURIComponent(gameName)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.url) {
          coverMemoryCache.set(gameId, data);
          applyCoverToCardDom(gameId, data);
          return;
        }
      }
    } catch (_) {
      // Ignore and try browser CORS APIs
    }

    // 2. Browser-direct fallback via CheapShark (Steam AppID CORS API) + Wikipedia CORS API
    const cleaned = gameName
      .replace(/\s*\((20\d\d|19\d\d|Cloud Version).*?\)/gi, '')
      .replace(/\s*-\s*(Multiplayer|Single Player|Complete Edition|Enhanced Edition|Anniversary Edition)$/gi, '')
      .trim();

    try {
      const csUrl = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(cleaned)}&limit=5`;
      const csRes = await fetch(csUrl);
      if (csRes.ok) {
        const items = await csRes.json();
        if (Array.isArray(items) && items.length > 0) {
          const normClean = normalizeName(cleaned);
          const best =
            items.find((it) => normalizeName(it.external) === normClean && it.steamAppID) ||
            items.find((it) => it.steamAppID) ||
            items[0];
          if (best) {
            const cover = best.steamAppID
              ? {
                  url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${best.steamAppID}/library_600x900.jpg`,
                  fallbackUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${best.steamAppID}/header.jpg`,
                  tinyUrl: best.thumb || null,
                  steamAppId: Number(best.steamAppID),
                  source: 'steam-cs'
                }
              : {
                  url: best.thumb,
                  fallbackUrl: null,
                  source: 'cheapshark'
                };
            if (cover.url) {
              coverMemoryCache.set(gameId, cover);
              applyCoverToCardDom(gameId, cover);
              persistCoverToServer(gameName, cover);
              return;
            }
          }
        }
      }
    } catch (_) {
      // Next fallback
    }

    // 3. Wikipedia PageImages CORS API
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(
        cleaned + ' video game'
      )}&gsrlimit=3&pithumbsize=400`;
      const wikiRes = await fetch(wikiUrl);
      if (wikiRes.ok) {
        const data = await wikiRes.json();
        if (data && data.query && data.query.pages) {
          const pages = Object.values(data.query.pages).sort((a, b) => (a.index || 99) - (b.index || 99));
          for (const page of pages) {
            if (page.thumbnail && page.thumbnail.source) {
              const cover = {
                url: page.thumbnail.source,
                fallbackUrl: null,
                source: 'wikipedia'
              };
              coverMemoryCache.set(gameId, cover);
              applyCoverToCardDom(gameId, cover);
              persistCoverToServer(gameName, cover);
              return;
            }
          }
        }
      }
    } catch (_) {
      // Keep stylized card fallback
    }
  }

  function persistCoverToServer(gameName, cover) {
    fetch('/api/cover-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: gameName, cover })
    }).catch(() => {});
  }

  function applyCoverToCardDom(gameId, cover) {
    if (!cover || !cover.url) return;
    const cards = document.querySelectorAll(`.game-card[data-game-id="${CSS.escape(gameId)}"]`);
    cards.forEach((card) => {
      attachCoverImage(card, cover, card.dataset.gameName || '');
    });
  }

  function attachCoverImage(cardEl, cover, gameName) {
    if (!cover || !cover.url) return;
    let img = cardEl.querySelector('.card-cover-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'card-cover-img';
      img.alt = gameName;
      img.loading = 'lazy';
      img.draggable = false;
      cardEl.appendChild(img);
    }

    img.onerror = () => {
      if (cover.fallbackUrl && img.src !== cover.fallbackUrl) {
        img.src = cover.fallbackUrl;
      } else if (cover.tinyUrl && img.src !== cover.tinyUrl) {
        img.src = cover.tinyUrl;
      } else {
        img.remove();
      }
    };
    img.src = cover.url;
  }

  // Create a DOM node for a single game card
  function createGameCardElement(game, currentTierId) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.draggable = true;
    card.dataset.gameId = game.id;
    card.dataset.gameName = game.name;
    card.dataset.tier = currentTierId;
    card.title = `${game.name}${
      game.platforms && game.platforms.length ? ` (${game.platforms.join(', ')})` : ''
    }${game.steamHours ? ` • ${game.steamHours} hrs on Steam` : ''}`;

    // Stylized gradient fallback art behind cover image
    const fallback = document.createElement('div');
    fallback.className = 'card-fallback-art';
    fallback.style.background = hashGradient(game.name);

    const initials = document.createElement('div');
    initials.className = 'fallback-initials';
    initials.textContent = getInitials(game.name);

    const fbTitle = document.createElement('div');
    fbTitle.className = 'fallback-title';
    fbTitle.textContent = game.name;

    fallback.appendChild(initials);
    fallback.appendChild(fbTitle);
    card.appendChild(fallback);

    // Cover image if cached, otherwise observe for lazy loading
    const cachedCover = coverMemoryCache.get(game.id) || game.cover;
    if (cachedCover && cachedCover.url) {
      attachCoverImage(card, cachedCover, game.name);
    } else {
      cardObserver.observe(card);
    }

    // Top metadata badges (platforms + Steam hours)
    const topMeta = document.createElement('div');
    topMeta.className = 'card-top-meta';

    const platDots = document.createElement('div');
    platDots.className = 'platform-dots';
    (game.platforms || []).forEach((plat) => {
      const b = document.createElement('span');
      b.className = `plat-badge plat-${plat}`;
      b.textContent = plat === 'Switch' ? 'NSW' : plat;
      platDots.appendChild(b);
    });
    topMeta.appendChild(platDots);

    if (game.steamHours !== null && game.steamHours !== undefined && game.steamHours > 0) {
      const hrs = document.createElement('span');
      hrs.className = 'hours-badge';
      hrs.textContent = `${game.steamHours}h`;
      topMeta.appendChild(hrs);
    }
    card.appendChild(topMeta);

    // Quick-move tier buttons on hover
    const quickBar = document.createElement('div');
    quickBar.className = 'card-quick-actions';
    ['S', 'A', 'B', 'C', 'D'].forEach((tId) => {
      if (tId === currentTierId) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quick-tier-btn qt-${tId}`;
      btn.textContent = tId;
      btn.title = `Move to ${tId}-Tier`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveGame(game.id, currentTierId, tId);
      });
      quickBar.appendChild(btn);
    });

    if (currentTierId !== 'UNRANKED') {
      const unrankBtn = document.createElement('button');
      unrankBtn.type = 'button';
      unrankBtn.className = 'quick-tier-btn qt-U';
      unrankBtn.textContent = '✕';
      unrankBtn.title = 'Move back to Unranked';
      unrankBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveGame(game.id, currentTierId, 'UNRANKED');
      });
      quickBar.appendChild(unrankBtn);
    }
    card.appendChild(quickBar);

    // Bottom title overlay
    const overlay = document.createElement('div');
    overlay.className = 'card-title-overlay';
    const titleSpan = document.createElement('div');
    titleSpan.className = 'card-title-text';
    titleSpan.textContent = game.name;
    overlay.appendChild(titleSpan);
    card.appendChild(overlay);

    // Drag events on card
    card.addEventListener('dragstart', (e) => {
      draggedGameId = game.id;
      draggedSourceTier = currentTierId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', game.id);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearDragIndicators();
      draggedGameId = null;
      draggedSourceTier = null;
    });

    card.addEventListener('dragover', (e) => {
      if (!draggedGameId || draggedGameId === game.id) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      card.classList.remove('drag-target-before', 'drag-target-after');
      if (e.clientX < midX) {
        card.classList.add('drag-target-before');
      } else {
        card.classList.add('drag-target-after');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-target-before', 'drag-target-after');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isBefore = card.classList.contains('drag-target-before');
      clearDragIndicators();
      const sourceId = draggedGameId || e.dataTransfer.getData('text/plain');
      if (!sourceId || sourceId === game.id) return;
      moveGame(sourceId, draggedSourceTier, currentTierId, game.id, isBefore);
    });

    return card;
  }

  function clearDragIndicators() {
    document
      .querySelectorAll('.drag-over, .drag-target-before, .drag-target-after')
      .forEach((el) => el.classList.remove('drag-over', 'drag-target-before', 'drag-target-after'));
  }

  // Move game between tiers or reorder within a tier
  function moveGame(gameId, fromTierId, toTierId, targetGameId = null, insertBefore = true) {
    let movedGame = null;

    // Find and remove from current collection
    for (const tier of appState.tiers) {
      const idx = tier.items.findIndex((g) => g.id === gameId);
      if (idx !== -1) {
        movedGame = tier.items.splice(idx, 1)[0];
        break;
      }
    }
    if (!movedGame) {
      const uIdx = appState.unranked.findIndex((g) => g.id === gameId);
      if (uIdx !== -1) {
        movedGame = appState.unranked.splice(uIdx, 1)[0];
      }
    }

    if (!movedGame) return;

    if (toTierId === 'UNRANKED') {
      appState.unranked.push(movedGame);
    } else {
      const destTier = appState.tiers.find((t) => t.id === toTierId);
      if (!destTier) return;

      if (targetGameId) {
        const targetIdx = destTier.items.findIndex((g) => g.id === targetGameId);
        if (targetIdx !== -1) {
          const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
          destTier.items.splice(insertIdx, 0, movedGame);
        } else {
          destTier.items.push(movedGame);
        }
      } else {
        destTier.items.push(movedGame);
      }
    }

    updateDirtyStatus();
    renderAll();
  }

  function renderTierBoard() {
    tierBoardEl.innerHTML = '';

    for (const tier of appState.tiers) {
      const row = document.createElement('div');
      row.className = 'tier-row';
      row.dataset.tier = tier.id;

      // Left tier label column
      const labelCol = document.createElement('div');
      labelCol.className = 'tier-label-col';

      const badge = document.createElement('div');
      badge.className = 'tier-badge-letter';
      badge.style.background = TIER_COLORS[tier.id] || '#888';
      badge.textContent = tier.shortLabel || tier.id;

      const title = document.createElement('div');
      title.className = 'tier-name-title';
      title.textContent = `${tier.id}-Tier`;

      const desc = document.createElement('div');
      desc.className = 'tier-desc';
      desc.textContent = tier.description;

      const countPill = document.createElement('div');
      countPill.className = 'tier-count-pill';
      countPill.textContent = `${tier.items.length} ${tier.items.length === 1 ? 'Game' : 'Games'}`;

      labelCol.appendChild(badge);
      labelCol.appendChild(title);
      labelCol.appendChild(desc);
      labelCol.appendChild(countPill);

      // Right dropzone for cards
      const dropzone = document.createElement('div');
      dropzone.className = 'tier-items-dropzone';
      dropzone.dataset.tier = tier.id;

      if (tier.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tier-empty-placeholder';
        empty.textContent = `Drop games here to rank in ${tier.id}-Tier`;
        dropzone.appendChild(empty);
      } else {
        for (const game of tier.items) {
          dropzone.appendChild(createGameCardElement(game, tier.id));
        }
      }

      // Row drop handlers
      row.addEventListener('dragover', (e) => {
        if (!draggedGameId) return;
        e.preventDefault();
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', (e) => {
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('drag-over');
        }
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const sourceId = draggedGameId || e.dataTransfer.getData('text/plain');
        if (!sourceId) return;
        moveGame(sourceId, draggedSourceTier, tier.id);
      });

      row.appendChild(labelCol);
      row.appendChild(dropzone);
      tierBoardEl.appendChild(row);
    }
  }

  function getFilteredAndSortedUnranked() {
    const q = searchQuery.trim().toLowerCase();
    const filtered = appState.unranked.filter((g) => {
      if (activePlatform !== 'ALL' && !(g.platforms || []).includes(activePlatform)) {
        return false;
      }
      if (q && !g.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortMode === 'hours-desc') {
        const ha = a.steamHours || 0;
        const hb = b.steamHours || 0;
        if (hb !== ha) return hb - ha;
      } else if (sortMode === 'platforms-desc') {
        const pa = (a.platforms || []).length;
        const pb = (b.platforms || []).length;
        if (pb !== pa) return pb - pa;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return filtered;
  }

  function renderUnrankedPool() {
    unrankedGridEl.innerHTML = '';
    const list = getFilteredAndSortedUnranked();

    unrankedFilteredCountEl.textContent =
      list.length === appState.unranked.length
        ? `${list.length} games`
        : `${list.length} of ${appState.unranked.length} games`;

    const fragment = document.createDocumentFragment();
    for (const game of list) {
      fragment.appendChild(createGameCardElement(game, 'UNRANKED'));
    }
    unrankedGridEl.appendChild(fragment);
  }

  function renderHeaderStats() {
    const rankedTotal = appState.tiers.reduce((acc, t) => acc + t.items.length, 0);
    const unrankedTotal = appState.unranked.length;
    rankedCountEl.textContent = rankedTotal;
    unrankedCountEl.textContent = unrankedTotal;
    totalCountEl.textContent = rankedTotal + unrankedTotal;
  }

  function renderAll() {
    renderHeaderStats();
    renderTierBoard();
    renderUnrankedPool();
  }

  // Save handler -> updates tier_list.md
  async function saveTierList() {
    saveBtn.disabled = true;
    saveBtnText.textContent = 'Saving...';

    const tiersPayload = {};
    const descriptionsPayload = {};
    for (const tier of appState.tiers) {
      tiersPayload[tier.id] = tier.items.map((g) => g.name);
      descriptionsPayload[tier.id] = tier.description;
    }

    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tiers: tiersPayload,
          descriptions: descriptionsPayload
        })
      });

      if (!res.ok) {
        throw new Error('Server responded with ' + res.status);
      }

      initialSnapshot = snapshotState();
      updateDirtyStatus();
      showToast('Saved changes to tier_list.md!');
    } catch (err) {
      // Fallback: download updated tier_list.md if server isn't running
      const md = generateTierListMarkdown();
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tier_list.md';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Downloaded updated tier_list.md (run server.js for direct disk save)');
    } finally {
      saveBtn.disabled = false;
      saveBtnText.textContent = 'Save to tier_list.md';
    }
  }

  // Unranked dropzone handlers
  unrankedDropzoneEl.addEventListener('dragover', (e) => {
    if (!draggedGameId) return;
    e.preventDefault();
    unrankedDropzoneEl.classList.add('drag-over');
  });

  unrankedDropzoneEl.addEventListener('dragleave', (e) => {
    if (!unrankedDropzoneEl.contains(e.relatedTarget)) {
      unrankedDropzoneEl.classList.remove('drag-over');
    }
  });

  unrankedDropzoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    unrankedDropzoneEl.classList.remove('drag-over');
    const sourceId = draggedGameId || e.dataTransfer.getData('text/plain');
    if (!sourceId) return;
    moveGame(sourceId, draggedSourceTier, 'UNRANKED');
  });

  // Auto-scroll viewport when dragging near top or bottom edges
  window.addEventListener('dragover', (e) => {
    if (!draggedGameId) return;
    const edgeThreshold = 90;
    if (e.clientY < edgeThreshold) {
      window.scrollBy(0, -14);
    } else if (window.innerHeight - e.clientY < edgeThreshold) {
      window.scrollBy(0, 14);
    }
  });

  // Controls & Event Listeners
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    clearSearchBtn.classList.toggle('hidden', !searchQuery);
    renderUnrankedPool();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    renderUnrankedPool();
  });

  platformFiltersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    platformFiltersEl.querySelectorAll('.filter-pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activePlatform = btn.dataset.platform;
    renderUnrankedPool();
  });

  sortSelect.addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderUnrankedPool();
  });

  saveBtn.addEventListener('click', saveTierList);

  resetBtn.addEventListener('click', () => {
    loadInitialState();
    isDirty = false;
    updateDirtyStatus();
    showToast('Reverted to last saved tier_list.md');
  });

  previewBtn.addEventListener('click', () => {
    markdownPreviewText.textContent = generateTierListMarkdown();
    previewModal.classList.remove('hidden');
  });

  closeModalBtn.addEventListener('click', () => {
    previewModal.classList.add('hidden');
  });

  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      previewModal.classList.add('hidden');
    }
  });

  copyMdBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdownPreviewText.textContent);
      showToast('Copied tier_list.md markdown to clipboard!');
    } catch (_) {
      showToast('Failed to copy to clipboard', true);
    }
  });

  // Initialize
  loadInitialState();
})();
