/**
 * DifficultyScene.js — Difficulty-select start scene
 * ==================================================
 * Boots first when window.LEVEL_BUNDLE is present. Shows a title plus 2–4
 * tappable difficulty options (an embedded image, or a drawn text-badge
 * fallback). On tap it merges the shared bundle fields with the chosen flow
 * into window.LEVEL_CONFIG and starts the unchanged GameScene.
 *
 * Design (see difficulty-select-plan.md §3):
 *   window.LEVEL_BUNDLE = {
 *     mode: 'difficulty-select',
 *     canvas, scales, sprites, preload_assets, card_assets,   // shared, embedded once
 *     character, ui, reward, background, end_card, animation,
 *     difficulty_select: { title, options:[{id,image,label,color,portrait,landscape}] },
 *     levels: { easy:{portrait,landscape,game_flow,animation,deal}, medium:{...}, hard:{...} }
 *   }
 *
 * GameScene/EndScene need no changes — they still read one flat LEVEL_CONFIG.
 */

// Shallow-merge the shared bundle fields with the chosen level's flow.
// Mirrors the "bundle + merge" approach: shared fields live once at the top of
// LEVEL_BUNDLE; each levels[id] entry overrides portrait/landscape/game_flow/
// animation/deal. Exposed on window so the generated boot can reuse it too.
function mergeBundle(bundle, id) {
  const lvl = (bundle.levels || {})[id] || {};
  const shared = {
    canvas: bundle.canvas,
    scales: bundle.scales,
    sprites: bundle.sprites,
    preload_assets: bundle.preload_assets,
    card_assets: bundle.card_assets,
    character: bundle.character,
    ui: bundle.ui,
    reward: bundle.reward,
    background: bundle.background,
    end_card: bundle.end_card,
    animation: bundle.animation,
    card_shadows: bundle.card_shadows,
    talon_panel: bundle.talon_panel,
    talon_base_graphic: bundle.talon_base_graphic,
    engine_end_card: bundle.engine_end_card,
  };
  // Drop undefined shared keys so they don't clobber level-provided ones.
  Object.keys(shared).forEach(k => shared[k] === undefined && delete shared[k]);
  // _sceneId lets GameScene resolve per-scene background-layer presence/position.
  return Object.assign({}, shared, lvl, { _sceneId: id });
}
if (typeof window !== 'undefined') window.mergeBundle = mergeBundle;

class DifficultyScene extends Phaser.Scene {
  constructor() {
    super('Difficulty');
    this._optionObjs = [];   // [{cont, opt}] for resize relayout
  }

  create() {
    const bundle = window.LEVEL_BUNDLE || {};
    this.bundle = bundle;
    this.select = bundle.difficulty_select || { options: [] };

    // Background colour shows through the canvas; an optional bg image is drawn
    // on top (cover-fit), matching GameScene's background handling.
    const bgColor = (bundle.background && bundle.background.color) || '#0e1a3a';
    this.cameras.main.setBackgroundColor(bgColor);

    // Load the images this scene needs (option art + bg) from the shared pool,
    // then lay out. Loading here also warms the global TextureManager so
    // GameScene won't reload the same keys.
    const imgs = (bundle.preload_assets && bundle.preload_assets.images) || {};
    this._loadImages(imgs, () => this._build());

    this.scale.on('resize', this._relayout, this);
  }

  // Decode base64 data-URI images into the global texture cache (same pattern as
  // GameScene.loadPreloadAssets, kept standalone so this scene has no GameScene
  // dependency).
  _loadImages(images, onComplete) {
    const entries = Object.entries(images || {});
    let remaining = entries.length;
    if (remaining === 0) { onComplete(); return; }
    const done = () => { if (--remaining <= 0) onComplete(); };
    entries.forEach(([key, dataUri]) => {
      if (this.textures.exists(key)) { done(); return; }
      const img = new Image();
      img.onload = () => { this.textures.addImage(key, img); done(); };
      img.onerror = () => { console.warn('Difficulty: failed image', key); done(); };
      img.src = dataUri;
    });
  }

