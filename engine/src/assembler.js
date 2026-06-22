/**
 * assembler.js — JSON spec -> self-contained playable HTML (browser build)
 * =======================================================================
 * The browser equivalent of build_playable.py. Given a normalized spec, it:
 *   1. fetches the shared engine sources (Phaser + scenes + template),
 *   2. embeds card faces (WebP-compressed) + card_back/bg/option art as data URIs,
 *   3. builds window.LEVEL_BUNDLE (difficulty-select) or window.LEVEL_CONFIG (flat),
 *   4. generates the boot (Phaser.Game config, scene list, clickOut/CTA),
 *   5. fills template.html and returns one self-contained HTML string.
 *
 * Served from the repo root, the tool page lives at /engine/, so engine sources
 * and assets (repo-relative paths) are fetched with a leading '../'.
 *
 * Exposed as window.PE.assembler.
 */
(function () {
  const PE = (window.PE = window.PE || {});
  const schema = PE.schema;

  // Engine source locations (repo-relative; '../' reaches repo root from /engine/).
  const ENGINE = 'the-one-ring-main/playables/common';
  const SRC = {
    phaser: `${ENGINE}/engine/phaser.min.js`,
    template: `${ENGINE}/template.html`,
    obstacle: 'engine/src/obstacle.js',
    SoundControls: `${ENGINE}/scenes/SoundControls.js`,
    GameState: `${ENGINE}/scenes/GameState.js`,
    DifficultyScene: `${ENGINE}/scenes/DifficultyScene.js`,
    Game: `${ENGINE}/scenes/GameScene.js`,
    End: `${ENGINE}/scenes/EndScene.js`,
    TransitionScene: `${ENGINE}/scenes/TransitionScene.js`,
  };

  // Ad networks — same set + behavior as the Wags Water build (per-network head
  // injection + redirect). `cta`: which SDK call openCTA uses.
  const NETWORKS = {
    applovin: { cta: 'mraid',  cap: 5 * 1024 * 1024 },
    unityads: { cta: 'mraid',  cap: 5 * 1024 * 1024 },
    google:   { cta: 'google', cap: 5 * 1024 * 1024 },
    meta:     { cta: 'meta',   cap: 5 * 1024 * 1024 },
  };
  const ALL_NETWORKS = Object.keys(NETWORKS);

  function resolveNetwork(spec, opt) {
    const n = opt || spec.network || spec.platform || 'applovin';
    return NETWORKS[n] ? n : 'applovin';
  }

  // Per-network <head> SDK injection (mirrors Wags src/injections/*.html).
  function networkHead(network, google, apple) {
    if (network === 'applovin') return '<script src="mraid.js"></script>';
    if (network === 'unityads') return '<script src="mraid.js"></script>\n' +
      `<script>var defined_storeurl_apple=${JSON.stringify(apple)};var defined_storeurl_google=${JSON.stringify(google)};</script>`;
    if (network === 'google') return '<script>if(!window.ExitApi){window.ExitApi={exit:function(){console.log("ExitApi.exit()")}};}</script>';
    return ''; // meta: FbPlayableAd is provided by the platform
  }

  // ---- fetch / image helpers -------------------------------------------------

  // Asset values may be repo-relative paths (fetched with a leading '../' from
  // /engine/) or inline data URIs (used as-is, e.g. images added in the editor).
  function resolveUrl(path) {
    if (path.indexOf('data:') === 0) return path;
    // Encode each segment so spaces / & in kit asset names fetch correctly.
    return '../' + path.split('/').map(encodeURIComponent).join('/');
  }

  async function fetchText(path) {
    // no-store so edits to the engine sources are always picked up on rebuild.
    const r = await fetch(resolveUrl(path), { cache: 'no-store' });
    if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
    return await r.text();
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image ' + url));
      i.src = url;
    });
  }

  async function fetchDataURL(path) {
    if (path.indexOf('data:') === 0) return path;
    const r = await fetch(resolveUrl(path));
    if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
    const blob = await r.blob();
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  // Compress an image to a WebP data URI, optionally downscaled to maxH.
  // Falls back to PNG if the browser can't encode WebP, or to the raw bytes
  // when compression is off.
  async function embedImage(path, opts) {
    const o = Object.assign({ compress: true, quality: 0.85, maxH: 420 }, opts || {});
    if (!o.compress) return await fetchDataURL(path);
    const img = await loadImage(resolveUrl(path));
    const scale = (o.maxH && img.height > o.maxH) ? o.maxH / img.height : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    let uri = cv.toDataURL('image/webp', o.quality);
    if (uri.indexOf('data:image/webp') !== 0) uri = cv.toDataURL('image/png');
    return uri;
  }

  function approxBytes(dataUri) {
    const i = dataUri.indexOf(',');
    return Math.floor((dataUri.length - i - 1) * 0.75);
  }

  // ---- config builders -------------------------------------------------------

  function buildLevel(lv) {
    const portrait = {}, landscape = {}, sprites = {};
    (lv.cards || []).forEach(c => {
      portrait[c.id] = c.portrait || {};
      landscape[c.id] = c.landscape || {};
      sprites[c.id] = { texture: c.face, role: c.role || 'tableau' };
    });
    const t = lv.talon || {};
    if (t.base) { portrait.talon_base = t.base.portrait || {}; landscape.talon_base = t.base.landscape || {}; }
    if (t.deck) { portrait.talon_deck = t.deck.portrait || {}; landscape.talon_deck = t.deck.landscape || {}; }
    if (lv.telon) { portrait.telon = lv.telon.portrait || {}; landscape.telon = lv.telon.landscape || {}; }
    (t.sequence || []).forEach(f => { if (!sprites[f]) sprites[f] = { texture: f, role: 'talon' }; });

    const game_flow = Object.assign({ mode: 'dependency' }, lv.game_flow, { talon_sequence: t.sequence || [] });

    // Obstacles — collect per-card, then inject the dependency-graph obstacles
    // (Lock & Key, Rope) as real blocker edges so they function via the engine.
    const obstacles = {};
    (lv.cards || []).forEach(c => { if (c.obstacle && c.obstacle.type) obstacles[c.id] = c.obstacle; });
    if (Object.keys(obstacles).length && PE.obstacle) {
      game_flow.dependencies = Object.assign({}, game_flow.dependencies);
      PE.obstacle.dependencyEdges(obstacles).forEach(([card, blocker]) => {
        const arr = game_flow.dependencies[card] || (game_flow.dependencies[card] = []);
        if (!arr.includes(blocker)) arr.push(blocker);
      });
    }

    const out = { portrait, landscape, sprites, game_flow, animation: lv.animation, deal: lv.deal };
    if (Object.keys(obstacles).length) out.obstacles = obstacles;
    return out;
  }

  function buildDifficultySelect(spec) {
    const ss = spec.start_scene;
    return {
      // Title removed from the start scene unless one is explicitly set — emit an
      // empty string so the runtime skips its default "SELECT DIFFICULTY".
      title: (ss.title && ss.title.text) ? ss.title : { text: '' },
      logo: spec.logo ? { portrait: spec.logo.portrait || {}, landscape: spec.logo.landscape || {}, anim: spec.logo.anim } : null,
      options: (ss.options || []).map(o => {
        const opt = { id: o.id, label: o.label || o.id, color: o.color,
          portrait: o.portrait || {}, landscape: o.landscape || {} };
        if (o.image) opt.image = 'diff_' + o.id;   // texture key embedded under preload_assets
        return opt;
      }),
    };
  }

  // Assemble window.LEVEL_BUNDLE (difficulty) or LEVEL_CONFIG (flat).
  function buildConfigObject(spec, assets) {
    const images = { card_back: assets.card_back };
    if (assets.main_bg) images.main_bg = assets.main_bg;
    if (assets.main_bg_landscape) images.main_bg_landscape = assets.main_bg_landscape;
    if (assets.talon_base) images.talon_base = assets.talon_base;
    if (assets.telon) images.telon = assets.telon;
    if (assets.logo) images.logo = assets.logo;
    if (assets.play_button) images.play_button = assets.play_button;
    Object.assign(images, assets.obstacleImages || {});
    Object.entries(assets.options || {}).forEach(([id, uri]) => { images['diff_' + id] = uri; });
    Object.entries(assets.bgLayers || {}).forEach(([key, uri]) => { images[key] = uri; });

    // Inject the logo into a level's layout so GameScene.createUIElements draws it
    // (texture key 'logo', depth 100), per orientation.
    const withLogo = (level) => {
      if (spec.logo) {
        const anim = spec.logo.anim ? { anim: spec.logo.anim } : {};
        level.portrait.logo = Object.assign({}, spec.logo.portrait || {}, anim);
        level.landscape.logo = Object.assign({}, spec.logo.landscape || {}, anim);
      }
      return level;
    };

    const shared = {
      canvas: spec.canvas,
      scales: spec.scales,
      background: assets.background || spec.background,
      end_card: spec.end_card || {},
      preload_assets: { images },
      card_assets: assets.textures,
    };
    // Brown board removed completely — always disable the drawn talon panel.
    shared.talon_panel = false;
    // Talon like the Wags ads: no base graphic behind the waste card (no telon
    // pile, no card-back slot) — the talon is JUST the active/current card.
    shared.talon_base_graphic = false;
    // End scene matches the editor's End preview exactly (bg + logo + title + CTA),
    // not the one-ring themed end card.
    shared.engine_end_card = true;

    const ss = spec.start_scene;
    if (ss && ss.type === 'difficulty') {
      const levels = {};
      for (const [id, lv] of Object.entries(spec.levels)) levels[id] = withLogo(buildLevel(lv));
      return { kind: 'bundle', data: Object.assign({ mode: 'difficulty-select',
        difficulty_select: buildDifficultySelect(spec), levels }, shared) };
    }
    const firstId = Object.keys(spec.levels)[0];
    return { kind: 'config', data: Object.assign({}, shared, withLogo(buildLevel(spec.levels[firstId])), { _sceneId: firstId }) };
  }

  // ---- boot generator --------------------------------------------------------

  function buildBootJS(spec, kind, network) {
    const ec = spec.end_card || {};
    const google = ec.store_url || ec.google_url || '';
    const apple = ec.apple_url || google;
    const cta = (NETWORKS[network] || NETWORKS.applovin).cta;
    const bgColor = (spec.background && spec.background.color) || '#000000';
    const c = spec.canvas;
    const sceneArr = (kind === 'bundle')
      ? '[DifficultyScene, Game, End, TransitionScene]'
      : '[Game, End, TransitionScene]';
    // Network-specific redirect, then the device-aware fallback (mirrors the Wags
    // Water openCTA: SDK call → mraid.open → market://-/itms-apps:// deep link → web).
    const ctaBranch = cta === 'google'
      ? "if(window.ExitApi){window.ExitApi.exit();return;}"
      : cta === 'meta'
      ? "if(typeof FbPlayableAd!=='undefined'){FbPlayableAd.onCTAClick();return;}"
      : "";
    return `(function(){
  var GOOGLE=${JSON.stringify(google)}, APPLE=${JSON.stringify(apple)};
  function openCTA(){
    window.trackAL&&window.trackAL('CTA_CLICKED');
    var ua=navigator.userAgent||navigator.vendor||'';
    var g=window.__game, os=(g&&g.device&&g.device.os)||{};
    var isIOS=!!(os.iOS||os.iPad)|| /iPad|iPhone|iPod/.test(ua);
    var isAndroid=!!os.android|| /Android/i.test(ua);
    var webLink=isIOS?APPLE:GOOGLE;
    ${ctaBranch}
    if(typeof mraid!=='undefined'){ try{mraid.open(webLink);}catch(e){window.open(webLink,'_blank');} return; }
    if(isAndroid){ var m=/[?&]id=([^&]+)/.exec(GOOGLE); if(m){ window.location.href='market://details?id='+m[1]; setTimeout(function(){window.open(webLink,'_blank');},800); return; } }
    if(isIOS){ var a=/\\/id(\\d+)/.exec(APPLE); if(a){ window.location.href='itms-apps://apps.apple.com/app/id'+a[1]; return; } }
    window.open(webLink,'_blank');
  }
  window.openCTA=openCTA;
  if(window.Phaser) Phaser.Scene.prototype.clickOut=function(){ openCTA(); };
  var PORTRAIT={w:${c.portrait.width},h:${c.portrait.height}}, LANDSCAPE={w:${c.landscape.width},h:${c.landscape.height}};
  var START=(window.innerWidth>window.innerHeight)?LANDSCAPE:PORTRAIT;
  var config={type:Phaser.AUTO,width:START.w,height:START.h,parent:'game-container',
    backgroundColor:${JSON.stringify(bgColor)},
    scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},
    scene:${sceneArr}};
  function boot(){
    if(window.__game)return; if(typeof Phaser==='undefined'){console.error('Phaser not loaded');return;}
    window.__game=new Phaser.Game(config);
    // Orientation switch — resize the game to the matching canvas so every scene
    // re-lays out for the new orientation (mirrors the Wags ads). Without this a
    // playable loaded in one orientation just scales when the device rotates.
    var lastPortrait=(window.innerHeight>window.innerWidth);
    function onOrient(){
      var nowPortrait=(window.innerHeight>window.innerWidth);
      if(nowPortrait===lastPortrait)return; lastPortrait=nowPortrait;
      var c=nowPortrait?PORTRAIT:LANDSCAPE;
      window.__game.scale.setGameSize(c.w,c.h); window.__game.scale.refresh();
    }
    window.addEventListener('resize',onOrient);
    window.addEventListener('orientationchange',onOrient);
  }
  function ready(cb){ if(window.mraid){ try{ if(mraid.getState&&mraid.getState()!=='loading'){return cb();} mraid.addEventListener('ready',cb);}catch(e){cb();} } else { cb(); } }
  if(document.readyState!=='loading'){ ready(boot); } else { window.addEventListener('DOMContentLoaded',function(){ready(boot);}); }
})();`;
  }

  // ---- main ------------------------------------------------------------------

  // assemble(rawSpec, opts?, onProgress?) -> { html, bytes, cap, over }
  async function assemble(rawSpec, opts, onProgress) {
    const o = Object.assign({ compress: true, quality: 0.85, maxH: 420 }, opts || {});
    const log = (m) => { if (onProgress) onProgress(m); };

    const spec = schema.withDefaults(rawSpec);
    const v = schema.validate(spec);
    if (!v.ok) throw new Error('Invalid spec:\n- ' + v.errors.join('\n- '));

    // 1. Engine sources (in parallel).
    log('Fetching engine sources…');
    const keys = Object.keys(SRC);
    const texts = await Promise.all(keys.map(k => fetchText(SRC[k])));
    const src = {}; keys.forEach((k, i) => { src[k] = texts[i]; });

    // 2. Embed assets.
    const textures = schema.collectTextures(spec);     // {face: path}
    const faces = Object.keys(textures);
    const assets = { textures: {}, options: {} };

    let n = 0;
    for (const face of faces) {
      log(`Embedding cards ${++n}/${faces.length}…`);
      assets.textures[face] = await embedImage(textures[face], o);
    }

    // card_back (compressed)
    const backPath = (spec.deck && spec.deck.card_back) || 'the-one-ring-main/playables/master/assets/cards/Back_Card.png';
    log('Embedding card back…');
    assets.card_back = await embedImage(backPath, o);

    // optional background images (cover-fit; keep more resolution)
    const bg = spec.background || {};
    if (bg.portrait && bg.portrait.image) {
      log('Embedding background…');
      assets.main_bg = await embedImage(bg.portrait.image, { compress: o.compress, quality: o.quality, maxH: 0 });
    }
    if (bg.landscape && bg.landscape.image) {
      assets.main_bg_landscape = await embedImage(bg.landscape.image, { compress: o.compress, quality: o.quality, maxH: 0 });
    }

    // background layers (multiple images, placed/scaled per orientation)
    assets.bgLayers = {};
    const layers = bg.layers || [];
    const cfgLayers = [];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const key = 'bg_' + (L.id != null ? L.id : i);
      const entry = { key, fit: L.fit || 'none', depth: L.depth != null ? L.depth : 0,
        portrait: L.portrait || {}, landscape: L.landscape || {} };
      // Per-scene presence (which scenes show this image) + per-scene transforms
      // and per-scene animation (layouts[sceneId].anim).
      if (L.scenes != null && L.scenes !== '*') entry.scenes = L.scenes;
      if (L.layouts) entry.layouts = L.layouts;
      // CTA buttons are interactive images that open the store URL (openCTA).
      if (L.cta) entry.cta = true;
      if (L.image) {
        log(`Embedding bg layer ${i + 1}/${layers.length}…`);
        assets.bgLayers[key] = await embedImage(L.image, { compress: o.compress, quality: o.quality, maxH: 0 });
      }
      // Optional separate landscape image for the same layer.
      if (L.image_landscape) {
        assets.bgLayers[key + '_l'] = await embedImage(L.image_landscape, { compress: o.compress, quality: o.quality, maxH: 0 });
        entry.key_landscape = key + '_l';
      }
      cfgLayers.push(entry);
    }
    assets.background = { color: bg.color, layers: cfgLayers };

    // talon pile art (optional) — embedded as the 'talon_base' texture
    if (spec.deck && spec.deck.talon_base) {
      log('Embedding talon art…');
      assets.talon_base = await embedImage(spec.deck.talon_base, { compress: o.compress, quality: o.quality, maxH: 0 });
    }

    // talon graphic (optional) — embedded as the 'telon' texture, drawn behind
    // the talon stock/waste (like the Wags talon_bg).
    if (spec.deck && spec.deck.talon_image) {
      log('Embedding talon graphic…');
      assets.telon = await embedImage(spec.deck.talon_image, { compress: o.compress, quality: o.quality, maxH: 0 });
    }

    // logo (optional) — embedded as the 'logo' texture
    if (spec.logo && spec.logo.image) {
      log('Embedding logo…');
      assets.logo = await embedImage(spec.logo.image, { compress: o.compress, quality: o.quality, maxH: 400 });
    }

    // End-scene CTA button art (optional) — embedded as 'play_button' so EndScene
    // shows it; the tap triggers openCTA (store redirect).
    const ec0 = spec.end_card || {};
    if (ec0.cta_image) {
      log('Embedding CTA button…');
      assets.play_button = await embedImage(ec0.cta_image, { compress: o.compress, quality: o.quality, maxH: 300 });
    }

    // Obstacle art — swap card faces / add overlays per obstacle card. Each
    // obstacle's resolved texture keys are attached to its card.obstacle so the
    // runtime (GameScene) can render them.
    assets.obstacleImages = {};
    if (PE.obstacle) {
      const obKey = (p) => 'ob_' + p.replace(/[^a-z0-9]/gi, '_').slice(-58);
      const embedOb = async (path) => {
        const key = obKey(path);
        if (!assets.obstacleImages[key]) {
          log('Embedding obstacle art…');
          try { assets.obstacleImages[key] = await embedImage(path, { compress: o.compress, quality: o.quality, maxH: 420 }); }
          catch (e) { console.warn('obstacle art failed:', path, e.message); return null; }
        }
        return key;
      };
      // Pre-pass: a Lock's key card becomes a KEY card (so it gets the key face).
      for (const lv of Object.values(spec.levels || {})) {
        for (const c of (lv.cards || [])) {
          if (c.obstacle && c.obstacle.type === 'LOCK_AND_KEY' && c.obstacle.key) {
            const kc = (lv.cards || []).find(x => x.id === c.obstacle.key);
            if (kc && !kc.obstacle) kc.obstacle = { type: 'KEY' };
          }
        }
      }
      for (const lv of Object.values(spec.levels || {})) {
        for (const c of (lv.cards || [])) {
          const ob = c.obstacle; if (!ob || !ob.type) continue;
          const def = PE.obstacle.OBSTACLES[ob.type];
          if (def && def.faceUp) ob._faceUp = true;
          const art = PE.obstacle.resolveArt(ob, c.face);
          if (art.counter) ob._counter = ob.fuse || 10;
          if (art.face) ob._face = await embedOb(art.face);
          if (art.overlay) ob._overlay = await embedOb(art.overlay);
          // Animation frames (door open, rope slice, curtain cut…) — fixed keys.
          const anim = PE.obstacle.animAssets(ob.type, ob);
          for (const [key, path] of Object.entries(anim)) {
            if (!assets.obstacleImages[key]) {
              try { assets.obstacleImages[key] = await embedImage(path, { compress: o.compress, quality: o.quality, maxH: 420 }); }
              catch (e) { console.warn('anim art failed:', path, e.message); }
            }
          }
        }
      }
    }

    // optional difficulty option art
    const ss = spec.start_scene;
    if (ss && ss.type === 'difficulty') {
      for (const opt of (ss.options || [])) {
        if (opt.image) {
          log(`Embedding option ${opt.id}…`);
          assets.options[opt.id] = await embedImage(opt.image, { compress: o.compress, quality: o.quality, maxH: 600 });
        }
      }
    }

    // 3. Config object.
    log('Building config…');
    const cfg = buildConfigObject(spec, assets);
    const cfgVar = cfg.kind === 'bundle' ? 'LEVEL_BUNDLE' : 'LEVEL_CONFIG';
    const cfgJSON = JSON.stringify(cfg.data).replace(/<\//g, '<\\/');

    // 4. Boot (network-aware redirect, like the Wags Water build).
    const network = resolveNetwork(spec, o.network);
    const ec = spec.end_card || {};
    const googleUrl = ec.store_url || ec.google_url || '';
    const appleUrl = ec.apple_url || googleUrl;
    const bootJS = buildBootJS(spec, cfg.kind, network);

    // 5. Fill template. Use function replacers so '$' in sources isn't treated
    //    as a replacement pattern.
    log('Assembling HTML…');
    const head = networkHead(network, googleUrl, appleUrl);
    const wrap = (js) => '<script>' + js + '</script>';
    const sceneScripts = [
      `<script>window.${cfgVar}=${cfgJSON};</script>`,
      wrap(src.obstacle),
      wrap(src.SoundControls),
      wrap(src.GameState),
      wrap(src.DifficultyScene),
      wrap(src.Game),
      wrap(src.End),
      wrap(src.TransitionScene),
      wrap(bootJS),
    ].join('\n');

    const html = src.template
      .replace('{{PLATFORM_HEAD}}', () => head)
      .replace('{{PHASER_JS}}', () => src.phaser)
      .replace('{{START_SCENE_JS}}', () => '')
      .replace('{{SCENE_SCRIPTS}}', () => sceneScripts);

    const bytes = new Blob([html]).size;
    const cap = (NETWORKS[network] || NETWORKS.applovin).cap;
    log(`Done — ${(bytes / 1024 / 1024).toFixed(2)} MB`);

    // Everything except Phaser, as one plain-JS body — used for the split build
    // (external assets/index.js). Each scene is a top-level class / IIFE, so plain
    // concatenation runs them in order just like the separate inline <script>s.
    const jsBody = [
      `window.${cfgVar}=${cfgJSON};`,
      src.obstacle, src.SoundControls, src.GameState, src.DifficultyScene,
      src.Game, src.End, src.TransitionScene, bootJS,
    ].join('\n;\n');

    return { html, bytes, cap, over: bytes > cap, kind: cfg.kind, network,
      _parts: { template: src.template, head, phaser: src.phaser, jsBody } };
  }

  // Derive the Wags-style "split" build from an assemble() result: a tiny
  // index.html that loads an external assets/index.js (Phaser + scenes + config).
  function splitFromParts(parts) {
    const assetsJs = parts.phaser + '\n;\n' + parts.jsBody;
    const indexHtml = parts.template
      .replace('{{PLATFORM_HEAD}}', () => parts.head)
      .replace('{{PHASER_JS}}', () => '')
      .replace('{{START_SCENE_JS}}', () => '')
      .replace('{{SCENE_SCRIPTS}}', () => '<script src="assets/index.js"></script>');
    return { indexHtml, assetsJs };
  }

  // Build inline + split for each network and package into one zip, mirroring the
  // Wags ad-builds layout: <network>/inline/index.html, <network>/split/index.html,
  // <network>/split/assets/index.js. Returns { blob, summary }.
  async function buildPackage(rawSpec, networks, opts, onProgress) {
    if (!PE.zip) throw new Error('zip writer not loaded');
    const list = (networks && networks.length ? networks : ALL_NETWORKS).filter(n => NETWORKS[n]);
    const multi = list.length > 1;
    const files = [];
    const summary = [];
    for (const net of list) {
      if (onProgress) onProgress(`Building ${net} (inline + split)…`);
      const r = await assemble(rawSpec, Object.assign({}, opts, { network: net }), () => {});
      const split = splitFromParts(r._parts);
      // dist.zip lives inside split/ (the zipped split build — what you upload),
      // exactly like the Wags ad-builds layout.
      const distZip = PE.zip.createZipBytes([
        { name: 'index.html', text: split.indexHtml },
        { name: 'assets/index.js', text: split.assetsJs },
      ]);
      const p = multi ? `${net}/` : '';        // network folder only when building several
      files.push({ name: `${p}inline/index.html`, text: r.html });
      files.push({ name: `${p}split/index.html`, text: split.indexHtml });
      files.push({ name: `${p}split/assets/index.js`, text: split.assetsJs });
      files.push({ name: `${p}split/dist.zip`, text: distZip });
      summary.push({ network: net, bytes: r.bytes, cap: r.cap, over: r.over });
    }
    return { blob: PE.zip.createZip(files), summary, fileCount: files.length };
  }

  // Build one HTML per network (the Wags "build all networks" method).
  // Returns [{ network, html, bytes, cap, over }]. Assets are embedded once and
  // reused across networks (only the head + boot differ).
  async function assembleAll(rawSpec, networks, opts, onProgress) {
    const list = (networks && networks.length ? networks : ALL_NETWORKS).filter(n => NETWORKS[n]);
    const out = [];
    for (const net of list) {
      if (onProgress) onProgress(`Building ${net}…`);
      const r = await assemble(rawSpec, Object.assign({}, opts, { network: net }), () => {});
      out.push(r);
    }
    return out;
  }

  function download(html, filename) {
    downloadBlob(new Blob([html], { type: 'text/html' }), filename || 'playable.html');
  }
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  PE.assembler = { assemble, assembleAll, buildPackage, splitFromParts, download, downloadBlob,
    embedImage, buildConfigObject, buildBootJS, approxBytes, NETWORKS: ALL_NETWORKS };
})();
