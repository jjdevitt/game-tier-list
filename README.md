# 🎮 Video Game Tier List

An interactive Video Game Tier List manager and static showcase generator powered by [`tier_list.md`](./tier_list.md), [`library.csv`](./library.csv), and a local [`assets/`](./assets) cover art store.

---

## 📁 Project Structure

| File / Folder | Purpose |
| :--- | :--- |
| [`tier_list.md`](./tier_list.md) | Markdown source of truth for ranked games (`S-Tier` down to `D-Tier`). |
| [`library.csv`](./library.csv) | Full video game library with platform flags (`Steam`, `PS4`, `PS5`, `Switch`) and `Steam Hours Played`. Any game not in `tier_list.md` appears under **Unranked Library**. |
| [`assets/`](./assets) | Local cover art store (`assets/<game-slug>.<ext>`). Once a game has a local asset here, it will not reload from external APIs. |
| [`covers.json`](./covers.json) | Cover art metadata cache and custom cover overrides. |
| [`editor.html`](./editor.html) | Interactive local editor UI served at `http://localhost:3000/` when running `server.js`. |
| [`index.html`](./index.html) | Generated static showcase page served at the root of GitHub Pages (`https://jjdevitt.github.io/game-tier-list/`). |
| [`server.js`](./server.js) | Zero-dependency local Node.js server that serves the interactive editor (`editor.html`) at `/`, downloads covers to `assets/`, and saves updates directly to `tier_list.md`. |
| [`build-static.js`](./build-static.js) | Static site generator that outputs [`index.html`](./index.html), [`tier_list.html`](./tier_list.html), and [`docs/index.html`](./docs/index.html) (+ [`docs/assets/`](./docs/assets)). |

---

## 🚀 How to Run Locally

### Prerequisites
- **Node.js** (v16+ recommended; no `npm install` or external packages required)

### Start the Local Interactive Server
```bash
npm start
# or
node server.js
```

Then open **http://localhost:3000** in your browser.

### Using the Local Editor
1. **Rank & Reorder Games**:
   - Drag and drop game cards between **S-Tier**, **A-Tier**, **B-Tier**, **C-Tier**, **D-Tier**, and the **Unranked Library**.
   - Or hover over any card and click the quick-assign buttons (`S`, `A`, `B`, `C`, `D`, or `✕` to unrank).
2. **Filter & Sort Unranked Games**:
   - Search by title, filter by platform (`All`, `Steam`, `PS4`, `PS5`, `Switch`), or sort by `Name (A–Z)`, `Steam Hours (High → Low)`, or `Most Platforms`.
3. **Change Cover Art**:
   - Click any game card (or click the **🖼️** button on hover) to open the **Change Cover Art** modal.
   - You can:
     - **Copy & Paste an image from your clipboard** (`⌘V` / `Ctrl+V` or click **Paste from Clipboard**)
     - **Paste a custom image URL**
     - **Upload an image file** from your computer
     - **Search alternative covers** from Steam / Wikipedia
   - Clicking **Save Cover Instead** removes the game's auto-downloaded file from `assets/` and saves your custom cover in `covers.json`.
4. **Save Changes**:
   - Click **Save to tier_list.md** in the top-right header.
   - This writes your updated rankings directly to [`tier_list.md`](./tier_list.md) **and** automatically regenerates the static pages ([`tier_list.html`](./tier_list.html) and [`docs/index.html`](./docs/index.html)).

---

## 🌐 Static Pages (GitHub Pages / GitLab Pages)

The project generates a self-contained static version of the local page (including all ranked tiers, the unranked library, search/platform/sort filters, local cover images, and embedded custom covers):

- **[`tier_list.html`](./tier_list.html)** — Root static HTML page (view locally at `http://localhost:3000/tier_list.html`)
- **[`docs/index.html`](./docs/index.html)** & **[`docs/assets/`](./docs/assets)** — Pre-packaged static folder for Pages hosting

### GitHub Pages Info
- **Repository**: [https://github.com/jjdevitt/game-tier-list](https://github.com/jjdevitt/game-tier-list)
- **Pages Settings**: [https://github.com/jjdevitt/game-tier-list/settings/pages](https://github.com/jjdevitt/game-tier-list/settings/pages)
  - Set **Source** to **Deploy from a branch**
  - Select branch **`main`** and folder **`/docs`** (or **`/ (root)`**) and click **Save**
- **Live Pages URLs**:
  - Deployed from `/docs`: **https://jjdevitt.github.io/game-tier-list/**
  - Deployed from `/ (root)`: **https://jjdevitt.github.io/game-tier-list/tier_list.html**

### GitLab Pages Info
If hosting on **GitLab Pages**, add a `.gitlab-ci.yml` that publishes the generated `docs/` directory as `public/`:
```yaml
pages:
  stage: deploy
  script:
    - cp -r docs public
  artifacts:
    paths:
      - public
  only:
    - main
```

---

## 🔄 How to Sync Local Run Results to Pages

Whenever you update rankings or cover art locally, follow these steps to publish the updated state to your remote Pages site:

### 1. Save in the Local App (or Run the Static Builder)
When you click **Save to tier_list.md** at `http://localhost:3000` (or save a new cover), the static files (`tier_list.html`, `docs/index.html`, and `docs/assets/`) are regenerated automatically.

You can also manually regenerate the static pages at any time from the terminal:
```bash
npm run build
# or
node build-static.js
```

### 2. Commit and Push to Git
Stage the updated markdown, cover cache, assets, and generated static pages, then push to `main`:
```bash
git add tier_list.md covers.json assets/ index.html editor.html tier_list.html docs/
git commit -m "Update game tier list rankings and covers"
git push origin main
```

Once pushed, GitHub / GitLab Pages will automatically redeploy your static site within ~30–60 seconds.