  _build() {
    const W = this.scale.width, H = this.scale.height;
    const isLandscape = W > H;

    // Background image + config-driven layers (re-runnable on orientation flip).
    this._renderBgLayers();

    // Title (skipped when text is explicitly empty — e.g. a single-PLAY start).
    const title = this.select.title || {};
    const titleText = title.text != null ? title.text : 'SELECT DIFFICULTY';
    if (titleText) this._title = this.add.text(W / 2, title[isLandscape ? 'y_landscape' : 'y'] || H * 0.16, titleText, {
      fontFamily: 'Arial, sans-serif',
      fontSize: Math.round(W * (title.size || 0.055)) + 'px',
      fontStyle: 'bold',
      color: title.color || '#ffe9a8',
      align: 'center',
      stroke: title.stroke || '#1b2a52',
      strokeThickness: Math.max(2, Math.round(W * 0.006)),
    }).setOrigin(0.5).setDepth(50);

    // Logo (optional)
    const logo = this.select.logo;
    if (logo && this.textures.exists('logo')) {
      const lp = (isLandscape ? logo.landscape : logo.portrait) || logo.portrait || {};
      this._logo = this.add.image(lp.x != null ? lp.x : W / 2, lp.y != null ? lp.y : H * 0.08, 'logo')
        .setScale(lp.scale != null ? lp.scale : 1).setDepth(60);
      if (window.applyItemAnim) window.applyItemAnim(this, this._logo, logo.anim);
    }

    // Options
    this._optionObjs = [];
    (this.select.options || []).forEach(opt => {
      const cont = this._makeOption(opt);
      this._optionObjs.push({ cont, opt });
    });

    this._relayout();
  }

  // Build one tappable option container — embedded image if available, else a
  // drawn rounded-rect badge with the option label.
  _makeOption(opt) {
    const cont = this.add.container(0, 0).setDepth(20);
    const palette = { easy: 0x2ed573, medium: 0xffa502, hard: 0xff4757 };
    const tint = (opt.color != null)
      ? (typeof opt.color === 'string' ? Phaser.Display.Color.HexStringToColor(opt.color).color : opt.color)
      : (palette[opt.id] || 0x3a86ff);

    if (opt.image && this.textures.exists(opt.image)) {
      const img = this.add.image(0, 0, opt.image).setOrigin(0.5);
      cont.add(img);
      cont._art = img;
    } else {
      // Drawn badge fallback (works with no generated art).
      const w = 360, h = 200, r = 28;
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.25); g.fillRoundedRect(-w / 2 + 6, -h / 2 + 8, w, h, r);
      g.fillStyle(tint, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
      g.lineStyle(6, 0xffffff, 0.9); g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
      const label = this.add.text(0, 0, (opt.label || opt.id || '').toUpperCase(), {
        fontFamily: 'Arial, sans-serif', fontSize: '52px', fontStyle: 'bold',
        color: '#ffffff', stroke: '#00000055', strokeThickness: 4,
      }).setOrigin(0.5);
      cont.add([g, label]);
      cont._art = null;
      cont._badgeSize = { w, h };
    }

    // Hit area + tap handler (model: SoundControls.makeButton interactivity).
    cont.setSize(360, 200);
    cont.setInteractive({ useHandCursor: true });
    cont.on('pointerover', () => cont.setScale(cont._baseScale * 1.05));
    cont.on('pointerout', () => cont.setScale(cont._baseScale));
    cont.on('pointerdown', (pointer, lx, ly, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this._choose(opt.id);
    });
    return cont;
  }

  // Cover background + config-driven background images for the current
  // orientation. Re-runnable: clears any previously-rendered layers first.
  _renderBgLayers() {
    const W = this.scale.width, H = this.scale.height;
    const isLandscape = W > H;
    (this._bgImgs || []).forEach(im => im && im.destroy());
    this._bgImgs = [];
    this._bgLandscape = isLandscape;

    const bgKey = (isLandscape && this.textures.exists('main_bg_landscape'))
      ? 'main_bg_landscape' : 'main_bg';
    if (this.textures.exists(bgKey)) {
      const bg = this.add.image(W / 2, H / 2, bgKey).setDepth(0);
      bg.setScale(Math.max(W / bg.width, H / bg.height));
      this._bgImgs.push(bg);
    }

    const sceneId = 'start';
    const layers = (this.bundle.background && this.bundle.background.layers) || [];
    layers.forEach((L, i) => {
      if (window.layerVisibleInScene && !window.layerVisibleInScene(L, sceneId)) return;
      let key = L.key || ('bg_' + (L.id != null ? L.id : i));
      if (isLandscape && L.key_landscape && this.textures.exists(L.key_landscape)) key = L.key_landscape;
      if (!this.textures.exists(key)) return;
      const img = this.add.image(0, 0, key).setDepth(L.depth != null ? L.depth : 0);
      if (L.fit === 'cover') {
        img.setPosition(W / 2, H / 2).setScale(Math.max(W / img.width, H / img.height));
      } else {
        const p = window.layerScenePos ? window.layerScenePos(L, sceneId, isLandscape)
                                       : ((isLandscape ? L.landscape : L.portrait) || L.portrait || {});
        img.setPosition(p.x != null ? p.x : W / 2, p.y != null ? p.y : H / 2)
           .setScale(p.scale != null ? p.scale : 1);
      }
      if (window.applyItemAnim) window.applyItemAnim(this, img, window.layerSceneAnim ? window.layerSceneAnim(L, sceneId) : null);
      if (L.cta) { img.setInteractive({ useHandCursor: true }); img.on('pointerdown', (p, x, y, e) => { if (e && e.stopPropagation) e.stopPropagation(); this.clickOut && this.clickOut(); }); }
      this._bgImgs.push(img);
    });
  }

  // Position title + options for the current orientation.
  _relayout() {
    const W = this.scale.width, H = this.scale.height;
    const isLandscape = W > H;
    const okey = isLandscape ? 'landscape' : 'portrait';
    // Re-render backgrounds when the orientation flips so they track the layout.
    if (this._bgLandscape !== isLandscape) this._renderBgLayers();

    if (this._title) {
      const title = this.select.title || {};
      this._title.setPosition(W / 2, title[isLandscape ? 'y_landscape' : 'y'] || H * 0.16);
    }

    if (this._logo && this.select.logo) {
      const lp = (isLandscape ? this.select.logo.landscape : this.select.logo.portrait) || this.select.logo.portrait || {};
      this._logo.setPosition(lp.x != null ? lp.x : W / 2, lp.y != null ? lp.y : H * 0.08)
        .setScale(lp.scale != null ? lp.scale : 1);
    }

    this._optionObjs.forEach(({ cont, opt }, i) => {
      const pos = opt[okey] || opt.portrait || {};
      // Fallback auto-layout: evenly stack (portrait) or row (landscape).
      const n = this._optionObjs.length;
      const fx = isLandscape ? W * (0.5 + (i - (n - 1) / 2) * 0.26) : W * 0.5;
      const fy = isLandscape ? H * 0.58 : H * (0.40 + i * 0.18);
      const x = pos.x != null ? pos.x : fx;
      const y = pos.y != null ? pos.y : fy;
      const scale = pos.scale != null ? pos.scale : 1;
      cont._baseScale = scale;
      cont.setPosition(x, y).setScale(scale);
      // Keep image hit area in sync with its art size.
      if (cont._art) cont.setSize(cont._art.width, cont._art.height);
      else if (cont._badgeSize) cont.setSize(cont._badgeSize.w, cont._badgeSize.h);
    });
  }

  _choose(id) {
    if (this._chosen) return;          // ignore double-taps during transition
    this._chosen = true;
    window.trackAL && window.trackAL('DIFFICULTY_' + String(id).toUpperCase());
    window.LEVEL_CONFIG = mergeBundle(this.bundle, id);
    this.scale.off('resize', this._relayout, this);
    this.scene.start('Game');
  }
}

// Export for Node (tests) and browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DifficultyScene, mergeBundle };
}
