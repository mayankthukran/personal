/**
 * GameScene.js — Data-driven Solitaire Game Scene
 * =================================================
 * Clean Phaser 3 Scene that reads all layout, flow, and animation config
 * from window.LEVEL_CONFIG. Replaces the obfuscated Game class.
 *
 * In dependency mode, state transitions are delegated to GameState (if available).
 * GameScene handles rendering, animation, and user interaction.
 *
 * Expects:
 *   window.LEVEL_CONFIG — level YAML converted to JSON (positions, flow, animation)
 *   window.ASSET_DATA   — texture key -> data URI mapping
 */

// Generic ambient/intro animation for ANY non-card item — background images,
// logo, difficulty options, etc. Config shape (all optional except type):
//   { type:'float'|'sway'|'pulse'|'spin'|'fade_in'|'pop_in', duration, amount }
// `amount` means px for float, degrees for sway, and a scale multiplier for
// pulse (e.g. 1.08). Exposed on window so every scene file can use it.
function applyItemAnim(scene, obj, anim) {
  if (!scene || !obj || !anim) return;
  const type = typeof anim === 'string' ? anim : anim.type;
  if (!type || type === 'none') return;
  const dur = (anim && anim.duration) || 1500;
  const baseY = obj.y;
  const baseAngle = obj.angle || 0;
  const baseSX = obj.scaleX, baseSY = obj.scaleY;
  switch (type) {
    case 'float': {
      const d = (anim && anim.amount) || 18;
      scene.tweens.add({ targets: obj, y: baseY - d, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      break;
    }
    case 'sway': {
      const a = (anim && anim.amount) || 5;
      obj.setAngle(baseAngle - a);
      scene.tweens.add({ targets: obj, angle: baseAngle + a, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      break;
    }
    case 'pulse': {
      const s = (anim && anim.amount) || 1.08;
      scene.tweens.add({ targets: obj, scaleX: baseSX * s, scaleY: baseSY * s, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      break;
    }
    case 'spin': {
      scene.tweens.add({ targets: obj, angle: baseAngle + 360, duration: dur, repeat: -1, ease: 'Linear' });
      break;
    }
    case 'fade_in': {
      obj.setAlpha(0);
      scene.tweens.add({ targets: obj, alpha: 1, duration: dur, ease: 'Sine.easeOut' });
      break;
    }
    case 'pop_in': {
      obj.setScale(0);
      scene.tweens.add({ targets: obj, scaleX: baseSX, scaleY: baseSY, duration: dur, ease: 'Back.easeOut' });
      break;
    }
  }
}
if (typeof window !== 'undefined') window.applyItemAnim = applyItemAnim;

// Per-scene presence + transform for background-layer images. A layer may appear
// in all scenes (L.scenes absent or '*') or only some (L.scenes is an array of
// scene ids: 'start', a level id, or 'end'), and may carry a different
// position/scale per scene in L.layouts[sceneId][orientation]. Falls back to the
// layer's base portrait/landscape when a scene has no override.
function layerVisibleInScene(L, sceneId) {
  const s = L.scenes;
  return s == null || s === '*' || (Array.isArray(s) && s.includes(sceneId));
}
function layerScenePos(L, sceneId, isLandscape) {
  const o = isLandscape ? 'landscape' : 'portrait';
  return (L.layouts && L.layouts[sceneId] && L.layouts[sceneId][o]) || L[o] || L.portrait || {};
}
// Animation is stored PER scene (L.layouts[sceneId].anim), so the same image can
// animate in one scene and stay still in another. Returns null when this scene
// has no animation configured.
function layerSceneAnim(L, sceneId) {
  return (L.layouts && L.layouts[sceneId] && L.layouts[sceneId].anim) || null;
}
if (typeof window !== 'undefined') {
  window.layerVisibleInScene = layerVisibleInScene;
  window.layerScenePos = layerScenePos;
  window.layerSceneAnim = layerSceneAnim;
}

class Game extends Phaser.Scene {
  playSound(key, config) {
    // SFX honor the mute toggle; bgm (music) is started separately, not here.
    if (typeof SoundControls !== 'undefined' && !SoundControls.canPlaySfx()) return;
    if (this.cache.audio.exists(key)) this.sound.play(key, config);
  }

  constructor() {
    super('Game');

    // State
    this.activeFlow = null;      // 'A' or 'B'
    this.flowStep = 0;
    this.playedCards = new Set();
    this.playableCards = new Set();
    this.isAnimating = false;
    this.playedCardDepth = 1;
    this.progressStage = 0;
    this.cardBackOverlays = [];
    this.isWagsAnimating = false;
    this.collectiblesCollected = 0;
    this.cakeGlowing = false;
    this.revealedCakeLayers = new Set();
    this.lastHintedCardIndex = -1;

    // Dependency mode state
    this.dependencyMap = {};    // card -> [blockers]
    this.reverseDepMap = {};    // card -> [cards it blocks]
    this.removedCards = new Set();

    // Talon deck state
    this.talonDeckCards = [];      // ordered list of card keys in the stock
    this.talonDeckSprites = {};    // key -> face sprite
    this.talonCurrentIndex = -1;   // next stock card to flip (counts down)
    this.talonStockBacks = [];     // stacked card_back sprites for stock visual
    this.currentTopCard = null;    // key of current face-up card on waste
    this.currentTopRank = 0;       // rank value for ±1 matching

    // Final-tap CTA funnel: after auto_end_moves moves, the next tap redirects.
    this.moveCount = 0;
    this._redirected = false;

    // Uncovered cards (face-up on tableau, blockers removed)
    this.uncoveredCards = new Set();
  }

  // ===========================================================================
  // LAYOUT SELECTION
  // ===========================================================================

  selectLayout() {
    const config = window.LEVEL_CONFIG;
    const isLandscape = this.scale.width > this.scale.height;
    return isLandscape ? config.landscape : config.portrait;
  }

  getCardScale() {
    const isLandscape = this.scale.width > this.scale.height;
    const scales = window.LEVEL_CONFIG.scales || {};
    const cardScales = scales.card || { portrait: 0.35, landscape: 0.27 };
    return isLandscape ? cardScales.landscape : cardScales.portrait;
  }

  applyCardShadow(sprite) {
    // Soft drop shadow on cards, opt-in via level YAML `card_shadows: true`.
    // Phaser preFX requires WebGL (Phaser.AUTO falls back to Canvas in alpha mode);
    // guard so Canvas/alpha builds silently skip.
    const cfg = window.LEVEL_CONFIG.card_shadows;
    if (!cfg || !sprite || !sprite.preFX) return;
    const s = (typeof cfg === 'object') ? cfg : {};
    sprite.preFX.addShadow(
      s.x ?? 0, s.y ?? 6,
      s.decay ?? 0.1, s.power ?? 1,
      s.color ?? 0x000000,
      s.samples ?? 6,
      s.intensity ?? 0.6
    );
  }

  getTalonScale() {
    const isLandscape = this.scale.width > this.scale.height;
    const scales = window.LEVEL_CONFIG.scales || {};
    const talonScales = scales.talon || { portrait: 1.2, landscape: 1.1 };
    return isLandscape ? talonScales.landscape : talonScales.portrait;
  }

  getIconScale() {
    const isLandscape = this.scale.width > this.scale.height;
    const scales = window.LEVEL_CONFIG.scales || {};
    const iconScales = scales.icon || { portrait: 1.4, landscape: 1.2 };
    return isLandscape ? iconScales.landscape : iconScales.portrait;
  }

  // Render config-driven background layers — multiple images, each placed/scaled
  // per orientation, or `fit:'cover'` to fill the canvas. Drawn at depth 0 (below
  // the cards). Keys come from LEVEL_CONFIG.background.layers[i].key (e.g. bg_0).
  renderBackgroundLayers() {
    const config = window.LEVEL_CONFIG || {};
    const sceneId = config._sceneId || '';
    const layers = (config.background && config.background.layers) || [];
    const W = this.scale.width, H = this.scale.height;
    const isLandscape = W > H;
    // Re-runnable on orientation change: drop any previously-rendered layers first.
    (this._bgLayerImgs || []).forEach(im => im && im.destroy());
    this._bgLayerImgs = [];
    this._bgLandscape = isLandscape;
    layers.forEach((L, i) => {
      if (!layerVisibleInScene(L, sceneId)) return;
      let key = L.key || ('bg_' + (L.id != null ? L.id : i));
      if (isLandscape && L.key_landscape && this.textures.exists(L.key_landscape)) key = L.key_landscape;
      if (!this.textures.exists(key)) return;
      const img = this.add.image(0, 0, key).setDepth(L.depth != null ? L.depth : 0);
      if (L.fit === 'cover') {
        img.setPosition(W / 2, H / 2).setScale(Math.max(W / img.width, H / img.height));
      } else {
        const p = layerScenePos(L, sceneId, isLandscape);
        img.setPosition(p.x != null ? p.x : W / 2, p.y != null ? p.y : H / 2)
           .setScale(p.scale != null ? p.scale : 1);
        if (p.r) img.setRotation(p.r);
      }
      applyItemAnim(this, img, layerSceneAnim(L, sceneId));
      if (L.cta) { img.setInteractive({ useHandCursor: true }); img.on('pointerdown', () => this.clickOut && this.clickOut()); }
      this._bgLayerImgs.push(img);
    });
  }

  // ===========================================================================
  // CREATE
  // ===========================================================================

  create() {
    const config = window.LEVEL_CONFIG;

    // When no start scene, load all assets first, then continue setup
    if (config.preload_assets) {
      this.loadPreloadAssets(config.preload_assets, () => {
        this._doCreate(config);
      });
    } else {
      this._doCreate(config);
    }
  }

  loadPreloadAssets(preloadAssets, onComplete) {
    const imageEntries = Object.entries(preloadAssets.images || {});
    const audioEntries = Object.entries(preloadAssets.audio || {});
    let remaining = imageEntries.length + audioEntries.length;
    if (remaining === 0) { onComplete(); return; }

    const done = () => { if (--remaining <= 0) onComplete(); };

    imageEntries.forEach(([key, dataUri]) => {
      if (this.textures.exists(key)) { done(); return; }
      const img = new Image();
      img.onload = () => { this.textures.addImage(key, img); done(); };
      img.onerror = () => { console.warn('Failed to load preload asset:', key); done(); };
      img.src = dataUri;
    });

    audioEntries.forEach(([key, dataUri]) => {
      if (this.cache.audio.exists(key)) { done(); return; }
      // Decode base64 audio data URI into ArrayBuffer, then add to Phaser audio cache
      const base64 = dataUri.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const audioCtx = this.sound.context || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.decodeAudioData(bytes.buffer.slice(0), (buffer) => {
        this.cache.audio.add(key, buffer);
        done();
      }, () => {
        console.warn('Failed to decode audio:', key);
        done();
      });
    });
  }

  _doCreate(config) {
    const layout = this.selectLayout();

    // Store layouts for reflow
    this.LAYOUT_PORTRAIT = config.portrait;
    this.LAYOUT_LANDSCAPE = config.landscape;

    // Background — use the wide variant in landscape so it fills without heavy crop.
    const bgKey = (this.scale.width > this.scale.height
      && this.textures.exists('main_bg_landscape')) ? 'main_bg_landscape' : 'main_bg';
    if (this.textures.exists(bgKey)) {
      const bg = this.add.image(this.scale.width / 2, this.scale.height / 2, bgKey)
        .setDepth(0);
      // Cover-fit: scale to fill canvas without distortion, cropping overflow
      const scaleX = this.scale.width / bg.width;
      const scaleY = this.scale.height / bg.height;
      const coverScale = Math.max(scaleX, scaleY);
      bg.setScale(coverScale);
      this.main_bg = bg;
    }

    // Config-driven background layers (multiple placed/scaled images at depth 0).
    this.renderBackgroundLayers();

    // Talon pile graphic (telon) — sits behind the talon stock/waste, like the
    // Wags talon_bg. Drawn just under the cards container. Suppressed entirely
    // when base graphics are off (engine builds: talon is just the active card).
    if (layout.telon && this.textures.exists('telon') && this.talonBaseGraphicEnabled()) {
      const t = layout.telon;
      this.telon = this.add.image(t.x, t.y, 'telon')
        .setScale(t.scale != null ? t.scale : 1)
        .setDepth(t.depth != null ? t.depth : 9);
    }

    // Mat
    if (layout.mat && this.textures.exists('mat')) {
      const matPos = layout.mat;
      this.add.image(matPos.x, matPos.y, 'mat')
        .setScale(matPos.scale || 1)
        .setDepth(0);
    }

    // Table/surface foreground layer (config-driven, optional)
    if (layout.table_bg && this.textures.exists('table_bg')) {
      const tbPos = layout.table_bg;
      this.table_bg = this.add.image(tbPos.x, tbPos.y, 'table_bg')
        .setScale(tbPos.scale || 1)
        .setDepth(tbPos.depth || 2);
    }

    // Create containers
    this.cardsContainer = this.add.container(0, 0).setDepth(10);
    this.uiContainer = this.add.container(0, 0).setDepth(5);
    // Resting collectible icons sit BEHIND the cards (depth 8) so they peek out
    // from behind the card edges. During their flight to the reward they are
    // reparented to iconFlyContainer (depth 35) so they travel over the cards.
    this.iconContainer = this.add.container(0, 0).setDepth(8);
    this.iconFlyContainer = this.add.container(0, 0).setDepth(35);

    // Create UI elements
    this.createUIElements(layout);

    // Mute toggles (music + SFX) — no-op when disabled (e.g. recording builds)
    if (typeof SoundControls !== 'undefined') SoundControls.attach(this);

    // Create Wags character
    this.createWags(layout);

    const isDependencyMode = (config.game_flow || {}).mode === 'dependency';
    this.hasCollectibles = Object.keys(config.card_to_icons || {}).length > 0;

    // Create cake container (skip in dependency mode unless collectibles are configured)
    if (!isDependencyMode || this.hasCollectibles) {
      this.createCakeContainer(layout);
    }

    // Create progress bar (scripted mode only — dependency mode uses cake reveals instead)
    if (!isDependencyMode) {
      this.createProgressBar(layout);
    }

    // Sound
    this.sound.pauseOnBlur = false;

    // Background music — held as a single instance so the music toggle can
    // (un)mute it across scene transitions without restarting the track.
    if (this.cache.audio.exists('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.5 });
      this.bgm.play();
      if (typeof SoundControls !== 'undefined') SoundControls.registerBgm(this.bgm);
    }

    // Resize handler
    this.scale.on('resize', this.onResize, this);

    if (isDependencyMode && config.card_assets) {
      // Load card textures from embedded base64, then continue setup
      this.loadCardAssets(config.card_assets, () => {
        this.finishCreate(layout, isDependencyMode);
      });
    } else {
      this.finishCreate(layout, isDependencyMode);
    }
  }

  finishCreate(layout, isDependencyMode) {
    // Create cards
    this.createCards(layout);

    // Create icons (skip in dependency mode unless collectibles are configured)
    if (!isDependencyMode || this.hasCollectibles) {
      this.createIcons(layout);
    }

    // Create hand pointer
    this.createHandPointer(layout);

    // Story-intro modal (opt-in via LEVEL_CONFIG.story) — meta-story playables
    // present a narrative panel + choice before the deal. Non-story levels (and
    // every other theme) fall straight through to dealing, unchanged.
    const story = (window.LEVEL_CONFIG || {}).story;
    if (story && story.intro) {
      this.showStoryIntro(story.intro, () => this.animateCardsIn());
    } else {
      this.animateCardsIn();
    }
  }

  // Full-screen narrative intro panel. Auto-starts the deal after
  // intro.auto_advance_ms (no user input required); a tap skips early. Renders
  // intro.choices as labelled buttons, a single intro.cta button, or a
  // tap-anywhere fallback — all of which just dismiss and start the deal. Drawn
  // with primitives so it needs no art; if intro.bg names a loaded texture it's
  // used as the backdrop, else a dark veil stands in.
  showStoryIntro(intro, onDone) {
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2;
    const layer = this.add.container(0, 0).setDepth(200);
    const textStyle = (size, opts) => ({
      fontFamily: 'Arial, sans-serif', fontSize: Math.round(W * size) + 'px', ...opts,
    });

    const bgKey = (W > H && intro.bg_landscape && this.textures.exists(intro.bg_landscape))
      ? intro.bg_landscape : intro.bg;
    if (bgKey && this.textures.exists(bgKey)) {
      const bg = this.add.image(W / 2, H / 2, bgKey);
      bg.setScale(Math.max(W / bg.width, H / bg.height));
      layer.add(bg);
      layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x0a0a1a, 0.35));
    } else {
      layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x0a0a1a, 0.82));
    }

    layer.add(this.add.text(cx, H * 0.26, intro.headline || '', textStyle(0.060, {
      fontStyle: 'bold', color: '#ffe9a8', align: 'center',
      stroke: '#3a1d00', strokeThickness: Math.max(3, Math.round(W * 0.006)),
      wordWrap: { width: W * 0.84 },
    })).setOrigin(0.5));

    if (intro.prompt) {
      layer.add(this.add.text(cx, H * 0.36, intro.prompt, textStyle(0.040, {
        color: '#ffffff', align: 'center', wordWrap: { width: W * 0.8 },
      })).setOrigin(0.5));
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.tweens.add({
        targets: layer, alpha: 0, duration: 260, ease: 'Quad.easeIn',
        onComplete: () => { layer.destroy(); onDone(); },
      });
    };

    const makeButton = (y, label) => {
      const bw = W * 0.62, bh = H * 0.082;
      const btn = this.add.container(cx, y);
      const g = this.add.graphics();
      g.fillStyle(0x2e7d32, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh * 0.28);
      g.lineStyle(Math.max(2, W * 0.004), 0xffe9a8, 1)
        .strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, bh * 0.28);
      btn.add([g, this.add.text(0, 0, label, textStyle(0.040, {
        fontStyle: 'bold', color: '#ffffff', align: 'center',
        wordWrap: { width: bw * 0.9 },
      })).setOrigin(0.5)]);
      btn.setSize(bw, bh).setInteractive(
        new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh),
        Phaser.Geom.Rectangle.Contains);
      btn.on('pointerdown', finish);
      this.tweens.add({ targets: btn, scale: { from: 1, to: 1.04 }, duration: 700,
        yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      layer.add(btn);
    };

    const choices = intro.choices || [];
    if (choices.length) {
      const bh = H * 0.082, gap = H * 0.03, startY = H * 0.54;
      choices.forEach((c, i) => makeButton(startY + i * (bh + gap),
        c.label || ('Option ' + (i + 1))));
    } else if (intro.cta) {
      makeButton(H * 0.62, intro.cta);
    } else {
      const hit = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.001)
        .setInteractive();
      hit.on('pointerdown', finish);
      layer.add(hit);
    }

    // Auto-start: advance without any tap after the delay (tap still skips early).
    const ms = intro.auto_advance_ms;
    if (ms && ms > 0) this.time.delayedCall(ms, finish);
  }

  loadCardAssets(cardAssets, onComplete) {
    const keys = Object.keys(cardAssets);
    if (keys.length === 0) { onComplete(); return; }

    let loaded = 0;
    const total = keys.length;
    // Guard so finishCreate() runs exactly once even if the count is reached more
    // than once (avoids a duplicated board / double create).
    let fired = false;
    const finish = () => { if (fired) return; fired = true; onComplete(); };

    keys.forEach(texKey => {
      if (this.textures.exists(texKey)) {
        loaded++;
        if (loaded >= total) finish();
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (!this.textures.exists(texKey)) this.textures.addImage(texKey, img);
        loaded++;
        if (loaded >= total) finish();
      };
      img.onerror = () => {
        console.warn('Failed to load card asset:', texKey);
        loaded++;
        if (loaded >= total) finish();
      };
      img.src = cardAssets[texKey];
    });
  }

  // ===========================================================================
  // UI ELEMENTS
  // ===========================================================================

  createUIElements(layout) {
    // Logo
    if (layout.logo && this.textures.exists('logo')) {
      this.logo = this.add.image(layout.logo.x, layout.logo.y, 'logo')
        .setScale(layout.logo.scale || 0.5)
        .setDepth(100);
      applyItemAnim(this, this.logo, layout.logo.anim);
    }

    // Counter
    if (layout.counter && this.textures.exists('counter')) {
      this.counter = this.add.image(layout.counter.x, layout.counter.y, 'counter')
        .setScale(layout.counter.scale || 1)
        .setDepth(layout.counter.depth || 25);
    }

    // Bunting
    if (layout.bunting_left && this.textures.exists('bunting_left')) {
      this.bunting_left = this.add.image(layout.bunting_left.x, layout.bunting_left.y, 'bunting_left')
        .setScale(layout.bunting_left.scale || 1.4)
        .setDepth(100);
    }
    if (layout.bunting_right && this.textures.exists('bunting_right')) {
      this.bunting_right = this.add.image(layout.bunting_right.x, layout.bunting_right.y, 'bunting_right')
        .setScale(layout.bunting_right.scale || 1.4)
        .setDepth(100);
    }

    // Text elements
    const textKeys = Object.keys(layout).filter(k => k.startsWith('text_'));
    textKeys.forEach(key => {
      if (this.textures.exists(key)) {
        const pos = layout[key];
        this[key] = this.add.image(pos.x, pos.y, key)
          .setScale(pos.scale || 1)
          .setDepth(100)
          .setAlpha(0);
      }
    });

    // Optional top banner (config: top_banner)
    this.createTopBanner();
  }

  // ---------------------------------------------------------------------------
  // Top banner — a rounded pill with a short message (config: top_banner)
  //   top_banner: { text: "Tricky but solvable", bg: "#27408b",
  //                 frame: "#ffce7a", color: "#fff0c8" }
  // ---------------------------------------------------------------------------
  createTopBanner() {
    const cfg = (window.LEVEL_CONFIG || {}).top_banner;
    if (!cfg || !cfg.text) return;
    this._bannerCfg = cfg;
    this.topBannerBg = this.add.graphics().setDepth(120);
    this.topBannerText = this.add.text(0, 0, cfg.text, {
      fontFamily: 'Arial, sans-serif', fontSize: '54px', fontStyle: 'bold',
      color: cfg.color || '#fff0c8', align: 'center',
    }).setOrigin(0.5).setDepth(121);
    this.layoutTopBanner();
  }

  layoutTopBanner() {
    if (!this.topBannerText) return;
    const cfg = this._bannerCfg || {};
    const hex = (s, d) => parseInt(String(s || d).replace('#', ''), 16);
    const isLandscape = this.scale.width > this.scale.height;
    const cx = this.scale.width / 2;
    const cy = this.scale.height * (isLandscape ? 0.075 : 0.05);
    this.topBannerText.setPosition(cx, cy);
    const w = this.topBannerText.width + 92, h = this.topBannerText.height + 40, r = h / 2;
    const g = this.topBannerBg; g.clear();
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(cx - w / 2 + 5, cy - h / 2 + 6, w, h, r); // shadow
    g.fillStyle(hex(cfg.bg, '27408b'), 0.96); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(6, hex(cfg.frame, 'ffce7a'), 0.95); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }

  // ===========================================================================
  // WAGS CHARACTER
  // ===========================================================================

  createWags(layout) {
    if (!layout.wags_container) return;

    const wc = layout.wags_container;
    this.wags_container = this.add.container(wc.x, wc.y).setDepth(50);
    if (wc.scale) this.wags_container.setScale(wc.scale);

    // Wags body parts — from config (theme-specific draw order)
    const charConfig = window.LEVEL_CONFIG.character || {};
    const wagsParts = charConfig.game_parts || [
      'tail', 'left_eyeball', 'right_eyeball',
      'left_pupil', 'right_pupil',
      'left_eyelash', 'right_eyelash',
      'wags_1', 'birthday_hat',
    ];

    wagsParts.forEach(part => {
      if (layout[part] && this.textures.exists(part)) {
        const pos = layout[part];
        // Eyelids start at ye (open/hidden) position; y is closed position
        const isEyelid = (part === 'left_eyelash' || part === 'right_eyelash');
        const startY = isEyelid && pos.ye != null ? pos.ye : pos.y;
        // wags_1 is the animated body — needs to be a Sprite (not Image) for anims
        const sprite = part === 'wags_1'
          ? this.add.sprite(pos.x, startY, this.textures.exists('wags_idle_01') ? 'wags_idle_01' : part)
          : this.add.image(pos.x, startY, part);
        if (part === 'tail') sprite.setOrigin(1, 1);
        if (part === charConfig.hat_key) sprite.setOrigin(0.5, 0);
        if (isEyelid) sprite.setOrigin(1, 0.5);
        if (pos.scale) sprite.setScale(pos.scale);
        if (pos.r) sprite.setRotation(pos.r);
        if (pos.depth) sprite.setDepth(pos.depth);
        this[part] = sprite;
        this.wags_container.add(sprite);
      }
    });

    // Register stage-specific animations from the Veo-generated frame sets
    this.createWagsAnims();

    // Start idle animation
    this.startWagsIdle();
    // Kick off stage-0 excitement idle — plays the idle frame loop
    this.escalateWagsExcitement(0);
  }

  // Build the 4 looping animations from the per-stage frame sets generated by Veo:
  // wags_idle_01..12, wags_alert_01..12, wags_bouncing_01..12, wags_dance_01..18.
  // Each animation is a seamless loop — Phaser's anims API plays them at frameRate
  // and repeats indefinitely. escalateWagsExcitement() switches between them.
  createWagsAnims() {
    const buildAnim = (key, prefix, count, frameRate) => {
      if (this.anims.exists(key)) return;
      const frames = [];
      for (let i = 1; i <= count; i++) {
        const fkey = `${prefix}_${String(i).padStart(2, '0')}`;
        if (this.textures.exists(fkey)) frames.push({ key: fkey });
      }
      if (frames.length < 2) return;       // need at least 2 frames for an animation
      this.anims.create({ key, frames, frameRate, repeat: -1 });
    };
    buildAnim('wags_idle',     'wags_idle',     12, 6);
    buildAnim('wags_alert',    'wags_alert',    12, 7);
    buildAnim('wags_bouncing', 'wags_bouncing', 12, 9);
    buildAnim('wags_dance',    'wags_dance',    18, 9);
  }

  startWagsIdle() {
    if (!this.tail) return;

    // Start with slow tail wag — speeds up as collectibles are collected
    this.tailBaseRotation = this.tail.rotation || 0;
    this.tail.setRotation(this.tailBaseRotation);
    this.updateTailWag();

    // Idle look cycle: look right → look forward → blink → repeat
    this.startWagsLookCycle();
  }

  updateTailWag() {
    if (!this.tail) return;

    // Kill existing tail tween
    if (this.tailWagTween) this.tailWagTween.stop();

    const config = window.LEVEL_CONFIG;
    const totalCollectibles = Object.keys(config.card_to_icons || {}).length || 1;
    const progress = this.collectiblesCollected / totalCollectibles;

    // Very slow at start, frantic when cake is complete
    const angle = 8 + progress * 40;         // 8° → 48°
    const duration = 900 - progress * 700;   // 900ms → 200ms

    this.tailWagTween = this.tweens.add({
      targets: this.tail,
      angle: '+=' + angle,
      duration: duration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  startWagsLookCycle() {
    const layout = this.selectLayout();
    const pupils = ['left_pupil', 'right_pupil'].filter(p => this[p]);
    const eyelids = ['left_eyelash', 'right_eyelash'].filter(p => this[p]);
    if (pupils.length === 0) return;

    // Store base pupil positions
    const pupilBaseX = {};
    pupils.forEach(p => {
      const pos = layout[p];
      if (pos) pupilBaseX[p] = pos.x;
    });

    const lookOffset = 8; // Pixels to shift pupils right to look at cards
    const cycleDuration = 4000; // Total cycle length

    const runCycle = () => {
      if (this.isWagsAnimating) {
        this.time.delayedCall(500, runCycle);
        return;
      }

      // Phase 1: Look left at cards (shift pupils left)
      pupils.forEach(p => {
        this.tweens.add({
          targets: this[p],
          x: pupilBaseX[p] + lookOffset,
          duration: 300,
          ease: 'Sine.easeInOut',
        });
      });

      // Phase 2: Hold, then look back forward
      this.time.delayedCall(1500, () => {
        pupils.forEach(p => {
          this.tweens.add({
            targets: this[p],
            x: pupilBaseX[p],
            duration: 300,
            ease: 'Sine.easeInOut',
          });
        });

        // Phase 3: Hold, then blink
        this.time.delayedCall(1200, () => {
          eyelids.forEach(p => {
            const pos = layout[p];
            if (!pos || pos.ye == null) return;
            this.tweens.add({
              targets: this[p],
              y: pos.y,       // closed position
              duration: 150,
              yoyo: true,
              ease: 'Linear',
            });
          });

          // Restart cycle
          this.time.delayedCall(cycleDuration - 3000, runCycle);
        });
      });
    };

    // Start first cycle after a short delay
    this.time.delayedCall(1000, runCycle);
  }

  // ===========================================================================
  // CAKE CONTAINER
  // ===========================================================================

  createCakeContainer(layout) {
    const config = window.LEVEL_CONFIG;
    const ui = config.ui || {};
    const isLandscape = this.scale.width > this.scale.height;
    const cakeConfig = ui.collectibleContainer;

    if (!cakeConfig) {
      // Fallback to layout position
      if (layout.collectibleContainer) {
        this.collectibleContainerSprite = this.add.container(
          layout.collectibleContainer.x, layout.collectibleContainer.y
        ).setDepth(30);
        if (layout.collectibleContainer.scale) {
          this.collectibleContainerSprite.setScale(layout.collectibleContainer.scale);
        }
      }
      return;
    }

    const orient = isLandscape ? 'landscape' : 'portrait';
    const pos = cakeConfig[orient] || cakeConfig;
    this.collectibleContainerSprite = this.add.container(pos.x, pos.y).setDepth(30);
    if (pos.scale) this.collectibleContainerSprite.setScale(pos.scale);

    // Add cake layers — from config (theme-specific reward parts)
    const rewardConfig = window.LEVEL_CONFIG.reward || {};
    const cakeParts = rewardConfig.parts || [];
    const basePart = rewardConfig.base_part || 'round_base';

    cakeParts.forEach(part => {
      const partLayout = layout[part];
      if (partLayout && this.textures.exists(part)) {
        const sprite = this.add.image(partLayout.x, partLayout.y, part);
        if (partLayout.scale) sprite.setScale(partLayout.scale);
        if (partLayout.depth) sprite.setDepth(partLayout.depth);
        sprite.setAlpha(0); // Hidden initially, revealed when earned
        this[part] = sprite;
        this.collectibleContainerSprite.add(sprite);
      }
    });

    // Sort children by depth so top layers render above bottom layers
    this.collectibleContainerSprite.sort('depth');

    // Show only the base initially — cake layers are revealed via collectibles
    if (this[basePart]) this[basePart].setAlpha(1);
  }

  // ===========================================================================
  // PROGRESS BAR
  // ===========================================================================

  createProgressBar(layout) {
    const progressParts = [
      'red_base', 'gold_border', 'progress_start',
      'progress_end_1', 'progress_mid_1',
      'progress_end_2', 'progress_mid_2', 'progress_mid_3', 'progress_end_3',
    ];

    this.progressSprites = {};
    progressParts.forEach(part => {
      const pos = layout[part];
      if (pos && this.textures.exists(part)) {
        const sprite = this.add.image(pos.x, pos.y, part)
          .setScale(pos.scale || 1)
          .setDepth((pos.depth || 1) + 5);
        this.progressSprites[part] = sprite;
        // Initially hide progress segments
        if (part.startsWith('progress_mid') || part.startsWith('progress_end')) {
          sprite.setAlpha(0);
        }
      }
    });
  }

  // ===========================================================================
  // CARDS
  // ===========================================================================

  // Drop shadow so a card reads as a raised 3D object lifted off the table.
  // A cheap tinted silhouette of the card, offset down-right and sorted just
  // below it (so only the offset sliver shows). Synced to the card each frame
  // in update() — follows every deal/play tween without per-card tween edits.
  // Deliberately NOT postFX.addShadow: that reads the framebuffer per card per
  // frame (ReadPixels), stalling low-end GPUs.
  applyCardShadow(sprite) {
    if (!sprite || !this.textures.exists(sprite.texture.key)) return;
    const shadow = this.add.image(sprite.x, sprite.y, sprite.texture.key)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setRotation(sprite.rotation)
      .setTint(0x000000)
      .setAlpha(0.3)
      .setDepth((sprite.depth || 1) - 0.1);
    this.cardsContainer.add(shadow);
    sprite._shadow = shadow;
    (this._cardShadows = this._cardShadows || []).push(sprite);
  }

  // Keep each card's drop shadow glued to its card (position, rotation, scale,
  // visibility). Depth is fixed at creation so the container stays sorted.
  update() {
    const owners = this._cardShadows;
    if (!owners) return;
    for (let i = 0; i < owners.length; i++) {
      const c = owners[i], sh = c && c._shadow;
      if (!sh) continue;
      if (!c.active || !c.visible) { sh.setVisible(false); continue; }
      const off = 8 * Math.abs(c.scaleX);
      sh.setVisible(true);
      sh.setPosition(c.x + off, c.y + off * 1.4);
      sh.setRotation(c.rotation);
      sh.setScale(c.scaleX, c.scaleY);
    }
  }

  createCards(layout) {
    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};
    const isDependencyMode = gameFlow.mode === 'dependency';

    let allCardKeys;
    if (isDependencyMode) {
      // In dependency mode, all non-UI keys in layout are cards.
      // IMPORTANT: reward.parts MUST be excluded here — if a reward layer name
      // (e.g. sauce_layer) exists in both the layout and the texture cache,
      // createCards() will create a card sprite for it and this[key] = card
      // will overwrite the collectible container sprite set by createCakeContainer(),
      // silently breaking layer reveals.
      const uiKeys = new Set(['talon_base', 'talon_deck', 'telon', 'mat', 'table_bg', 'logo', 'counter',
        'bunting_left', 'bunting_right', 'wags_container', 'hand',
        'collectibleContainer']);
      const rewardParts = new Set(
        ((config.reward || {}).parts || [])
      );
      allCardKeys = Object.keys(layout).filter(k =>
        !uiKeys.has(k) && !rewardParts.has(k) &&
        !k.startsWith('text_') && !k.startsWith('icon_') &&
        !k.startsWith('progress_') && !k.startsWith('red_') &&
        !k.startsWith('gold_') && !k.startsWith('round_') &&
        !k.startsWith('base_') && !k.startsWith('frosting_') &&
        !k.startsWith('topping_') && !k.startsWith('wags_') &&
        !k.startsWith('tail') && !k.startsWith('tongue') &&
        !k.startsWith('birthday_') && !k.startsWith('left_') &&
        !k.startsWith('right_') && !k.startsWith('chef_')
      );
    } else {
      const dealOrder = gameFlow.deal_order || [];

      // All card keys from deal order + talon cards
      allCardKeys = [...dealOrder];

      // Add talon entry card if not in deal_order
      if (layout['spades_2_t'] && !allCardKeys.includes('spades_2_t')) {
        allCardKeys.push('spades_2_t');
      }

      // Add any entry cards
      const entryCards = gameFlow.entry_cards || {};
      Object.values(entryCards).forEach(k => {
        if (!allCardKeys.includes(k)) allCardKeys.push(k);
      });
    }

    this.cardSprites = {};
    this.cardBackOverlays = [];
    this._cardShadows = [];

    allCardKeys.forEach(key => {
      const pos = layout[key];
      if (!pos) return;

      // Determine texture key (strip _d/_t suffix for texture lookup).
      // Obstacle face-swap cards (lock, key, double-value, mirror, color-wild)
      // use the obstacle's art instead of the plain card face.
      const ob = ((window.LEVEL_CONFIG || {}).obstacles || {})[key];
      let texKey = this.resolveTextureKey(key);
      if (ob && ob._face && this.textures.exists(ob._face)) texKey = ob._face;
      if (!this.textures.exists(texKey)) return;

      // Some obstacle cards render bigger (Double Value shows two ranks, ~1.35×).
      const PEo = (window.PE || {}).obstacle;
      const enlarge = (ob && PEo && PEo.OBSTACLES[ob.type] && PEo.OBSTACLES[ob.type].enlarge) || 1;
      const cardScale = (pos.scale || this.getCardScale()) * enlarge;

      // Create card face sprite
      const card = this.add.image(pos.x, pos.y, texKey)
        .setScale(cardScale)
        .setDepth(pos.depth || 1)
        .setAlpha(1);
      if (pos.r) card.setRotation(pos.r);
      this.applyCardShadow(card);

      // Make interactive (Key cards auto-unlock on reveal, so they aren't tapped).
      if (!(ob && ob.type === 'KEY')) {
        card.setInteractive();
        card.on('pointerdown', () => this.onCardTapped(key));
      }

      this.cardSprites[key] = card;
      this[key] = card;

      // Create card back overlay. Depth is +0.5 over the face so a depth sort
      // always keeps a card's back above its own face (covering it until flip),
      // while integer depths still control the tableau overlap.
      // Face-up obstacles (e.g. the lock door) skip the face-down back — their
      // obstacle overlay is what's shown until they are cleared.
      if (this.textures.exists('card_back') && !(ob && ob._faceUp)) {
        const overlay = this.add.image(pos.x, pos.y, 'card_back')
          .setScale(cardScale)
          .setDepth((pos.depth || 1) + 0.5)
          .setVisible(true)
          .setAlpha(1);
        if (pos.r) overlay.setRotation(pos.r);
        this.applyCardShadow(overlay);
        overlay.setData('cardKey', key);
        this.cardBackOverlays.push(overlay);
      }

      // Add to container
      this.cardsContainer.add(card);
      const overlay = this.cardBackOverlays.find(o => o.getData('cardKey') === key);
      if (overlay) this.cardsContainer.add(overlay);

      // Obstacle overlay (rope / curtain / shield / bomb) on top of the card,
      // plus a bomb counter number.
      if (ob && ob._overlay && this.textures.exists(ob._overlay)) {
        const ov = this.add.image(pos.x, pos.y, ob._overlay)
          .setScale(pos.scale || this.getCardScale())
          .setDepth((pos.depth || 1) + 0.6);
        if (pos.r) ov.setRotation(pos.r);
        this.cardsContainer.add(ov);
        (this._obstacleOverlays = this._obstacleOverlays || {})[key] = ov;
        // Trap ropes / mirror frames / curtains only appear once the card flips
        // face-up (hidden while the card is still face-down behind its card_back).
        const isCurtain = ob.type === 'COLOR_CARD' || ob.type === 'COLOR_SUIT_CARD';
        const hideUntilFlip = (ob.type === 'TRAP_CARD' || ob.type === 'MIRROR_CARD' || isCurtain)
          && this.textures.exists('card_back') && !(ob && ob._faceUp);
        if (hideUntilFlip) ov.setVisible(false);
        // A curtain = cloth (hangs from the roller, covering the card) + a wide
        // roller bar on top. The cloth is dropped a little lower so its bottom
        // reaches the card's bottom edge; the roller covers the very top. Offsets
        // are taken ALONG the card's own axis so the curtain stays aligned at ANY
        // rotation (the card's local "up" direction is (sin r, -cos r)).
        if (isCurtain) {
          const r = pos.r || 0, sin = Math.sin(r), cos = Math.cos(r), h = card.displayHeight;
          ov.setDisplaySize(card.displayWidth, h);
          ov.setPosition(pos.x - 0.1 * h * sin, pos.y + 0.1 * h * cos);   // cloth dropped down the card axis
          const rollerKey = `oba_${ob.type}_roller`;
          if (this.textures.exists(rollerKey)) {
            const roller = this.add.image(pos.x + 0.4 * h * sin, pos.y - 0.4 * h * cos, rollerKey)
              .setDepth((pos.depth || 1) + 0.64);
            roller.setDisplaySize(card.displayWidth * 1.34, h * 0.24);
            roller.setRotation(r);
            if (hideUntilFlip) roller.setVisible(false);
            this.cardsContainer.add(roller);
            (this._curtainRollers = this._curtainRollers || {})[key] = roller;
          }
        }
        // The mirror GLASS is exactly the card size (covers the card face); the gold
        // FRAME is a touch larger so it sits as a border AROUND the mirror.
        if (ob.type === 'MIRROR_CARD') {
          ov.setDisplaySize(card.displayWidth*1.15 , card.displayHeight*1.15);
          if (this.textures.exists('oba_MIRROR_CARD_frame')) {
            const fr = this.add.image(pos.x, pos.y, 'oba_MIRROR_CARD_frame')
              .setDepth((pos.depth || 1) + 0.7);
            fr.setDisplaySize(card.displayWidth * 1.15, card.displayHeight * 1.15);
            if (pos.r) fr.setRotation(pos.r);
            if (hideUntilFlip) fr.setVisible(false);
            this.cardsContainer.add(fr);
            (this._mirrorFrames = this._mirrorFrames || {})[key] = fr;
          }
        }
      }
      if (ob && ob._counter) {
        const txt = this.add.text(pos.x, pos.y + (pos.scale || this.getCardScale()) * 40, String(ob._counter), {
          fontFamily: 'Arial Black, Arial', fontStyle: 'bold',
          fontSize: Math.round((pos.scale || this.getCardScale()) * 120) + 'px',
          color: '#ffffff', stroke: '#000000', strokeThickness: 8,
        }).setOrigin(0.5).setDepth((pos.depth || 1) + 0.7);
        this.cardsContainer.add(txt);
        (this._bombTexts = this._bombTexts || {})[key] = txt;
      }
    });

    // Sort cards by depth so higher-depth cards render on top
    this.cardsContainer.sort('depth');

    // Talon base — the landing target for played cards (the discard/waste spot),
    // so it is ALWAYS created. If a 'talon_base' marker texture is supplied it's
    // shown (only when the drawn panel is off); otherwise it's an invisible
    // anchor so playCardToTalon still has somewhere to fly cards to (e.g. when a
    // telon graphic provides the visible pile instead).
    if (layout.talon_base) {
      const tb = layout.talon_base;
      const td = layout.talon_deck || {};
      const hasMarker = this.textures.exists('talon_base');
      const hasTelon = !!(layout.telon && this.textures.exists('telon'));
      // Landing scale = the stock/waste card scale so played cards match the deck
      // (not the larger talon_base marker scale, which made a big card).
      const landScale = hasMarker ? (tb.scale || this.getTalonScale())
                                  : (td.scale || tb.scale || this.getCardScale());
      this.talon_base = this.add.image(tb.x, tb.y, hasMarker ? 'talon_base' : 'card_back')
        .setScale(landScale)
        .setDepth(tb.depth || 1);
      // With the brown board off and no telon pile, show a plain CARD-BACK base slot
      // (the "base card") that played/drawn cards land on. The marker art is used if
      // supplied; a telon graphic still takes over as the pile (base stays hidden).
      // When base graphics are off (engine builds), the base is a pure invisible
      // anchor — no card-back, no marker — so the talon is just the active card.
      const showBase = !this.talonBaseGraphicEnabled() ? false
                     : hasMarker ? !this.talonPanelEnabled()
                                 : (!this.talonPanelEnabled() && !hasTelon);
      this.talon_base.setVisible(showBase);
      if (!showBase) this.talon_base.setActive(false).setAlpha(0);
      this.cardsContainer.add(this.talon_base);
    }

    // Panel behind the stock + waste so the talon cards stand out from the bg
    this.drawTalonPanel(layout);
    // Create talon deck (stock pile) if talon_sequence is defined
    this.createTalonDeck(layout);
    // Scripted mode: seed a face-up starting card on the waste (talon_base)
    this.seedScriptedTalon(layout);
    // Trap cards: a tap-catcher over the talon head so tapping the head can cut ropes.
    this._createHeadTapZone(layout);
    // Variable-value "special" cards: glow + up/down arrow indicators
    this.setupSpecialCards(layout);
  }

  // ===========================================================================
  // SPECIAL (variable-value) CARDS — glow ring + up/down arrow + live number
  // ===========================================================================

  setupSpecialCards(layout) {
    const specials = (window.LEVEL_CONFIG || {}).special_cards || {};
    this._specialSuit = {};
    this._specials = {};   // key -> { cont, mask, beam }
    // Arrow overlays live in their own container ABOVE cardsContainer (which is
    // an identity transform at 0,0, so coordinates match). This keeps them above
    // cards even when a revealed card is bringToTop'd within cardsContainer.
    // Safe to sit on top: arrows only show while a card is uncovered (nothing
    // overlaps it). Identity transform also keeps the beam's geometry mask aligned.
    const overlay = this.specialOverlay ||
      (this.specialOverlay = this.add.container(0, 0).setDepth((this.cardsContainer.depth || 10) + 1));
    for (const key of Object.keys(specials)) {
      const sprite = this.cardSprites[key];
      if (!sprite) continue;
      // suit prefix from the card texture (e.g. 'heart_10' -> 'heart')
      this._specialSuit[key] = sprite.texture.key.replace(/_(?:\d+|[ajqk])(?:_\d+)?$/i, '');
      const up = specials[key].dir !== 'down';
      // On-theme: emerald (increment) / card-suit crimson (decrement).
      const col = up ? 0x2a9d46 : 0xc62a39;
      const cardW = sprite.width || 240;
      const gap = cardW * 0.30;

      // Three small chevrons in a horizontal row across the card's mid-section,
      // pointing toward the value's direction (up = increment, down = decrement).
      // Held in a container that follows the card; hidden until the card is
      // proven face-up by updateSpecialCardVisuals.
      const offsets = [-gap, 0, gap];   // x of each chevron in the row

      const cont = this.add.container(sprite.x, sprite.y).setVisible(false);
      overlay.add(cont);
      for (const dx of offsets) {
        const base = this.add.graphics();
        this.drawChevron(base, up, col, cardW);
        base.x = dx;
        cont.add(base);
      }

      // ONE light beam that sweeps across all three arrows in a single direction
      // (up for increment, down for decrement) and repeats. The beam is clipped
      // to the combined arrow silhouette so only the arrows glint as it passes.
      const maskG = this.add.graphics().setVisible(false);
      maskG.fillStyle(0xffffff, 1);
      for (const dx of offsets) {
        maskG.fillPoints(this.chevronPoints(up, cardW).map(p => ({ x: p.x + dx, y: p.y })), true);
      }
      overlay.add(maskG);
      const beam = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      beam.sweepT = 0;
      beam.setMask(maskG.createGeometryMask());
      overlay.add(beam);
      this.tweens.add({
        targets: beam, sweepT: { from: 0, to: 1 },
        ease: 'Sine.inOut', duration: 900, repeat: -1, repeatDelay: 750,
        onUpdate: () => this.drawClusterBeam(beam, up, cardW),
      });
      this._specials[key] = { cont, mask: maskG, beam };
    }
    this.updateSpecialCardVisuals();
  }

  // True if `key` is a variable-value (increment/decrement) special card.
  _isSpecial(key) {
    return !!((window.LEVEL_CONFIG || {}).special_cards || {})[key];
  }

  // Chevron outline points at the graphics' local origin (a "^" / "v" band with
  // a notch cut into the base). `up` flips between increment and decrement.
  chevronPoints(up, cardW) {
    const w = cardW * 0.115, d = cardW * 0.095;
    const tipY = up ? -d : d, botY = up ? d : -d;
    return [
      { x: 0, y: tipY }, { x: w, y: botY }, { x: w * 0.42, y: botY },
      { x: 0, y: 0 }, { x: -w * 0.42, y: botY }, { x: -w, y: botY },
    ];
  }

  // Redraw the single sweeping beam for the current sweepT. A horizontal bar
  // (spanning the whole row) travels in one direction and fades at the extremes;
  // clipping to the arrow silhouette turns it into a glint across the arrows.
  drawClusterBeam(g, up, cardW) {
    if (!g.visible) return;   // the looping tween keeps firing; skip hidden beams
    const t = g.sweepT;
    const f = Math.sin(Math.PI * t);   // 0 at both ends, 1 mid-sweep
    g.clear();
    if (f <= 0.02) return;
    const sweep = cardW * 0.18;
    const y = up ? sweep - t * 2 * sweep : -sweep + t * 2 * sweep;
    const hw = cardW * 0.48;
    g.fillStyle(0xfff6dd, 0.30 * f); g.fillRect(-hw, y - cardW * 0.06, hw * 2, cardW * 0.12);   // soft halo
    g.fillStyle(0xffffff, 0.85 * f); g.fillRect(-hw, y - cardW * 0.022, hw * 2, cardW * 0.044); // bright core
  }

  // Filled chevron with a thin dark outline for legibility over any card face.
  drawChevron(g, up, color, cardW) {
    const pts = this.chevronPoints(up, cardW);
    g.fillStyle(color, 1);
    g.fillPoints(pts, true);
    g.lineStyle(Math.max(1.5, cardW * 0.01), up ? 0x0d3d10 : 0x4d0f0a, 1);
    g.strokePoints(pts, true);
  }

  updateSpecialCardVisuals() {
    const specials = (window.LEVEL_CONFIG || {}).special_cards || {};
    const vals = this.gameState ? this.gameState.specialValues : null;
    if (!vals || !this._specialSuit) return;
    const TOK = { 1: 'a', 11: 'j', 12: 'q', 13: 'k' };
    for (const key of Object.keys(specials)) {
      const sprite = this.cardSprites[key];
      if (!sprite) continue;
      const removed = this.removedCards && this.removedCards.has(key);
      const uncovered = this.uncoveredCards && this.uncoveredCards.has(key);
      // live number: swap the face texture to the current value (while on board)
      if (!removed) {
        const v = vals[key];
        const tex = `${this._specialSuit[key]}_${TOK[v] || v}`;
        if (this.textures.exists(tex) && sprite.texture.key !== tex) sprite.setTexture(tex);
      }
      // Arrows + beam show only while the card is uncovered (face-up), still on
      // board, and not mid-play (playedCards is set the instant a card is tapped,
      // before it flies to the talon, so the overlay drops immediately).
      const played = this.playedCards && this.playedCards.has(key);
      const show = uncovered && !removed && !played;
      const s = this._specials[key];
      if (!s) continue;
      for (const o of [s.cont, s.mask, s.beam]) {
        o.setPosition(sprite.x, sprite.y);
        o.setRotation(sprite.rotation || 0);
        o.setScale(sprite.scaleX, sprite.scaleY);
      }
      s.cont.setVisible(show);
      s.beam.setVisible(show);
    }
  }

  // Talon panel is on by default; a level opts out with `talon_panel: false`.
  // Single source of truth for both the panel and the (suppressed) talon_base marker.
  talonPanelEnabled() {
    return (window.LEVEL_CONFIG || {}).talon_panel !== false;
  }

  // Whether any base graphic is drawn behind the waste/active card (the telon
  // pile graphic + the talon_base card-back slot). Engine builds set
  // `talon_base_graphic: false` so the talon is JUST the active card, like the
  // Wags ads. Default on so one-ring playables are unchanged.
  talonBaseGraphicEnabled() {
    return (window.LEVEL_CONFIG || {}).talon_base_graphic !== false;
  }

  // Rounded panel behind the stock+waste row (config: talon_panel). Sits below
  // the cards (depth 9) and above the themed background (depth 0).
  drawTalonPanel(layout) {
    if (!this.talonPanelEnabled() || !layout.talon_base) return;
    const b = layout.talon_base, dk = layout.talon_deck;
    // Size to the actual talon CARD scale (talon_deck), not the decorative
    // talon_base scale. They match in portrait, but in landscape talon_base is
    // large (1.1) while the cards are small (0.5) — using b.scale there balloons
    // the panel up into the play area instead of framing the talon row.
    const sc = (dk && dk.scale) || b.scale || this.getCardScale();
    const xs = dk ? [b.x, dk.x] : [b.x];
    const left = Math.min(...xs) - 230 * sc, right = Math.max(...xs) + 230 * sc;
    const top = b.y - 320 * sc, h = 640 * sc;
    if (!this.talonPanel) this.talonPanel = this.add.graphics().setDepth(9);
    const g = this.talonPanel; g.clear();
    const w = right - left, r = 46;
    g.fillStyle(0x000000, 0.22); g.fillRoundedRect(left + 6, top + 8, w, h, r); // soft drop shadow
    g.fillStyle(0xf4d9a1, 0.65); g.fillRoundedRect(left, top, w, h, r);          // sandy gold panel (was royal brown)
    g.lineStyle(8, 0xe89f8e, 0.85); g.strokeRoundedRect(left, top, w, h, r);     // coral frame (was royal gold)
  }

  // Seed a face-up starting card on the waste pile for scripted levels.
  // Configured via game_flow.talon_start (a card face). Dependency-mode levels
  // seed their own waste card from talon_sequence, so skip them.
  seedScriptedTalon(layout) {
    const gameFlow = (window.LEVEL_CONFIG || {}).game_flow || {};
    const startFace = gameFlow.talon_start;
    if (!startFace || !layout.talon_base) return;
    if ((gameFlow.talon_sequence || []).length) return;
    const texKey = this.resolveTextureKey(startFace);
    if (!this.textures.exists(texKey)) return;
    const tb = layout.talon_base;
    const seed = this.add.image(tb.x, tb.y, texKey)
      .setScale(this.getCardScale())
      .setDepth((tb.depth || 1) + 1);
    this.cardsContainer.add(seed);
    this.startingTalonCard = seed;
    this.headSprite = seed;
    this.wasteSprites = [seed];
    this.currentTopCard = startFace;
  }

  // ===========================================================================
  // TALON DECK (Stock Pile on LEFT, Current Card on RIGHT)
  // ===========================================================================

  createTalonDeck(layout) {
    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};
    const talonSeq = gameFlow.talon_sequence || [];
    if (!talonSeq.length || !layout.talon_deck) return;

    const deckPos = layout.talon_deck;   // LEFT — stock pile
    const basePos = layout.talon_base;   // RIGHT — current card sits here
    const baseDepth = deckPos.depth || 61;
    this.talonDeckCards = [...talonSeq];
    // Last card in sequence is initially face-up; rest are stock
    this.talonCurrentIndex = talonSeq.length - 2; // next card to flip (2nd from end)

    // Stock pile visual: card_backs spread left-to-right
    // Index 0 = leftmost (last remaining), highest index = rightmost (next to flip)
    this.talonStockSpacing = 12;
    if (this.textures.exists('card_back')) {
      const numBacks = Math.min(talonSeq.length - 1, 5);
      for (let i = 0; i < numBacks; i++) {
        const back = this.add.image(deckPos.x + i * this.talonStockSpacing, deckPos.y, 'card_back')
          .setScale(deckPos.scale || this.getCardScale())
          .setDepth(baseDepth + i);
        this.applyCardShadow(back);
        this.cardsContainer.add(back);
        this.talonStockBacks.push(back);
      }
      // Make the top stock card_back interactive
      if (this.talonStockBacks.length > 0) {
        const topBack = this.talonStockBacks[this.talonStockBacks.length - 1];
        topBack.setInteractive();
        topBack.on('pointerdown', () => this.onStockTapped());
      }
    }

    // Create face sprites for all talon cards (hidden until needed)
    talonSeq.forEach((key, i) => {
      const texKey = this.resolveTextureKey(key);
      if (!this.textures.exists(texKey)) return;

      const isInitialTop = (i === talonSeq.length - 1);
      const card = this.add.image(
        isInitialTop ? basePos.x : deckPos.x,
        isInitialTop ? basePos.y : deckPos.y,
        texKey
      )
        .setScale(deckPos.scale || this.getCardScale())
        // Initial waste card sits strictly BELOW every played/flipped card
        // (which start at basePos.depth+1) so it never z-fights / shows through.
        .setDepth(isInitialTop ? (basePos.depth || 60) : baseDepth)
        .setVisible(isInitialTop);
      this.talonDeckSprites[key] = card;
      this.cardsContainer.add(card);
    });

    // Set initial top card (last in sequence)
    const topKey = talonSeq[talonSeq.length - 1];
    this.currentTopCard = topKey;
    this.currentTopRank = this.getRankValue(topKey);
    this.headSprite = this.talonDeckSprites[topKey] || null;  // the visible head card
    this.wasteSprites = this.headSprite ? [this.headSprite] : [];  // waste pile sprites, top last
  }

  // ---------------------------------------------------------------------------
  // Rank utilities for ±1 matching
  // ---------------------------------------------------------------------------

  getRankValue(cardKey) {
    return GameState.parseRank(window.LEVEL_CONFIG, cardKey);
  }

  isRankMatch(cardKey) {
    if (this.currentTopRank <= 0) return true; // no top card yet
    const rank = this.getRankValue(cardKey);
    if (rank <= 0) return false;
    const diff = Math.abs(rank - this.currentTopRank);
    return diff === 1 || diff === 12; // ±1, with K↔A wrapping
  }

  recalculatePlayable() {
    this.playableCards = new Set();
    for (const key of this.uncoveredCards) {
      if (this.isRankMatch(key)) {
        this.playableCards.add(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stock tap — flip next card from stock to current position
  // ---------------------------------------------------------------------------

  onStockTapped() {
    if (this._maybeCtaRedirect()) return;
    if (this.isAnimating) return;
    if (this.talonCurrentIndex < 0) return; // stock exhausted

    this._markChallengeStarted();

    this.hideHandPointer();
    this.moveCount++;
    this.isAnimating = true;

    const key = this.talonDeckCards[this.talonCurrentIndex];
    const card = this.talonDeckSprites[key];
    if (!card) { this.isAnimating = false; return; }

    // Simultaneous flip + move animation
    const layout = this.selectLayout();
    const basePos = layout.talon_base;
    const deckPos = layout.talon_deck;
    const cardScale = deckPos.scale || this.getCardScale();
    const moveDuration = 350;

    // Position the face card at the top stock back location
    const startX = deckPos.x + (this.talonStockBacks.length - 1) * (this.talonStockSpacing || 12);
    card.setPosition(startX, deckPos.y);
    card.setVisible(false);
    card.setScale(cardScale);
    this.cardsContainer.bringToTop(card);

    // Get the top card_back sprite for the flip
    const topBack = this.talonStockBacks.length > 0
      ? this.talonStockBacks[this.talonStockBacks.length - 1]
      : null;

    const onMoveComplete = () => {
      card.setDepth((basePos.depth || 60) + this.playedCardDepth);
      this.playedCardDepth++;
      this.headSprite = card;   // the flipped stock card is now the visible head
      (this.wasteSprites = this.wasteSprites || []).push(card);

      if (this.gameState) {
        this.gameState.applyStockTap();
        this._syncFromGameState();
      } else {
        this.currentTopCard = key;
        this.currentTopRank = this.getRankValue(key);
        this.talonCurrentIndex--;
        this.recalculatePlayable();
      }

      this.isAnimating = false;

      if (this._deadBoard()) {
        this._endIfDead(1500);   // re-verified at fire time
      } else {
        this.startHandPointerTimer();
      }
    };

    if (topBack) {
      // First half of move: card_back compresses to 0 while moving halfway
      this.tweens.add({
        targets: topBack,
        scaleX: 0,
        x: startX + (basePos.x - startX) * 0.5,
        y: deckPos.y + (basePos.y - deckPos.y) * 0.5,
        duration: moveDuration / 2,
        ease: 'Linear',
        onComplete: () => {
          // Deplete a back only when the visible stack should shrink; keep a
          // tappable top back while stock cards remain (the stock can be deeper
          // than the 5-back visual — otherwise the player gets stuck mid-stock
          // and the dead-board / Try Again never triggers).
          if (this.talonStockBacks.length > Math.min(this.talonCurrentIndex, 5)) {
            topBack.destroy();
            this.talonStockBacks.pop();
            if (this.talonStockBacks.length > 0) {
              const newTop = this.talonStockBacks[this.talonStockBacks.length - 1];
              newTop.setInteractive();
              newTop.off('pointerdown');
              newTop.on('pointerdown', () => this.onStockTapped());
            }
          } else {
            // Reuse this same back for the next flip — undo its flip animation.
            topBack.setScale(deckPos.scale || this.getCardScale());
            topBack.setPosition(startX, deckPos.y);
          }

          // Show face card at midpoint, compressed
          const midX = startX + (basePos.x - startX) * 0.5;
          const midY = deckPos.y + (basePos.y - deckPos.y) * 0.5;
          card.setPosition(midX, midY);
          card.setVisible(true);
          card.setScale(0, cardScale);

          // Second half: face expands while moving to destination
          this.tweens.add({
            targets: card,
            scaleX: cardScale,
            x: basePos.x,
            y: basePos.y,
            duration: moveDuration / 2,
            ease: 'Linear',
            onComplete: onMoveComplete
          });
        }
      });
    } else {
      // No card_back — just move directly
      card.setVisible(true);
      this.tweens.add({
        targets: card,
        x: basePos.x,
        y: basePos.y,
        duration: moveDuration,
        ease: 'Power2',
        onComplete: onMoveComplete
      });
    }

  }

  resolveTextureKey(spriteKey) {
    // Look up texture from sprite config (card_mapping.yaml sprites section)
    const config = window.LEVEL_CONFIG;
    const sprites = config.sprites || {};
    if (sprites[spriteKey] && sprites[spriteKey].texture) {
      return sprites[spriteKey].texture;
    }
    // Strip duplicate-marker suffix (suit_rank_<n> -> suit_rank).
    // Only when the key has 3 underscore-separated parts AND the trailing
    // part is purely numeric — otherwise we'd corrupt ranks like clubs_2.
    const parts = spriteKey.split('_');
    if (parts.length === 3 && /^\d+$/.test(parts[2])) {
      const stripped = `${parts[0]}_${parts[1]}`;
      if (this.textures.exists(stripped)) return stripped;
    }
    // Fallback: strip _d/_t suffix
    const fallback = spriteKey.replace(/_[dt]$/, '');
    if (fallback !== spriteKey) {
      console.warn(`resolveTextureKey: no sprite config for '${spriteKey}', falling back to '${fallback}'`);
    }
    return fallback;
  }

  // ===========================================================================
  // ICONS
  // ===========================================================================

  _iconDx(cardX, absDx) {
    const mid = this.scale.width / 2;
    return cardX < mid ? -Math.abs(absDx) : Math.abs(absDx);
  }

  _rotateOffset(dx, dy, r) {
    if (!r) return { dx, dy };
    const cos = Math.cos(r), sin = Math.sin(r);
    return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
  }

  createIcons(layout) {
    const config = window.LEVEL_CONFIG;
    const iconMapping = config.icon_positions || {};
    const mapping = iconMapping.mapping || {};

    this.iconSprites = {};

    Object.keys(mapping).forEach(iconKey => {
      const iconInfo = mapping[iconKey];
      const textureKey = iconInfo.texture || iconKey;
      if (!this.textures.exists(textureKey)) return;

      const cardKey = iconInfo.card;
      const cardPos = layout[cardKey];
      if (!cardPos) return;

      // Compute icon position from card + offset
      const isLandscape = this.scale.width > this.scale.height;
      const offsets = isLandscape ? iconInfo.landscape : iconInfo.portrait;
      if (!offsets) return;

      const { dx, dy } = this._rotateOffset(
        this._iconDx(cardPos.x, offsets.dx || 0),
        offsets.dy || 0,
        cardPos.r,
      );
      const x = cardPos.x + dx;
      const y = cardPos.y + dy;

      const sprite = this.add.image(x, y, textureKey)
        .setScale(this.getIconScale())
        .setDepth(20)
        .setAlpha(0); // Hidden initially

      this.iconSprites[iconKey] = sprite;
      this[iconKey] = sprite;
      this.iconContainer.add(sprite);
    });

    // Also handle icons with explicit positions in layout
    const iconKeys = Object.keys(layout).filter(k => k.startsWith('icon_'));
    iconKeys.forEach(key => {
      if (this.iconSprites[key]) return; // Already created
      if (!this.textures.exists(key)) return;

      const pos = layout[key];
      const sprite = this.add.image(pos.x, pos.y, key)
        .setScale(pos.scale || this.getIconScale())
        .setDepth(pos.depth || 20)
        .setAlpha(0);

      this.iconSprites[key] = sprite;
      this[key] = sprite;
      this.iconContainer.add(sprite);
    });
  }

  // ===========================================================================
  // HAND POINTER
  // ===========================================================================

  createHandPointer(layout) {
    if (!this.textures.exists('hand_000')) return;

    const handLayout = layout.hand || {};
    this.handSprite = this.add.sprite(0, 0, 'hand_000')
      .setOrigin(0.3, 0.0)
      .setScale(handLayout.scale || 0.7)
      .setDepth(200)
      .setVisible(false);

    // Create hand animation from frames if available
    const handFrames = [];
    for (let i = 0; i <= 10; i++) {
      const key = `hand_${String(i).padStart(3, '0')}`;
      if (this.textures.exists(key)) {
        handFrames.push({ key });
      }
    }
    if (handFrames.length > 1) {
      this.anims.create({
        key: 'hand_animation',
        frames: handFrames,
        frameRate: 12,
        repeat: -1,
      });
    }

    this.handPointerTimer = null;
  }

  startHandPointerTimer() {
    if (this.handPointerTimer) this.handPointerTimer.remove();

    this.handPointerTimer = this.time.delayedCall(3000, () => {
      this.showHandPointer();
    });
  }

  showHandPointer() {
    if (!this.handSprite) return;

    let tx, ty;
    if (this.playableCards.size > 0) {
      // Point at a playable (uncovered + rank-matching) card. Order the choices
      // so the hint guides the solvable line: non-special cards before the
      // variable-value (increment/decrement) cards — playing those early is
      // usually a trap — and left-to-right within each group.
      const cardKeys = Array.from(this.playableCards).sort((a, b) => {
        const sa = this._isSpecial(a) ? 1 : 0, sb = this._isSpecial(b) ? 1 : 0;
        if (sa !== sb) return sa - sb;
        return (this.cardSprites[a] ? this.cardSprites[a].x : 0) - (this.cardSprites[b] ? this.cardSprites[b].x : 0);
      });
      this.lastHintedCardIndex = (this.lastHintedCardIndex + 1) % cardKeys.length;
      const targetCard = this.cardSprites[cardKeys[this.lastHintedCardIndex]];
      if (!targetCard) return;
      tx = targetCard.x + 15; ty = targetCard.y - 40;
    } else if (this.talonCurrentIndex >= 0 && this.talonStockBacks && this.talonStockBacks.length) {
      // No valid match on the board — guide the player to flip the stock
      const top = this.talonStockBacks[this.talonStockBacks.length - 1];
      tx = top.x + 15; ty = top.y - 40;
    } else {
      return; // nothing to suggest
    }

    this.handSprite.setPosition(tx, ty);
    this.handSprite.setVisible(true);
    if (this.anims.exists('hand_animation')) {
      this.handSprite.play('hand_animation');
    }
  }

  hideHandPointer() {
    if (!this.handSprite) return;
    this.handSprite.setVisible(false);
    if (this.handSprite.anims) this.handSprite.anims.stop();
  }

  // Stop the idle hint entirely (used when the game is ending) so the hand
  // can't pop up over the cleared/empty talon during the end transition.
  cancelHint() {
    if (this.handPointerTimer) { this.handPointerTimer.remove(); this.handPointerTimer = null; }
    this.hideHandPointer();
  }

  // Funnel: once moveCount hits LEVEL_CONFIG.auto_end_moves, the next tap is the
  // CTA — it fires the store redirect (mraid.open via clickOut) instead of a
  // game move. Allowed because it's a genuine tap gesture. Returns true if it
  // redirected (caller should bail).
  _maybeCtaRedirect() {
    const thr = (window.LEVEL_CONFIG || {}).auto_end_moves || 0;
    if (thr > 0 && this.moveCount >= thr && !this._redirected) {
      this._redirected = true;
      this.cancelHint();
      this.clickOut();
      return true;
    }
    return false;
  }

  // ===========================================================================
  // DEAL ANIMATION
  // ===========================================================================

  animateCardsIn() {
    const config = window.LEVEL_CONFIG || {};
    const deal = config.deal || null;            // global default intro
    const introMap = config.intro || {};         // per-card overrides, keyed by card key
    const keys = Object.keys(this.cardSprites || {});

    // Default (no `deal`/`intro` config): legacy whole-container slide-in.
    // Keeps every existing build byte-identical.
    const hasIntro = !!(deal && deal.style) || keys.some(k => introMap[k]);
    if (!hasIntro) {
      this.cardsContainer.y = -1000;
      this.tweens.add({
        targets: this.cardsContainer,
        y: 0,
        duration: 600,
        ease: 'Power2',
        onComplete: () => {
          this.time.delayedCall(300, () => this.revealTalonCards());
        }
      });
      return;
    }

    // Per-card intro animations. Cards already sit at their rest positions
    // (createCards); we displace each to a start state and tween it back, then
    // hand off to revealTalonCards once the last card lands.
    const layout = this.selectLayout();
    const talon = layout.talon_deck || layout.talon_base ||
      { x: this.scale.width / 2, y: this.scale.height * 0.9 };
    const stagger = (deal && deal.stagger != null) ? deal.stagger : 60;

    // Deal in deal_order where available, else creation order, so staggering
    // matches the dependency reveal sequence.
    const dealOrder = (config.game_flow || {}).deal_order || [];
    let ordered = dealOrder.filter(k => this.cardSprites[k])
      .concat(keys.filter(k => !dealOrder.includes(k)));
    // "Drop from top — one by one": deal strictly top-to-bottom by board position,
    // so the topmost card lands first and the rest follow down the board.
    if (deal && deal.style === 'drop_top') {
      ordered = ordered.slice().sort((a, b) => (this.cardSprites[a].y - this.cardSprites[b].y));
    }

    let maxEnd = 0;
    ordered.forEach((key, i) => {
      const card = this.cardSprites[key];
      if (!card) return;
      const overlay = this.cardBackOverlays.find(o => o.getData('cardKey') === key);
      const spec = Object.assign({}, deal || {}, introMap[key] || {});
      const style = spec.style || 'fade';
      const delay = (spec.delay != null) ? spec.delay : i * stagger;
      const duration = spec.duration || 450;
      maxEnd = Math.max(maxEnd, delay + duration);
      this.playCardIntro(style, spec, card, overlay, talon, delay, duration);
    });

    this.time.delayedCall(maxEnd + 250, () => {
      // Restore proper z-order after per-card intros (deal_curve brings cards to
      // top mid-flight) so every back sits above its own face before the reveal.
      this.cardsContainer.sort('depth');
      this.revealTalonCards();
    });
  }

  // Animate a single card (and its face-down overlay) from a style-specific
  // start state to its rest position. Supported styles: deal_curve, fade,
  // slide, flip. The pair shares one rest transform, so most styles can tween
  // both sprites together.
  playCardIntro(style, spec, card, overlay, talon, delay, duration) {
    const sprites = [card, overlay].filter(Boolean);
    const restX = card.x, restY = card.y;
    const restSX = card.scaleX, restSY = card.scaleY;
    const restRot = card.rotation || 0;

    if (style === 'deal_curve') {
      // Fly from the talon/deck point along an arc up to the slot — the reverse
      // of playCardToTalon's path. Hidden until its delay so it doesn't sit on
      // the talon before launching.
      const curveHeight = spec.curve_height || 150;
      const srcX = talon.x, srcY = talon.y;
      sprites.forEach(s => s.setVisible(false));
      const path = new Phaser.Curves.Path(srcX, srcY);
      path.cubicBezierTo(
        restX, srcY,
        srcX + 0.25 * (restX - srcX), srcY - curveHeight,
        srcX + 0.75 * (restX - srcX), srcY - curveHeight
      );
      path.lineTo(restX, restY);
      const prog = { t: 0 };
      this.time.delayedCall(delay, () => {
        sprites.forEach(s => { s.setVisible(true); s.setPosition(srcX, srcY); s.setRotation(0); });
        if (this.cardsContainer) {
          this.cardsContainer.bringToTop(card);
          if (overlay) this.cardsContainer.bringToTop(overlay); // keep the back over the face
        }
        this.tweens.add({
          targets: prog, t: 1, duration, ease: 'Cubic.easeInOut',
          onUpdate: () => {
            const p = path.getPoint(prog.t);
            sprites.forEach(s => s.setPosition(p.x, p.y));
            card.rotation = restRot * prog.t;
            if (overlay) overlay.rotation = restRot * prog.t;
          },
          onComplete: () => sprites.forEach(s => { s.setPosition(restX, restY); s.setRotation(restRot); }),
        });
      });
      return;
    }

    if (style === 'slide') {
      // Enter from an off-screen edge.
      const from = spec.from || 'top';
      const W = this.scale.width, H = this.scale.height;
      const off = { top: [0, -H], bottom: [0, H], left: [-W, 0], right: [W, 0] }[from] || [0, -H];
      sprites.forEach(s => s.setPosition(restX + off[0], restY + off[1]));
      this.tweens.add({
        targets: sprites, x: restX, y: restY, duration, delay, ease: 'Back.easeOut',
      });
      return;
    }

    if (style === 'flip') {
      // Flip-in at the slot (stays face-down; the face-up reveal is handled
      // later by revealTalonCards for initially-playable cards).
      sprites.forEach(s => s.scaleX = 0);
      this.tweens.add({
        targets: sprites, scaleX: restSX, duration, delay, ease: 'Sine.easeOut',
      });
      return;
    }

    if (style === 'drop_top') {
      // Each card slides straight down from above the screen into its slot, one by
      // one, and settles smoothly (no bounce/shake). Hidden until its delay so cards
      // don't sit stacked at the top before launching.
      const H = this.scale.height;
      const startY = -H * 0.18 - restY;   // start above the canvas top
      sprites.forEach(s => s.setVisible(false));
      this.time.delayedCall(delay, () => {
        sprites.forEach(s => { s.setVisible(true); s.setPosition(restX, startY); });
        this.tweens.add({
          targets: sprites, y: restY, duration, ease: 'Cubic.easeOut',
          onComplete: () => sprites.forEach(s => s.setPosition(restX, restY)),
        });
      });
      return;
    }

    // Default: fade + scale up in place.
    sprites.forEach(s => { s.setAlpha(0); s.setScale(restSX * 0.6, restSY * 0.6); });
    this.tweens.add({
      targets: sprites, alpha: 1, scaleX: restSX, scaleY: restSY,
      duration, delay, ease: 'Back.easeOut',
    });
  }

  // ===========================================================================
  // TALON REVEAL
  // ===========================================================================

  revealTalonCards() {
    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};
    const isDependencyMode = gameFlow.mode === 'dependency';

    this.activeFlow = null;
    this.flowStep = 0;
    this.playedCards = new Set();

    if (isDependencyMode) {
      // Dependency mode: reveal talon base, show icons, then flip initially-playable cards.
      // Only fade in a REAL marker — the invisible landing anchor stays hidden, and
      // nothing fades in when base graphics are off (Wags-style talon).
      if (this.talon_base && this.textures.exists('talon_base') && this.talonBaseGraphicEnabled()) {
        this.tweens.add({
          targets: this.talon_base,
          alpha: 1,
          duration: 300,
          delay: 500,
        });
      }

      // Phase 1: Show collectible icons on cards first
      const iconKeys = Object.keys(this.iconSprites || {});
      const iconDuration = this.hasCollectibles && iconKeys.length > 0
        ? 1000 + iconKeys.length * 100 + 300  // match showCardIcons timing + buffer
        : 0;

      if (this.hasCollectibles && iconKeys.length > 0) {
        this.showCardIcons();
      }

      // Phase 2: After icons are visible, flip initially-playable cards face-up
      const flipDelay = 800 + iconDuration;
      const playableKeys = gameFlow.initially_playable || [];
      playableKeys.forEach((cardKey, i) => {
        const card = this.cardSprites[cardKey];
        const overlay = this.cardBackOverlays.find(
          o => o.getData('cardKey') === cardKey
        );
        if (!card) return;

        const origScaleX = card.scaleX;
        const sprites = [card, overlay].filter(Boolean);

        this.tweens.add({
          targets: sprites,
          scaleX: 0,
          duration: 90,
          delay: flipDelay + i * 50,
          ease: 'Sine.easeIn',
          onComplete: () => {
            if (overlay) overlay.setVisible(false);
            this.tweens.add({
              targets: card,
              scaleX: origScaleX,
              duration: 90,
              ease: 'Sine.easeOut',
              onComplete: () => {
                this.revealTrapRope(cardKey);
                if (i === playableKeys.length - 1) {
                  this.enableInitialInteractions(true);
                }
              }
            });
          }
        });
      });
      return;
    }

    const revealOrder = gameFlow.initial_reveal || ['diamonds_4_t', 'spades_2_t', 'talon_base'];
    const delays = [500, 500, 1000];

    revealOrder.forEach((cardKey, i) => {
      const card = this[cardKey] || this.cardSprites[cardKey];
      const overlay = this.cardBackOverlays.find(
        o => o.getData('cardKey') === cardKey
      );
      if (!card) return;

      const origScaleX = card.scaleX;
      const sprites = [card, overlay].filter(Boolean);

      // Phase 1: squeeze to 0 (Wags Day Out flip feel)
      this.tweens.add({
        targets: sprites,
        scaleX: 0,
        duration: 90,
        delay: delays[i] || 500,
        ease: 'Sine.easeIn',
        onComplete: () => {
          if (overlay) overlay.setVisible(false);
          // Phase 2: expand back
          this.tweens.add({
            targets: card,
            scaleX: origScaleX,
            duration: 90,
            ease: 'Sine.easeOut',
            onComplete: () => {
              this.revealTrapRope(cardKey);
              if (i === revealOrder.length - 1) {
                this.enableInitialInteractions();
              }
            }
          });
        }
      });
    });
  }

  enableInitialInteractions(iconsAlreadyShown) {
    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};
    const isDependencyMode = gameFlow.mode === 'dependency';

    if (isDependencyMode) {
      // Create GameState for testable state management (if class is available)
      if (typeof GameState !== 'undefined') {
        this.gameState = new GameState(config);
        // Sync scene state from GameState
        this._syncFromGameState();
      } else {
        // Fallback: inline state management
        this.buildDependencyMaps(gameFlow);
        this.uncoveredCards = new Set(gameFlow.initially_playable || []);
        if (this.talonDeckCards.length > 0) {
          this.recalculatePlayable();
        } else {
          this.playableCards = new Set(this.uncoveredCards);
        }
      }

      // Show collectible icons on cards in dependency mode (skip if already shown)
      if (this.hasCollectibles && !iconsAlreadyShown) {
        this.showCardIcons();
      }
    } else {
      const entryCards = gameFlow.entry_cards || {};
      // Entry cards become playable
      this.playableCards = new Set(Object.values(entryCards));

      // Show icons for cards that have them
      this.showCardIcons();
    }

    // Obstacles tick from now on (not during the initial sync above).
    this._obstaclesReady = true;
    // Any Key card already revealed at the start auto-unlocks its lock.
    this.time.delayedCall(600, () => this.autoUnlockRevealedKeys());

    // Start hand pointer
    this.startHandPointerTimer();

    // Animate text in
    this.animateTextIn();
  }

  _syncFromGameState() {
    if (!this.gameState) return;
    this.dependencyMap = this.gameState.dependencyMap;
    this.reverseDepMap = this.gameState.reverseDepMap;
    this.removedCards = this.gameState.removedCards;
    this.uncoveredCards = this.gameState.uncoveredCards;
    this.playableCards = this.gameState.playableCards;
    this.currentTopCard = this.gameState.currentTopCard;
    this.currentTopRank = this.gameState.currentTopRank;
    this.talonCurrentIndex = this.gameState.talonCurrentIndex;
    this.updateSpecialCardVisuals();
    // Bombs tick once per real move; curtains/overlays update after the head changes.
    if (this._obstaclesReady) this.tickBombs();
    this.updateObstacleVisuals();
    this.updateMirrorCards();
    if (this._obstaclesReady) this.autoUnlockRevealedKeys();
  }

  // Decrement every live bomb counter by one; explode (lose) at zero.
  tickBombs() {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    const PEo = (window.PE || {}).obstacle; if (!PEo || !this.gameState) return;
    const S = this.gameState.obState(PEo);
    let lost = false;
    for (const [id, ob] of Object.entries(obstacles)) {
      if (ob.type !== 'BOMB_CARD' || this.removedCards.has(id)) continue;
      const def = PEo.OBSTACLES.BOMB_CARD;
      def.onMove(ob, id, S);
      const f = S.state[id + ':fuse'];
      const txt = this._bombTexts && this._bombTexts[id];
      if (txt) { txt.setText(String(Math.max(0, f))); if (f <= 3) txt.setColor('#ff5050'); }
      if (def.loses(ob, id, S)) lost = true;
    }
    if (lost && !this._ended) {
      this.cancelHint(); this.isAnimating = true;
      // Explosion: blow up the bomb art + counter, then lose.
      for (const [id, ob] of Object.entries(obstacles)) {
        if (ob.type !== 'BOMB_CARD' || this.removedCards.has(id)) continue;
        const ov = this._obstacleOverlays && this._obstacleOverlays[id];
        if (ov) this.tweens.add({ targets: ov, scale: ov.scaleX * 2.4, alpha: 0, angle: 25, duration: 600, ease: 'Quad.easeIn' });
        const t = this._bombTexts && this._bombTexts[id];
        if (t) this.tweens.add({ targets: t, scale: (t.scale || 1) * 2, alpha: 0, duration: 600 });
      }
      this._forcedEnd = true;   // a bomb loss is a real end even if moves remain
      this.time.delayedCall(800, () => this.transitionToEndScene());
    }
  }

  // Fade out an obstacle overlay once its card is unblocked (curtain lifted,
  // shield dropped) or the card has been removed.
  updateObstacleVisuals() {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    const PEo = (window.PE || {}).obstacle; if (!PEo || !this.gameState || !this._obstacleOverlays) return;
    const S = this.gameState.obState(PEo);
    for (const [id, ob] of Object.entries(obstacles)) {
      const ov = this._obstacleOverlays[id];
      if (!ov || !ov.visible) continue;
      const def = PEo.OBSTACLES[ob.type];
      const blocked = def && def.blocked && def.blocked(ob, id, S);
      const removed = this.removedCards.has(id);
      if (removed || (def && def.blocked && !blocked)) {
        this.tweens.add({ targets: ov, alpha: 0, scale: ov.scaleX * 1.15, duration: 350, ease: 'Sine.easeOut',
          onComplete: () => ov.setVisible(false) });
      }
    }
    if (this._bombTexts) {
      for (const [id, txt] of Object.entries(this._bombTexts)) {
        if (this.removedCards.has(id) && txt.visible) txt.setVisible(false);
      }
    }
  }

  // Hook for cross-card obstacle reactions (kept for future obstacles).
  onObstacleCardPlayed(playedKey) {}

  // ===========================================================================
  // TRAP (ROPE) CARDS
  // ===========================================================================
  // An invisible tap-catcher over the talon head. Only created when the level has
  // trap cards; tapping it sends the head to a freeable trap to cut its rope.
  _createHeadTapZone(layout) {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    const hasHeadTapOb = Object.values(obstacles).some(o => o && (o.type === 'TRAP_CARD' || o.type === 'COLOR_CARD' || o.type === 'COLOR_SUIT_CARD'));
    if (!hasHeadTapOb) return;
    const tb = layout.talon_base; if (!tb) return;
    const headSp = (this.talonDeckSprites && this.talonDeckSprites[this.currentTopCard]) || this.startingTalonCard;
    const w = headSp ? headSp.displayWidth * 1.2 : 200;
    const h = headSp ? headSp.displayHeight * 1.2 : 280;
    const zone = this.add.zone(tb.x, tb.y, w, h).setInteractive({ useHandCursor: true });
    zone.setDepth(99990);
    this.cardsContainer.add(zone);
    zone.on('pointerdown', () => this.onHeadTapped());
    this._headTapZone = zone;
  }

  // Reveal a trap rope / mirror frame / colour curtain the moment the card flips up.
  revealTrapRope(cardKey) {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    const ob = obstacles[cardKey];
    if (!ob || (ob.type !== 'TRAP_CARD' && ob.type !== 'MIRROR_CARD' && ob.type !== 'COLOR_CARD' && ob.type !== 'COLOR_SUIT_CARD')) return;
    const ov = this._obstacleOverlays && this._obstacleOverlays[cardKey];
    if (!ov || ov.visible) return;
    const card = this.cardSprites[cardKey];
    if (card) { this.cardsContainer.bringToTop(card); }
    this.cardsContainer.bringToTop(ov);
    // The mirror glass is semi-transparent so the reflected value reads through it.
    const targetAlpha = ob.type === 'MIRROR_CARD' ? 0.55 : 1;
    ov.setAlpha(0).setVisible(true);
    this.tweens.add({ targets: ov, alpha: targetAlpha, duration: 160, ease: 'Sine.easeOut' });
    if (ob.type === 'MIRROR_CARD') {
      // Reveal the gold frame above the glass, then start reflecting the head value.
      const fr = this._mirrorFrames && this._mirrorFrames[cardKey];
      if (fr) { this.cardsContainer.bringToTop(fr); fr.setAlpha(0).setVisible(true); this.tweens.add({ targets: fr, alpha: 1, duration: 160, ease: 'Sine.easeOut' }); }
      this.updateMirrorCards();
    } else if (ob.type === 'COLOR_CARD' || ob.type === 'COLOR_SUIT_CARD') {
      // Drop the roller bar in above the cloth.
      const roller = this._curtainRollers && this._curtainRollers[cardKey];
      if (roller) { this.cardsContainer.bringToTop(roller); roller.setAlpha(0).setVisible(true); this.tweens.add({ targets: roller, alpha: 1, duration: 160, ease: 'Sine.easeOut' }); }
    }
  }

  // Mirror cards display the CURRENT head card's value, re-syncing whenever the
  // head changes (with a short sheen). They keep the glass frame overlay on top.
  updateMirrorCards() {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    let headTex = null;
    if (this.headSprite && this.headSprite.scene) headTex = this.headSprite.texture.key;
    else if (this.currentTopCard) headTex = this.resolveTextureKey(this.currentTopCard);
    if (!headTex || !this.textures.exists(headTex)) return;
    for (const [id, ob] of Object.entries(obstacles)) {
      if (!ob || ob.type !== 'MIRROR_CARD') continue;
      if (this.removedCards && this.removedCards.has(id)) continue;
      if (this._brokenMirrors && this._brokenMirrors.has(id)) continue;  // frozen — no resync
      const card = this.cardSprites[id];
      if (!card) continue;
      // Skip while still face-down (its frame is hidden until flipped).
      const back = this.cardBackOverlays.find(o => o.getData('cardKey') === id);
      if (back && back.visible) continue;
      if (card.texture.key === headTex) continue;   // already reflecting this value
      const dw = card.displayWidth, dh = card.displayHeight;
      card.setTexture(headTex); card.setDisplaySize(dw, dh);
      const fr = this._mirrorFrames && this._mirrorFrames[id];
      if (fr) this.cardsContainer.bringToTop(fr);
      this._mirrorSheen(card, id);
    }
  }

  // A quick sheen glint when a mirror updates its reflected value. The card itself
  // is NOT scaled/popped — only the glass glints, so the card size stays constant.
  _mirrorSheen(card, id) {
    const ov = this._obstacleOverlays && this._obstacleOverlays[id];
    if (ov) this.tweens.add({ targets: ov, alpha: { from: 0.35, to: 0.6 }, duration: 200 });
    if (this.textures.exists('oba_MIRROR_CARD_sheen')) {
      const sh = this.add.image(card.x, card.y, 'oba_MIRROR_CARD_sheen')
        .setDepth(card.depth + 0.8).setAlpha(0).setScale(card.scaleX);
      this.cardsContainer.add(sh);
      this.tweens.add({ targets: sh, alpha: { from: 0.85, to: 0 }, angle: 18, duration: 320, onComplete: () => sh.destroy() });
    }
  }

  // First tap on a mirror: BREAK it. The gold frame + glass vanish with a little
  // glow and the card freezes at the value it was reflecting, becoming a normal
  // card (now playable on the ±1 rule — a second tap plays it).
  breakMirror(key) {
    this._brokenMirrors = this._brokenMirrors || new Set();
    if (this._brokenMirrors.has(key)) return;
    this._brokenMirrors.add(key);
    this.playSound('valid_card');
    const card = this.cardSprites[key];
    const glass = this._obstacleOverlays && this._obstacleOverlays[key];
    const frame = this._mirrorFrames && this._mirrorFrames[key];
    // Detach overlays BEFORE the state sync so they aren't double-faded.
    if (this._obstacleOverlays) delete this._obstacleOverlays[key];
    if (this._mirrorFrames) delete this._mirrorFrames[key];
    // Freeze the reflected value + unblock the card in state.
    if (this.gameState && this.gameState.unlockMirror) { this.gameState.unlockMirror(key); this._syncFromGameState(); }
    // A little glow + pop on the freed card.
    if (card) {
      if (this.textures.exists('oba_MIRROR_CARD_sheen')) {
        const g = this.add.image(card.x, card.y, 'oba_MIRROR_CARD_sheen')
          .setDepth(card.depth + 1).setAlpha(0).setScale(card.scaleX * 0.9);
        this.cardsContainer.add(g);
        this.tweens.add({ targets: g, alpha: { from: 0.95, to: 0 }, scale: card.scaleX * 1.7, duration: 380, onComplete: () => g.destroy() });
      }
      const s = card.scaleX, sy = card.scaleY;
      this.tweens.add({ targets: card, scaleX: s * 1.12, scaleY: sy * 1.12, duration: 140, yoyo: true });
    }
    // The frame + glass shatter outward and fade.
    [glass, frame].forEach((ov, i) => {
      if (!ov) return;
      this.tweens.add({
        targets: ov, alpha: 0, scaleX: ov.scaleX * (1.25 + i * 0.1), scaleY: ov.scaleY * (1.25 + i * 0.1),
        angle: (ov.angle || 0) + (i ? 10 : -10), duration: 300, ease: 'Sine.easeOut',
        onComplete: () => ov.destroy(),
      });
    });
    // The card is now a plain ±1 card. If breaking it leaves no move on the board,
    // end the game (e.g. its frozen value isn't ±1 of the head and nothing else plays).
    if (this._deadBoard()) this._endIfDead(1300);
  }

  // Tap on the talon head: if the head is ±1 of an uncovered trap, send the head
  // to that trap and cut its rope (the head frees the trap — the trap is never tapped).
  onHeadTapped() {
    if (this.isAnimating || this._ended) return;
    if (this._maybeCtaRedirect && this._maybeCtaRedirect()) return;
    if (!this.gameState) return;
    // Candidates the head can act on: freeable traps and liftable colour curtains.
    const traps = (this.gameState.freeableTraps ? this.gameState.freeableTraps() : []).map(id => ({ id, kind: 'trap' }));
    const curtains = (this.gameState.liftableCurtains ? this.gameState.liftableCurtains() : []).map(id => ({ id, kind: 'curtain' }));
    const all = traps.concat(curtains);
    if (!all.length) {
      // Nothing the head can cut (e.g. a black curtain with a red head). If that
      // leaves no move anywhere, this is a dead board — end the game.
      if (this._deadBoard()) this._endIfDead(700);
      return;
    }
    // Act on the one nearest the talon.
    const headPos = this._talonBasePos();
    let best = all[0], bestD = Infinity;
    all.forEach(c => {
      const sp = this.cardSprites[c.id];
      if (!sp) return;
      const d = (sp.x - headPos.x) ** 2 + (sp.y - headPos.y) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    });
    if (best.kind === 'trap') this.cutTrapRope(best.id);
    else this.liftCurtain(best.id);
  }

  _talonBasePos() {
    const layout = this.selectLayout();
    const tb = layout.talon_base || {};
    return { x: tb.x != null ? tb.x : (this.scale.width / 2), y: tb.y != null ? tb.y : (this.scale.height * 0.8) };
  }

  // No moves left? Delegates to GameState (which also counts a cuttable trap rope,
  // a breakable mirror and a liftable curtain as remaining moves).
  _deadBoard() {
    if (this.gameState && this.gameState.isDeadBoard) return this.gameState.isDeadBoard();
    return this.playableCards.size === 0 && this.talonCurrentIndex < 0;
  }

  // Schedule a dead-board (lose) end — but RE-VERIFY at fire time so it never ends
  // while a valid move still exists. It waits for any in-flight animation to settle
  // (e.g. the head consuming an obstacle + the next stock card being revealed), then
  // only ends if the board is still genuinely dead; otherwise play simply continues.
  _endIfDead(delay) {
    if (this._ended || this._deadEndPending) return;
    this._deadEndPending = true;
    this.cancelHint();
    const check = () => {
      if (this._ended) { this._deadEndPending = false; return; }
      if (this.isAnimating) { this.time.delayedCall(250, check); return; }  // let the board settle
      this._deadEndPending = false;
      if (this._deadBoard()) this.transitionToEndScene();
      else this.startHandPointerTimer();   // a move exists after all — keep playing
    };
    this.time.delayedCall(delay || 1200, check);
  }

  // Shared "head flies to an obstacle and cuts it open" flow used by both the trap
  // rope and the colour curtain. The REAL head card spins/arcs to the target (full
  // size, no shrink), runs the obstacle-specific cut visual, frees the card in state,
  // then stays at the target and fades — it does NOT return to the talon. The head is
  // CONSUMED: the next stock card becomes the new head (or the head is cleared if the
  // stock is empty), so the freed card only plays when a fresh ±1 head is present.
  _headCutObstacle(id, doVisual, freeFn) {
    const target = this.cardSprites[id];
    if (!target) return;
    this._cutting = this._cutting || {};
    if (this._cutting[id]) return;
    this._cutting[id] = true;
    this.isAnimating = true;
    this.hideHandPointer();
    this.playSound('valid_card');

    const base = this._talonBasePos();
    let head = this.headSprite || (this.talonDeckSprites && this.talonDeckSprites[this.currentTopCard]) || this.startingTalonCard;
    let flyer = head, temp = false;
    if (!flyer || !flyer.scene) {
      const headFace = this.resolveTextureKey(this.currentTopCard);
      flyer = this.add.image(base.x, base.y, this.textures.exists(headFace) ? headFace : 'card_back').setScale(this.getCardScale());
      this.cardsContainer.add(flyer); temp = true;
    }
    flyer.setDepth(100000);
    this.cardsContainer.bringToTop(flyer);
    const sx = flyer.x, sy = flyer.y, tx = target.x, ty = target.y;
    const midX = (sx + tx) / 2, midY = Math.min(sy, ty) - 170;

    this.tweens.add({ targets: flyer, angle: 360, duration: 640, ease: 'Linear' });
    this.tweens.add({
      targets: flyer, x: midX, y: midY, duration: 320, ease: 'Quad.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: flyer, x: tx, y: ty, duration: 320, ease: 'Quad.easeIn',
          onComplete: () => {
            flyer.setAngle(0);
            doVisual(id);                 // obstacle-specific cut visual
            if (freeFn) freeFn(id);       // free the card in state
            const s = target.scaleX;
            this.tweens.add({ targets: target, scaleX: s * 1.12, scaleY: target.scaleY * 1.12, duration: 150, yoyo: true });
            this.tweens.add({
              targets: flyer, alpha: 0, scale: flyer.scaleX * 0.85, duration: 320, delay: 120, ease: 'Sine.easeIn',
              onComplete: () => {
                if (temp) flyer.destroy(); else flyer.setVisible(false);
                this._cutting[id] = false;
                this.isAnimating = false;
                // The head card left, so the card now on top of the waste becomes the
                // new head — and ±1 matching is checked against THAT head.
                if (!temp && this.wasteSprites && this.wasteSprites.length && this.wasteSprites[this.wasteSprites.length - 1] === flyer) {
                  this.wasteSprites.pop();
                }
                const prev = (this.wasteSprites && this.wasteSprites.length) ? this.wasteSprites[this.wasteSprites.length - 1] : null;
                this.headSprite = prev;
                if (prev) { prev.setVisible(true); this.cardsContainer.bringToTop(prev); }
                if (this.gameState && this.gameState.revertHead) { this.gameState.revertHead(); }
                this._syncFromGameState();
                if (this._deadBoard()) this._endIfDead(1200);
                else this.startHandPointerTimer();
              },
            });
          },
        });
      },
    });
  }

  // The head flies to the trap and snaps its rope into pieces (1.png).
  cutTrapRope(trapId) {
    this._headCutObstacle(trapId,
      (id) => this._snapTrapRope(id),
      (id) => { if (this.gameState && this.gameState.freeTrap) this.gameState.freeTrap(id); });
  }

  // The actual head card completely moves to the curtain and splits it open; the
  // head is CONSUMED (it does not return), so the next stock card becomes the new
  // talon head — exactly like the trap.
  liftCurtain(curtainId) {
    this._headCutObstacle(curtainId,
      (id) => this._splitCurtain(id),
      (id) => { if (this.gameState && this.gameState.liftCurtain) this.gameState.liftCurtain(id); });
  }

  // Open a colour curtain: hide the cloth, slide the two cut halves apart, lift the
  // roller bar away — revealing the card underneath.
  _splitCurtain(id) {
    const ob = ((window.LEVEL_CONFIG || {}).obstacles || {})[id] || {};
    const prefix = `oba_${ob.type || 'COLOR_CARD'}`;
    const card = this.cardSprites[id];
    const cloth = this._obstacleOverlays && this._obstacleOverlays[id];
    const roller = this._curtainRollers && this._curtainRollers[id];
    if (this._obstacleOverlays) delete this._obstacleOverlays[id];
    if (this._curtainRollers) delete this._curtainRollers[id];
    this.playSound('collectible_complete');
    const cw = card ? card.displayWidth : (cloth ? cloth.displayWidth : 100);
    const ch = card ? card.displayHeight : (cloth ? cloth.displayHeight : 140);
    const cx = cloth ? cloth.x : (card ? card.x : 0);   // halves appear where the cloth hangs
    const cy = cloth ? cloth.y : (card ? card.y : 0);
    const rot = (card ? card.rotation : (cloth ? cloth.rotation : 0)) || 0;
    const rcos = Math.cos(rot), rsin = Math.sin(rot);   // card's local "right" = (cos, sin)
    const depth = (card ? card.depth : 1) + 0.62;
    if (cloth) cloth.setVisible(false);
    const half = (tex, dir) => {
      if (!this.textures.exists(tex)) return;
      const off = dir * cw * 0.25, far = dir * cw * 0.95;   // slide along the card's local x-axis
      const h = this.add.image(cx + off * rcos, cy + off * rsin, tex).setDepth(depth);
      h.setDisplaySize(cw * 0.52, ch); h.setRotation(rot);
      this.cardsContainer.add(h);
      this.tweens.add({ targets: h, x: cx + far * rcos, y: cy + far * rsin, alpha: 0, angle: (rot * 180 / Math.PI) + dir * 8, duration: 440, ease: 'Quad.easeIn', onComplete: () => h.destroy() });
    };
    half(`${prefix}_left`, -1);
    half(`${prefix}_right`, 1);
    if (roller) this.tweens.add({ targets: roller, x: roller.x + rsin * ch * 0.5, y: roller.y - rcos * ch * 0.5, alpha: 0, duration: 380, ease: 'Quad.easeOut', onComplete: () => roller.destroy() });
    if (cloth) this.time.delayedCall(60, () => cloth.destroy());
  }

  // Snap the trap's rope into pieces: swap the rope overlay to the broken-rope
  // sheet (1.png), scatter it apart with a sparkle, then clear it.
  _snapTrapRope(trapId) {
    const trap = this.cardSprites[trapId];
    const ov = this._obstacleOverlays && this._obstacleOverlays[trapId];
    // Detach so the freed-card sync doesn't also try to fade it.
    if (this._obstacleOverlays) delete this._obstacleOverlays[trapId];
    this.playSound('collectible_complete');
    if (trap) this._sparkleBurst(trap.x, trap.y, trap.scaleX, 'oba_TRAP_CARD_star');
    if (!ov) return;
    this.cardsContainer.bringToTop(ov);
    if (this.textures.exists('oba_TRAP_CARD_broken')) {
      const dw = ov.displayWidth, dh = ov.displayHeight;
      ov.setTexture('oba_TRAP_CARD_broken'); ov.setDisplaySize(dw, dh);
    }
    // Pieces burst outward + fall away.
    this.tweens.add({
      targets: ov, alpha: 0, scaleX: ov.scaleX * 1.35, scaleY: ov.scaleY * 1.35,
      y: ov.y + 40, angle: (ov.angle || 0) + 12, duration: 380, ease: 'Quad.easeOut',
      onComplete: () => ov.setVisible(false),
    });
  }

  // Auto-unlock any Key card that is now uncovered (revealed) — no tap needed.
  // Covers the initial reveal (which doesn't go through flipCard).
  autoUnlockRevealedKeys() {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    for (const [keyId, ob] of Object.entries(obstacles)) {
      if (ob.type !== 'KEY') continue;
      const lockId = this._lockForKey(keyId);
      const card = this.cardSprites[keyId];
      if (!lockId || !card || card._keyUnlocking) continue;
      if (this.uncoveredCards && this.uncoveredCards.has(keyId)) {
        card._keyUnlocking = true;
        this.time.delayedCall(400, () => this.autoUnlockKey(keyId, lockId));
      }
    }
  }

  // Which lock (if any) this card is the key for.
  _lockForKey(key) {
    const obstacles = (window.LEVEL_CONFIG || {}).obstacles || {};
    for (const [id, ob] of Object.entries(obstacles)) {
      if (ob.type === 'LOCK_AND_KEY' && ob.key === key) return id;
    }
    return null;
  }

  // The Key card auto-flies to its Lock door (arc + spin), the door opens, a
  // sparkle bursts, and the cards behind the door are revealed. Modeled on the
  // reference unlockDoorWithKey (playable_2_long_level_door_unlock).
  autoUnlockKey(keyId, lockId) {
    const key = this.cardSprites[keyId];
    const lock = this.cardSprites[lockId];
    if (!key || !lock) return;
    this._unlocking = this._unlocking || {};
    if (this._unlocking[lockId]) return;
    this._unlocking[lockId] = true;
    this.isAnimating = true;
    this.playSound('valid_card');

    // Consume the key in state (uncover whatever it was covering).
    let underKey = [];
    if (this.gameState && this.gameState.forceRemoveKey) { underKey = this.gameState.forceRemoveKey(keyId) || []; this._syncFromGameState(); }
    this.cardsContainer.bringToTop(key); key.setDepth(100000); key.disableInteractive();
    const back = this.cardBackOverlays.find(o => o.getData('cardKey') === keyId);
    if (back) back.setVisible(false);
    // As the key lifts off, flip the cards it was sitting on top of.
    underKey.forEach((c, i) => this.flipCard(c, 150 + i * 120));

    const rest = key.scaleX;
    const doorX = lock.x, doorY = lock.y;
    // The key first arrives just beside the door, orients horizontal, then slides
    // into the keyhole (mirrors the reference key_target -> keyhole two-step).
    const sideX = doorX - lock.displayWidth * 0.42;
    const sideY = doorY;
    const arcH = lock.displayHeight * 0.9 + 60;
    const midX = (key.x + sideX) / 2;
    const midY = Math.min(key.y, sideY) - arcH;

    // Spin the key for the whole flight (like moveToTalon's 360° spin).
    this.tweens.add({ targets: key, angle: 360, duration: 600, ease: 'Linear' });

    // Leg 1: arc up to a midpoint.
    this.tweens.add({
      targets: key, x: midX, y: midY, duration: 300, ease: 'Quad.easeOut',
      onComplete: () => {
        // Leg 2: drop down beside the door, shrinking toward key size.
        this.tweens.add({
          targets: key, x: sideX, y: sideY, scaleX: rest * 0.55, scaleY: rest * 0.55,
          duration: 300, ease: 'Quad.easeIn',
          onComplete: () => {
            key.setAngle(0);
            // Drop the card body — show just the bare key, held horizontal.
            const kw = key.displayWidth, kh = key.displayHeight;
            if (this.textures.exists('oba_LOCK_AND_KEY_key')) { key.setTexture('oba_LOCK_AND_KEY_key'); key.setDisplaySize(kw, kh); }
            key.setAngle(-90);

            // Glow over the keyhole: low -> high -> out. The door only starts opening
            // once the glow has faded (so the keyhole never vanishes mid-frame).
            if (this.textures.exists('oba_LOCK_AND_KEY_glow')) {
              const g = this.add.image(doorX, doorY, 'oba_LOCK_AND_KEY_glow')
                .setDepth(100002).setAlpha(0.2).setScale(lock.scaleX * 1.1);
              this.cardsContainer.add(g);
              this.tweens.add({
                targets: g, alpha: 1, duration: 250, ease: 'Quad.easeOut',
                onComplete: () => this.tweens.add({
                  targets: g, alpha: 0, duration: 150, ease: 'Quad.easeIn',
                  onComplete: () => { g.destroy(); this._openDoorCard(lockId); },
                }),
              });
            } else {
              this.time.delayedCall(250, () => this._openDoorCard(lockId));
            }

            // In parallel: the key slides into the keyhole and fades out.
            this.tweens.add({
              targets: key, x: doorX, y: doorY, alpha: 0, duration: 250, ease: 'Quad.easeIn',
              onComplete: () => this.onKeyReachedLock(key, rest),
            });
          },
        });
      },
    });
  }

  // The key seats into the lock — a small push-in then a turn (the "unlock" click).
  onKeyReachedLock(key, rest) {
    this.tweens.add({
      targets: key, scaleX: rest * 0.42, scaleY: rest * 0.42, duration: 200, ease: 'Quad.easeIn',
      onComplete: () => {
        this.playSound('collectible_complete');
        this.tweens.add({
          targets: key, angle: -180, duration: 300, ease: 'Quad.easeInOut',
          onComplete: () => key.setVisible(false),
        });
      },
    });
  }

  // The card IS a pure door. Step it through the open frames (~1 per 100ms), burst
  // a shower of sparkles, then fade it away and reveal/flip the cards behind it.
  _openDoorCard(lockId) {
    const door = this.cardSprites[lockId];
    if (!door) return;
    // Keep a fixed on-screen size across texture swaps (frames may differ in px).
    const dw = door.displayWidth, dh = door.displayHeight;
    const frames = ['oba_LOCK_AND_KEY_open1', 'oba_LOCK_AND_KEY_open2', 'oba_LOCK_AND_KEY_open3']
      .filter(k => this.textures.exists(k));
    let i = 0;
    const step = () => {
      if (i < frames.length) {
        door.setTexture(frames[i]); door.setDisplaySize(dw, dh); i++;
        this.time.delayedCall(100, step);
      } else {
        // Sparkle burst at the keyhole, the open door fades away, behind is revealed.
        this._sparkleBurst(door.x, door.y, door.scaleX);
        if (door._shadow) this.tweens.add({ targets: door._shadow, alpha: 0, duration: 300 });
        this.tweens.add({
          targets: door, alpha: 0, scaleX: door.scaleX * 1.12, scaleY: door.scaleY * 1.12,
          duration: 300, ease: 'Sine.easeOut',
          onComplete: () => { door.setVisible(false); door.disableInteractive(); },
        });
        this._revealBehindLock(lockId);
      }
    };
    step();
  }

  // Scatter a shower of star sparkles outward from a point (reference createSparkleBurst).
  _sparkleBurst(x, y, scale, texKey) {
    const tex = texKey && this.textures.exists(texKey) ? texKey
      : (this.textures.exists('oba_LOCK_AND_KEY_star') ? 'oba_LOCK_AND_KEY_star' : null);
    if (!tex) return;
    const base = scale || 0.4;
    const n = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      this.time.delayedCall(Math.random() * 200, () => {
        const a = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 160;
        const st = this.add.image(x, y, tex).setDepth(100003).setScale(base * 0.6);
        this.cardsContainer.add(st);
        this.tweens.add({
          targets: st, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist,
          scale: base * (0.9 + Math.random() * 0.5), alpha: { from: 1, to: 0 },
          rotation: Math.random() * Math.PI * 2, duration: 700 + Math.random() * 400,
          ease: 'Power2.easeOut', onComplete: () => st.destroy(),
        });
      });
    }
  }

  _revealBehindLock(lockId) {
    // The door is a pure door (no card behind its face): remove it entirely and
    // reveal/flip the cards it was covering.
    if (this.gameState && this.gameState.forceRemoveKey) {
      const newly = this.gameState.forceRemoveKey(lockId);
      this._syncFromGameState();
      (newly || []).forEach((c, i) => this.flipCard(c, i * 120));
    }
    this.isAnimating = false;
  }

  animateTextIn() {
    const layout = this.selectLayout();
    const textKeys = Object.keys(layout).filter(k => k.startsWith('text_let'));
    const delays = [0, 200, 400, 600, 800];

    textKeys.forEach((key, i) => {
      if (this[key]) {
        this.tweens.add({
          targets: this[key],
          alpha: 1,
          duration: 400,
          delay: delays[i] || i * 200,
          ease: 'Power2',
        });
      }
    });
  }

  showCardIcons() {
    const hasCardDeal = this.cache.audio.exists('card_deal');
    Object.keys(this.iconSprites).forEach((key, i) => {
      const delay = 1000 + i * 100;
      this.tweens.add({
        targets: this.iconSprites[key],
        alpha: 1,
        duration: 300,
        delay,
        ease: 'Power2',
      });
      if (hasCardDeal) {
        this.time.delayedCall(delay, () => this.playSound('card_deal', { volume: 0.5 }));
      }
    });
  }

  // ===========================================================================
  // CARD TAP HANDLER
  // ===========================================================================

  onCardTapped(key) {
    // Final-tap CTA: after enough moves, the next tap redirects to the store.
    if (this._maybeCtaRedirect()) return;
    if (this.isAnimating) return;

    // Reset idle timer
    this.hideHandPointer();
    this.startHandPointerTimer();

    // First tap on an intact mirror BREAKS it (frame + glass gone), it does not play.
    const tapOb = ((window.LEVEL_CONFIG || {}).obstacles || {})[key];
    if (tapOb && tapOb.type === 'MIRROR_CARD' && !(this._brokenMirrors && this._brokenMirrors.has(key))) {
      const revealed = this.uncoveredCards && this.uncoveredCards.has(key);
      const PEo = (window.PE || {}).obstacle;
      const headWild = revealed && PEo && this.gameState ? this.gameState.obState(PEo).headIsWild : false;
      if (!revealed || headWild) { this.shakeCard(key); return; }  // covered, or wild head → can't break
      this.breakMirror(key);
      return;
    }

    // Check if card is playable
    if (!this.playableCards.has(key)) {
      this.shakeCard(key);
      // Tapping a blocked card on a board with no move left ends the game (e.g. a
      // curtain whose colour/suit the head can't match, and nothing else plays).
      if (this._deadBoard()) this._endIfDead(700);
      return;
    }

    this._markChallengeStarted();

    this.moveCount++;
    this.isAnimating = true;

    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};

    this.playSound('valid_card');

    if (gameFlow.mode === 'dependency') {
      this.processDependencyPlay(key);
      return;
    }

    // Determine flow if not yet set
    if (!this.activeFlow) {
      const entryCards = gameFlow.entry_cards || {};
      for (const [flowId, entryKey] of Object.entries(entryCards)) {
        if (entryKey === key) {
          this.activeFlow = flowId;
          this.flowStep = 1;
          break;
        }
      }
    }

    // Process the flow step
    this.processCardPlay(key);
  }

  processCardPlay(key) {
    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};
    const flowData = gameFlow[`flow_${this.activeFlow}`] || {};

    // Find matching step
    let step = null;

    // Check numbered steps
    for (const stepKey of Object.keys(flowData)) {
      const stepData = flowData[stepKey];
      if (stepData.trigger === key) {
        step = stepData;
        break;
      }
      // Check pair groups in step_3_pairs
      if (stepKey === 'step_3_pairs' && Array.isArray(stepData)) {
        // Free choice phase - handle directly
        this.handleFreeChoicePlay(key, stepData);
        return;
      }
    }

    if (!step) {
      // Must be in free choice phase
      const pairsKey = 'step_3_pairs';
      const pairs = flowData[pairsKey];
      if (pairs) {
        this.handleFreeChoicePlay(key, pairs);
        return;
      }
      this.isAnimating = false;
      return;
    }

    // Execute step: animate card to talon
    const moveToTalon = step.move_to_talon || [key];
    this.playCardToTalon(key, () => {
      this.playedCards.add(key);
      this.playableCards.delete(key);
      this.reportProgress();

      // Animate icons for this card
      this.animateIconsForCard(key);

      // Flip cards
      if (step.flip_card) {
        const flips = Array.isArray(step.flip_card) ? step.flip_card : [step.flip_card];
        flips.forEach((fk, i) => this.flipCard(fk, i * 300));
      }

      // Move additional cards to talon
      const additionalMoves = moveToTalon.filter(k => k !== key);
      additionalMoves.forEach((mk, i) => {
        this.time.delayedCall(300 + i * 400, () => {
          this.playCardToTalon(mk, () => {
            this.playedCards.add(mk);
            this.animateIconsForCard(mk);
          });
        });
      });

      // Set next playable cards
      const delay = 300 + additionalMoves.length * 400 + 200;
      this.time.delayedCall(delay, () => {
        const nextPlayable = step.next_playable || [];
        this.playableCards = new Set(nextPlayable);
        // Reveal (flip face-up) each newly playable card, like the real game.
        nextPlayable.forEach((ck, i) => this.flipCard(ck, i * 150));
        this.flowStep++;
        this.isAnimating = false;

        // Animate progress
        this.animateProgressForStep();

        // Play Wags upgrade animation
        this.playWagsCakeUpgradeAnimation();

        // Check if we should transition to free choice
        if (this.playableCards.size === 0 && this.flowStep > 2) {
          this.setupFreeChoice();
        }

        this.startHandPointerTimer();
      });
    });
  }

  handleFreeChoicePlay(key, pairGroups) {
    this.playCardToTalon(key, () => {
      this.playedCards.add(key);
      this.playableCards.delete(key);
      this.reportProgress();
      this.animateIconsForCard(key);

      // Check pair completion
      let allPairsComplete = true;
      pairGroups.forEach(pair => {
        const pairComplete = pair.every(k => this.playedCards.has(k));
        if (pairComplete) {
          this.progressStage++;
          this.animateProgressForStep();
          this.playWagsCakeUpgradeAnimation();
        }
        if (!pairComplete) allPairsComplete = false;
      });

      this.isAnimating = false;

      if (allPairsComplete || this.playableCards.size === 0) {
        // All cards played — transition to end
        this.time.delayedCall(1500, () => {
          this.transitionToEndScene();
        });
      } else {
        this.startHandPointerTimer();
      }
    });
  }

  setupFreeChoice() {
    const config = window.LEVEL_CONFIG;
    const gameFlow = config.game_flow || {};
    const flowData = gameFlow[`flow_${this.activeFlow}`] || {};
    const pairs = flowData.step_3_pairs || [];

    // All unplayed cards in pair groups become playable
    const playable = new Set();
    pairs.forEach(pair => {
      pair.forEach(k => {
        if (!this.playedCards.has(k)) {
          playable.add(k);
        }
      });
    });
    this.playableCards = playable;
  }

  // ===========================================================================
  // DEPENDENCY MODE
  // ===========================================================================

  buildDependencyMaps(gameFlow) {
    const deps = gameFlow.dependencies || {};
    this.dependencyMap = {};    // card -> [blockers]
    this.reverseDepMap = {};    // card -> [cards it blocks]
    this.removedCards = new Set();

    for (const [card, blockers] of Object.entries(deps)) {
      this.dependencyMap[card] = [...blockers];
      for (const blocker of blockers) {
        if (!this.reverseDepMap[blocker]) {
          this.reverseDepMap[blocker] = [];
        }
        this.reverseDepMap[blocker].push(card);
      }
    }
  }

  processDependencyPlay(key) {
    // Track this card as played immediately (before async callbacks)
    this.playedCards.add(key);

    // playedCards is now set, so refresh overlays: a played special card's
    // arrows/beam drop immediately rather than lingering as it flies to the talon.
    this.updateSpecialCardVisuals();

    // Start collectible icon animation simultaneously with card animation
    let isLastCollectible = false;
    if (this.hasCollectibles) {
      const config = window.LEVEL_CONFIG;
      this.animateIconsForCard(key);
      if ((config.card_to_icons || {})[key]) {
        this.collectiblesCollected++;
        this.updateTailWag();
        this.animateProgressForStep();
        this.playWagsCakeUpgradeAnimation();

        // Check if all collectibles are now gathered
        const collectibleCards = Object.keys(config.card_to_icons || {});
        isLastCollectible = collectibleCards.every(k => this.playedCards.has(k));
      }
    }

    if (isLastCollectible) {
      this.playSound('collectible_complete');
    }

    // Check if this slot triggers the end (explicit trigger_end in mapping)
    const triggerEndSlots = window.LEVEL_CONFIG.trigger_end_slots || [];
    const isTriggerEnd = triggerEndSlots.includes(key);

    // If this was the last collectible or a trigger_end slot, schedule transition
    if (isLastCollectible || isTriggerEnd) {
      this._forcedEnd = true;   // explicit scripted end — allowed even if moves remain
      this.time.delayedCall(1500, () => this.transitionToEndScene());
    }

    this.playCardToTalon(key, () => {
      let newlyPlayable;
      if (this.gameState) {
        // Delegate state transition to GameState
        const result = this.gameState.applyDependencyPlay(key);
        this._syncFromGameState();
        newlyPlayable = result.newlyUncovered || [];
      } else {
        // Inline fallback
        this.uncoveredCards.delete(key);
        this.removedCards.add(key);
        if (this.talonDeckCards.length > 0) {
          this.currentTopCard = key;
          this.currentTopRank = this.getRankValue(key);
        }
        newlyPlayable = this.resolveNewlyPlayable(key);
        newlyPlayable.forEach(cardKey => this.uncoveredCards.add(cardKey));
        if (this.talonDeckCards.length > 0) {
          this.recalculatePlayable();
        } else {
          this.playableCards = new Set(this.uncoveredCards);
        }
      }

      // Progress (PASS_25/50/75) — after state updated, before any early return.
      this.reportProgress();

      // Obstacle reactions to this card being played (e.g. a Key opens its Lock).
      this.onObstacleCardPlayed(key);

      // If last collectible or trigger_end, keep blocking interaction (transition already scheduled)
      if (isLastCollectible || isTriggerEnd) return;

      // Check win condition before flipping — don't reveal cards if game is over
      const totalCards = Object.keys(this.cardSprites).length;
      const isWin = this.removedCards.size >= totalCards;

      // Flip newly uncovered cards face-up with staggered delay (skip if game won)
      if (!isWin) {
        newlyPlayable.forEach((cardKey, i) => {
          this.flipCard(cardKey, i * 150);
        });
      }

      this.isAnimating = false;

      if (isWin) {
        this.cancelHint();
        this.time.delayedCall(1000, () => this.transitionToEndScene());
      } else if (this._deadBoard()) {
        this._endIfDead(1500);   // re-verified at fire time
      } else {
        this.startHandPointerTimer();
      }
    });
  }

  resolveNewlyPlayable(removedKey) {
    const blocked = this.reverseDepMap[removedKey] || [];
    const newlyPlayable = [];

    for (const card of blocked) {
      const blockers = this.dependencyMap[card] || [];
      const allRemoved = blockers.every(b => this.removedCards.has(b));
      if (allRemoved && !this.removedCards.has(card) && !this.playableCards.has(card)) {
        newlyPlayable.push(card);
      }
    }

    return newlyPlayable;
  }

  // ===========================================================================
  // CARD ANIMATIONS
  // ===========================================================================

  playCardToTalon(cardKey, onComplete) {
    const card = this.cardSprites[cardKey] || this[cardKey];
    const talon = this.talon_base;
    if (!card || !talon) {
      if (onComplete) onComplete();
      return;
    }

    // Bring card to front
    this.cardsContainer.bringToTop(card);

    // If this card carries an obstacle overlay (e.g. a mirror frame), fade it out
    // as the card flies off so it doesn't linger on the board.
    const obOv = this._obstacleOverlays && this._obstacleOverlays[cardKey];
    if (obOv && obOv.visible) {
      delete this._obstacleOverlays[cardKey];
      this.tweens.add({ targets: obOv, alpha: 0, scale: obOv.scaleX * 1.1, duration: 250, ease: 'Sine.easeOut', onComplete: () => obOv.setVisible(false) });
    }

    // Get animation config
    const config = window.LEVEL_CONFIG;
    const animConfig = config.animation || {};
    const perCard = animConfig.per_card || {};
    const defaults = animConfig.default || { curve_height: 200, first_duration: 500, second_duration: 350 };
    const cardAnim = perCard[cardKey] || defaults;

    const curveHeight = cardAnim.curve_height || defaults.curve_height;
    const firstDuration = cardAnim.first_duration || defaults.first_duration;
    const secondDuration = cardAnim.second_duration || defaults.second_duration;

    const srcX = card.x, srcY = card.y;
    const dstX = talon.x, dstY = talon.y;
    const baseRot = card.rotation || 0;
    const origScaleX = card.scaleX, origScaleY = card.scaleY;
    // Played cards land at the talon scale (uniform waste pile).
    const dstScaleX = talon.scaleX || origScaleX;
    const dstScaleY = talon.scaleY || origScaleY;

    // --- Card-to-talon motion, copied from Wags Day Out / Water playCard ---
    // Rise to a mid-point at 1.3x, settle onto the talon, with one full spin.
    const peakScaleX = origScaleX * 1.3, peakScaleY = origScaleY * 1.3;
    const midX = (srcX + dstX) / 2;
    const midY = Math.min(srcY, dstY) - 150;
    const spin = (srcX < dstX ? 1 : -1) * 2 * Math.PI;
    card.setDepth(99999);

    this.tweens.add({
      targets: card, x: midX, y: midY, scaleX: peakScaleX, scaleY: peakScaleY,
      duration: 300, ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: card, x: dstX, y: dstY, scaleX: dstScaleX, scaleY: dstScaleY,
          duration: 250, ease: 'Sine.easeIn',
          onComplete: () => {
            card.setRotation(0);
            card.setDepth((talon.depth || 1) + this.playedCardDepth);
            this.playedCardDepth++;
            this.headSprite = card;   // this played card is now the visible head
            (this.wasteSprites = this.wasteSprites || []).push(card);
            if (onComplete) onComplete();
          }
        });
      }
    });
    // Full spin in parallel, straightening on land.
    this.tweens.add({
      targets: card, rotation: baseRot + spin, duration: 550, ease: 'Sine.easeInOut',
      onComplete: () => { if (card && card.scene) card.setRotation(0); }
    });

    // Remove card back overlay
    const overlay = this.cardBackOverlays.find(o => o.getData('cardKey') === cardKey);
    if (overlay) overlay.setVisible(false);

    // Disable interaction
    card.disableInteractive();
  }

  flipCard(cardKey, delay) {
    delay = delay || 0;
    const card = this.cardSprites[cardKey] || this[cardKey];
    const overlay = this.cardBackOverlays.find(
      o => o.getData('cardKey') === cardKey
    );

    if (!card || !overlay || !overlay.visible) return;

    // A revealed card must sit above its face-down neighbors — both so it
    // renders on top and so it (not a covering card) receives the tap.
    this.cardsContainer.bringToTop(card);
    this.cardsContainer.bringToTop(overlay);

    const origScaleX = card.scaleX;
    const origOriginX = card.originX;
    const origOriginY = card.originY;
    const layout = this.selectLayout();
    const finalPos = layout[cardKey] || { x: card.x, y: card.y };

    card.setOrigin(0.5, 0.5);
    overlay.setOrigin(0.5, 0.5);

    // Find associated icon sprites for this card
    const config = window.LEVEL_CONFIG;
    const cardIcons = (config.card_to_icons || {})[cardKey] || [];
    const iconSprites = cardIcons
      .map(k => this.iconSprites && this.iconSprites[k])
      .filter(Boolean);
    const iconOrigPositions = iconSprites.map(s => ({ x: s.x, scaleX: s.scaleX }));

    // Snappy two-stage flip matching Wags Day Out (flipCardToFace): squeeze to
    // 0 (Sine.easeIn), swap face, expand back (Sine.easeOut) — ~90ms each half.
    const flipHalf = 90;
    // Phase 1: Icons move to card center + squeeze; card squeezes
    iconSprites.forEach(sprite => {
      this.tweens.add({
        targets: sprite,
        x: card.x,
        scaleX: 0,
        duration: flipHalf,
        delay: delay,
        ease: 'Sine.easeIn',
      });
    });

    this.tweens.add({
      targets: [overlay, card],
      scaleX: 0,
      duration: flipHalf,
      delay: delay,
      ease: 'Sine.easeIn',
      onComplete: () => {
        overlay.setVisible(false);

        // Phase 2: Card expands back; icons move back to original position
        card.scaleX = 0;
        this.tweens.add({
          targets: card,
          scaleX: origScaleX,
          duration: flipHalf,
          ease: 'Sine.easeOut',
          onComplete: () => {
            card.setOrigin(origOriginX, origOriginY);
            card.setPosition(finalPos.x, finalPos.y);
            // A trap card shows its rope the moment it is revealed.
            this.revealTrapRope(cardKey);
            // A revealed Key card auto-flies to its Lock and opens it — no tap.
            const lockId = this._lockForKey(cardKey);
            if (lockId && !card._keyUnlocking) {
              card._keyUnlocking = true;
              this.time.delayedCall(300, () => this.autoUnlockKey(cardKey, lockId));
            }
          }
        });

        iconSprites.forEach((sprite, idx) => {
          const orig = iconOrigPositions[idx];
          sprite.scaleX = 0;
          this.tweens.add({
            targets: sprite,
            x: orig.x,
            scaleX: orig.scaleX,
            duration: flipHalf,
            ease: 'Sine.easeOut',
          });
        });
      }
    });
  }

  // Wrong-card wobble, copied from Wags Day Out shakeCard: rock ±2° around the
  // card's resting angle (plus a tiny x nudge) and settle back.
  shakeCard(cardKey) {
    const card = this.cardSprites[cardKey] || this[cardKey];
    if (!card || card._shaking) return;
    card._shaking = true;
    this.playSound('invalid_card');

    const overlay = this.cardBackOverlays.find(o => o.getData('cardKey') === cardKey);
    const targets = overlay && overlay.visible ? [card, overlay] : [card];
    const baseRot = card.rotation || 0;
    const origX = card.x;
    const amp = 2 * Math.PI / 180;   // ±2°
    const px = 3;
    const angles = [baseRot + amp, baseRot - amp, baseRot + amp, baseRot - amp, baseRot];
    const xs = [origX + px, origX - px, origX + px, origX - px, origX];
    let i = 0;
    const next = () => {
      if (i >= angles.length) {
        targets.forEach(t => { t.rotation = baseRot; t.x = origX; });
        card._shaking = false;
        return;
      }
      this.tweens.add({
        targets, rotation: angles[i], x: xs[i], duration: 55, ease: 'Sine.easeInOut',
        onComplete: () => { i++; next(); },
      });
    };
    next();
  }

  // ===========================================================================
  // ICON ANIMATIONS
  // ===========================================================================

  animateIconsForCard(cardKey) {
    const config = window.LEVEL_CONFIG;
    const cardToIcons = config.card_to_icons || {};
    const icons = cardToIcons[cardKey];
    if (!icons || !this.collectibleContainerSprite) return;
    const hasCollectSound = this.cache.audio.exists('collect_icon');

    icons.forEach((iconKey, i) => {
      const iconSprite = this.iconSprites[iconKey];
      if (!iconSprite) return;

      // Arc → pause → drop animation with particle burst on impact
      this.time.delayedCall(i * 200, () => {
        if (hasCollectSound) this.playSound('collect_icon');
        // Lift the icon above the cards for its flight to the reward.
        if (this.iconFlyContainer && iconSprite.parentContainer !== this.iconFlyContainer) {
          this.iconContainer.remove(iconSprite);
          this.iconFlyContainer.add(iconSprite);
        }
        const srcX = iconSprite.x, srcY = iconSprite.y;
        const dstX = this.collectibleContainerSprite.x;
        const dstY = this.collectibleContainerSprite.y;
        const curveHeight = 150;
        const startScale = iconSprite.scale;
        const peakScale = startScale * 1.2;

        // Phase 1: Arc to above the cake
        const arcPath = new Phaser.Curves.Path(srcX, srcY);
        arcPath.cubicBezierTo(
          dstX, srcY - curveHeight * 0.5,
          srcX + 0.25 * (dstX - srcX), srcY - curveHeight,
          srcX + 0.75 * (dstX - srcX), srcY - curveHeight
        );
        const arcProgress = { t: 0 };

        this.tweens.add({
          targets: arcProgress,
          t: 1,
          duration: 450,
          ease: 'Sine.easeOut',
          onUpdate: () => {
            const point = arcPath.getPoint(arcProgress.t);
            iconSprite.setPosition(point.x, point.y);
            const s = startScale + (peakScale - startScale) * arcProgress.t;
            iconSprite.setScale(s);
          },
          onComplete: () => {
            // Phase 2: Pause briefly at the top
            this.time.delayedCall(150, () => {
              // Phase 3: Drop down to cake
              this.tweens.add({
                targets: iconSprite,
                y: dstY,
                duration: 250,
                ease: 'Bounce.easeOut',
                onComplete: () => {
                  iconSprite.setVisible(false);
                  // Gold particle burst — on the icon landing spot and on the cake
                  if (this.textures.exists('particle_dot') && typeof this.add.particles === 'function') {
                    const burstConfig = {
                      speed: { min: 200, max: 400 },
                      angle: { min: 0, max: 360 },
                      scale: { start: 1, end: 0 },
                      alpha: { start: 1, end: 0 },
                      lifespan: 1500,
                      frequency: -1,
                    };
                    // Burst at icon landing point
                    const iconBurst = this.add.particles(dstX, dstY, 'particle_dot', burstConfig);
                    iconBurst.setDepth(29);
                    iconBurst.explode(12);
                    // Burst at cake center
                    const cakeBurst = this.add.particles(dstX, dstY - 80, 'particle_dot', burstConfig);
                    cakeBurst.setDepth(29);
                    cakeBurst.explode(12);
                    this.time.delayedCall(1600, () => { iconBurst.destroy(); cakeBurst.destroy(); });
                  }
                  this.revealCakeElement(iconKey);
                }
              });
            });
          }
        });
      });
    });
  }

  revealCakeElement(iconKey) {
    const config = window.LEVEL_CONFIG;
    const parts = (config.cake_reveal || {})[iconKey] || [];

    // Hide previous layers (replace mode — e.g. icecream swaps full composites)
    const hideParts = (config.cake_hide || {})[iconKey] || [];
    hideParts.forEach(part => {
      this.revealedCakeLayers.delete(part);
      if (this[part]) {
        this.tweens.add({
          targets: this[part],
          alpha: 0,
          duration: 200,
          ease: 'Power2',
        });
      }
    });

    parts.forEach(part => {
      this.revealedCakeLayers.add(part);
      if (this[part]) {
        this.tweens.add({
          targets: this[part],
          alpha: 1,
          duration: 300,
          ease: 'Power2',
        });
        // Squash effect
        this.applyCakeImpactSquash();
      }
    });
  }

  applyCakeImpactSquash() {
    if (!this.collectibleContainerSprite) return;

    const impactType = ((window.LEVEL_CONFIG || {}).reward || {}).impact_animation || 'squash';

    if (impactType === 'pulse') {
      // Uniform scale pulse — for flat top-down rewards (e.g. pizza)
      const origScale = this.collectibleContainerSprite.scaleX;
      this.tweens.add({
        targets: this.collectibleContainerSprite,
        scaleX: origScale * 1.08,
        scaleY: origScale * 1.08,
        duration: 100,
        ease: 'Sine.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: this.collectibleContainerSprite,
            scaleX: origScale,
            scaleY: origScale,
            duration: 150,
            ease: 'Sine.easeInOut',
          });
        }
      });
    } else {
      // Vertical squash bounce — for tall rewards (e.g. cake)
      const origY = this.collectibleContainerSprite.y;
      const origScaleY = this.collectibleContainerSprite.scaleY;

      this.tweens.add({
        targets: this.collectibleContainerSprite,
        y: origY + 8,
        scaleY: origScaleY * 0.92,
        duration: 80,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.tweens.add({
            targets: this.collectibleContainerSprite,
            y: origY - 4,
            scaleY: origScaleY * 1.02,
            duration: 100,
            ease: 'Sine.easeOut',
            onComplete: () => {
              this.tweens.add({
                targets: this.collectibleContainerSprite,
                y: origY,
                scaleY: origScaleY,
                duration: 120,
                ease: 'Sine.easeInOut',
              });
            }
          });
        }
      });
    }
  }

  // ===========================================================================
  // PROGRESS BAR
  // ===========================================================================

  // TODO: Progress bar has 4 hardcoded stages. Levels with more/fewer collectible
  // cards (e.g. level-15003 has 5) will not fill the bar completely. Consider
  // scaling stages to match the collectible count from config.card_to_icons.
  animateProgressForStep() {
    if (!this.progressSprites) return;

    const stages = [
      ['progress_start'],
      ['progress_end_1', 'progress_mid_1'],
      ['progress_end_2', 'progress_mid_2', 'progress_mid_3'],
      ['progress_end_3'],
    ];

    const stage = stages[this.progressStage];
    if (!stage) return;

    stage.forEach((key, i) => {
      const sprite = this.progressSprites[key];
      if (sprite) {
        this.tweens.add({
          targets: sprite,
          alpha: 1,
          duration: 300,
          delay: i * 150,
          ease: 'Power2',
        });
      }
    });

    this.progressStage++;
  }

  // ===========================================================================
  // WAGS ANIMATIONS
  // ===========================================================================

  playWagsCakeUpgradeAnimation() {
    if (!this.wags_container || this.isWagsAnimating) return;
    this.isWagsAnimating = true;

    // Lock in current base scale on first invocation (escalateWagsExcitement may have raised it)
    const baseScale = this.wagsBaseScale || this.wags_container.scaleX;
    const baseY = this.wagsBaseY || this.wags_container.y;
    this.wagsBaseScale = baseScale;
    this.wagsBaseY = baseY;

    // Excited bounce — scale + y in unison; amplitude grows with the excitement stage
    const stage = this.wagsExcitementStage || 0;            // 0..3 (set by escalateWagsExcitement)
    const jumpPx = 16 + stage * 8;                          // 16, 24, 32, 40
    const scaleBump = 1.05 + stage * 0.02;                  // 1.05, 1.07, 1.09, 1.11
    this.tweens.add({
      targets: this.wags_container,
      y: baseY - jumpPx,
      scale: baseScale * scaleBump,
      duration: 180,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.wags_container.y = baseY;
        this.wags_container.setScale(baseScale);
        this.isWagsAnimating = false;
      }
    });

    // Head-shake rotation — bigger wiggle at higher excitement
    const wiggle = 0.04 + stage * 0.025;                    // ~2.3° → 6.4°
    this.tweens.add({
      targets: this.wags_container,
      rotation: { from: -wiggle, to: wiggle },
      duration: 90,
      yoyo: true,
      repeat: 1 + stage,
      ease: 'Sine.easeInOut',
      onComplete: () => { if (this.wags_container) this.wags_container.rotation = 0; },
    });

    // Tongue wag
    if (this.tongue) {
      this.tweens.add({
        targets: this.tongue,
        scaleY: 1.3,
        duration: 150,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // Real frame-by-frame character animation. Each excitement stage plays a
  // different looping Veo-generated frame set (wags_idle / alert / bouncing).
  // Transitions are instantaneous swaps of which anim is playing — Phaser's
  // anims API handles the frame cycling at frameRate fps.
  escalateWagsExcitement(pct) {
    if (!this.wags_1 || !this.wags_1.play) return;     // wags_1 must be a Sprite
    const stage = pct >= 0.75 ? 3 : pct >= 0.50 ? 2 : pct >= 0.25 ? 1 : 0;
    if (stage === (this.wagsExcitementStage ?? -1)) return;
    this.wagsExcitementStage = stage;
    const animKey = ['wags_idle', 'wags_alert', 'wags_bouncing', 'wags_bouncing'][stage];
    if (this.anims.exists(animKey)) {
      this.wags_1.play({ key: animKey, repeat: -1 }, true);
    }
  }

  // (deprecated tween-based excitement — kept temporarily; no-op now that we use anim.play())
  _legacyEscalate(pct) {
    if (!this.wags_1 || !this.wags_container) return;
    const stage = pct >= 0.75 ? 3 : pct >= 0.50 ? 2 : pct >= 0.25 ? 1 : 0;
    if (stage === (this.wagsExcitementStage ?? -1)) return;
    this.wagsExcitementStage = stage;

    if (this.wagsBaseY === undefined) {
      this.wagsBaseY = this.wags_container.y;
      this.wagsBaseScale = this.wags_container.scaleX;
    }
    const baseY = this.wagsBaseY;
    const baseSc = this.wagsBaseScale;

    // Kill every previous animation so we start clean
    ['wagsBreath', 'wagsBob', 'wagsBounceChain', 'wagsWobble'].forEach(k => {
      if (this[k]) { this[k].stop(); this[k] = null; }
    });
    this.wags_container.y = baseY;
    this.wags_container.setScale(baseSc);
    this.wags_container.rotation = 0;

    // Pose mapping — stages 0/1 sit, stage 2/3 are bouncing-on-paws (Pose 3).
    // Cross-fade between poses (alpha out → setTexture → alpha in) so the swap is hidden.
    const targetPose = stage >= 2 ? 'wags_3' : 'wags_1';
    if (this.wags_1.texture.key !== targetPose && this.textures.exists(targetPose)) {
      this.tweens.add({
        targets: this.wags_1, alpha: 0, duration: 140, ease: 'Sine.easeIn',
        onComplete: () => {
          this.wags_1.setTexture(targetPose);
          this.tweens.add({ targets: this.wags_1, alpha: 1, duration: 140, ease: 'Sine.easeOut' });
        },
      });
    }

    // Stages 0–1: just breathing (subtle vertical scale yoyo). Gentle, organic, NO bounce.
    if (stage <= 1) {
      const breathAmp = stage === 0 ? 0.012 : 0.022;        // 1.2% → 2.2% scale change
      const breathMs  = stage === 0 ? 2400 : 1700;
      this.wagsBreath = this.tweens.add({
        targets: this.wags_container,
        scaleY: { from: baseSc * (1 - breathAmp), to: baseSc * (1 + breathAmp) },
        duration: breathMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      // Stage 1 adds a tiny y-bob slightly out-of-phase with breathing
      if (stage === 1) {
        this.wagsBob = this.tweens.add({
          targets: this.wags_container,
          y: baseY - 2,
          duration: breathMs,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
          delay: breathMs / 2,
        });
      }
      return;
    }

    // Stages 2–3: real bouncing with squash/stretch chain.
    // Phaser tween chain emulates one bounce cycle: anticipation → rise (stretch) →
    // peak → fall → squash (impact) → recover. Loops indefinitely. Volume preserved
    // (scaleX increases when scaleY decreases, and vice versa).
    const cfg = stage === 2
      ? { riseY: 14, riseMs: 220, fallMs: 180, squashY: 0.92, stretchY: 1.06, holdMs: 30,  pauseMs: 220, rotDeg: 0 }
      : { riseY: 22, riseMs: 180, fallMs: 150, squashY: 0.88, stretchY: 1.09, holdMs: 50,  pauseMs: 120, rotDeg: 0.025 };

    this.wagsBounceChain = this.tweens.chain({
      targets: this.wags_container,
      loop: -1,
      tweens: [
        // Anticipation — slight pre-squash (volume preserved by widening scaleX)
        { scaleX: baseSc * 1.04, scaleY: baseSc * 0.96, duration: 90, ease: 'Sine.easeIn' },
        // Rise — stretch upward (taller, narrower)
        { y: baseY - cfg.riseY, scaleX: baseSc * 0.96, scaleY: baseSc * cfg.stretchY,
          duration: cfg.riseMs, ease: 'Back.easeOut' },
        // Brief hold at peak
        { y: baseY - cfg.riseY, scaleX: baseSc * 0.96, scaleY: baseSc * cfg.stretchY,
          duration: cfg.holdMs },
        // Fall (eased back to normal proportions)
        { y: baseY, scaleX: baseSc, scaleY: baseSc, duration: cfg.fallMs, ease: 'Sine.easeIn' },
        // Squash on landing — shorter and wider (impact)
        { scaleX: baseSc * 1.10, scaleY: baseSc * cfg.squashY, duration: 70, ease: 'Quad.easeOut' },
        // Recover to neutral with slight overshoot (Back.easeOut)
        { scaleX: baseSc, scaleY: baseSc, duration: 140, ease: 'Back.easeOut' },
        // Idle pause between bounces
        { duration: cfg.pauseMs },
      ],
    });

    // Stage 3: add a subtle rotation wobble — overlapping at a different frequency
    // for that organic non-mechanical feel
    if (cfg.rotDeg > 0) {
      this.wagsWobble = this.tweens.add({
        targets: this.wags_container,
        rotation: { from: -cfg.rotDeg, to: cfg.rotDeg },
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // ===========================================================================
  // ANALYTICS PROGRESS
  // ===========================================================================

  // Fire CHALLENGE_PASS_25/50/75 as the board clears. Works in BOTH dependency
  // (removedCards) and scripted (playedCards) modes. Each threshold latches once
  // via window.__alFired, so calling this after every successful play is safe.
  reportProgress() {
    // Compute progress first — Wags excitement escalation runs regardless of
    // whether trackAL is injected (it's a gameplay-feel thing, not analytics).
    const total = Object.keys(this.cardSprites || {}).length;
    if (!total) return;
    const done = (this.removedCards && this.removedCards.size)
      || (this.playedCards && this.playedCards.size) || 0;
    const pct = done / total;
    this.escalateWagsExcitement(pct);

    // Analytics — skip on builds without the helper, or once the last threshold has latched
    if (!window.trackAL) return;
    if (window.__alFired && window.__alFired['CHALLENGE_PASS_75']) return;
    if (pct >= 0.25) window.trackAL('CHALLENGE_PASS_25');
    if (pct >= 0.50) window.trackAL('CHALLENGE_PASS_50');
    if (pct >= 0.75) window.trackAL('CHALLENGE_PASS_75');
  }

  // First real interaction → CHALLENGE_STARTED (deduped window-side, fires once).
  // Called from both tap entry points (card + stock).
  _markChallengeStarted() {
    window.__firstTapTs = window.__firstTapTs || Date.now();
    window.trackAL && window.trackAL('CHALLENGE_STARTED');
  }

  // ===========================================================================
  // END GAME TRANSITION
  // ===========================================================================

  transitionToEndScene() {
    // Win = every tableau card cleared; otherwise it's a dead-board loss.
    this._won = !!(this.removedCards && this.removedCards.size >= Object.keys(this.cardSprites || {}).length);
    // HARD SAFETY NET: never show a dead-board LOSE while a valid move still
    // exists. Only a win, or an explicit forced end (bomb / trigger_end), may end
    // the game when the board is not actually dead — otherwise resume play.
    if (!this._ended && !this._won && !this._forcedEnd && this.gameState
        && this._deadBoard && !this._deadBoard()) {
      this.startHandPointerTimer();
      return;
    }
    // CHALLENGE_SOLVED / CHALLENGE_FAILED — fire exactly once (instance _ended
    // latch guards against a double transition firing both outcomes).
    if (!this._ended) {
      this._ended = true;
      window.trackAL && window.trackAL(this._won ? 'CHALLENGE_SOLVED' : 'CHALLENGE_FAILED');
    }
    // No idle hint + fade the talon panel away (no awkward empty-talon gap).
    this.cancelHint();
    if (this.talonPanel) this.tweens.add({ targets: this.talonPanel, alpha: 0, duration: 300 });
    // Hide text
    const layout = this.selectLayout();
    const textKeys = Object.keys(layout).filter(k => k.startsWith('text_let'));
    textKeys.forEach(key => {
      if (this[key]) {
        this.tweens.add({ targets: this[key], alpha: 0, duration: 300 });
      }
    });

    // Show completion text
    const completionKeys = Object.keys(layout).filter(k => k.startsWith('text_Woohoo'));
    completionKeys.forEach((key, i) => {
      if (this[key]) {
        this.tweens.add({
          targets: this[key],
          alpha: 1,
          duration: 400,
          delay: 300 + i * 200,
        });
      }
    });

    // Alpha (transparent) mode strips the themed end content (cake, glow,
    // text), so the rest of this function would just fade the cards out
    // and leave a blank canvas. Bail and let the final talon stay visible.
    if (this.sys.game.config.transparent === true) return;

    // Fade cards and uncollected icons
    this.tweens.add({
      targets: [this.cardsContainer, this.iconContainer],
      alpha: 0,
      duration: 500,
    });

    // Animate cake to center
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height * 0.45;

    if (this.collectibleContainerSprite) {
      this._cakeAnimating = true;
      this.tweens.add({
        targets: this.collectibleContainerSprite,
        x: centerX,
        y: centerY,
        scale: 1.5,
        duration: 800,
        ease: 'Power2.easeOut',
        onComplete: () => { this._cakeAnimating = false; },
      });
    }

    // God rays + sparkle burst — win celebration ONLY (skip on a dead-board loss).
    this.time.delayedCall(600, () => {
      if (!this._won) return;
      const rayDepth = 29; // Behind cake (depth 30)

      if (this.textures.exists('glow_effect')) {
        this.glowEffect = this.add.image(centerX, centerY, 'glow_effect')
          .setScale(0).setAlpha(0).setDepth(rayDepth).setBlendMode('ADD');
        this.tweens.add({
          targets: this.glowEffect,
          scale: 2.5, alpha: 0.8,
          duration: 800,
          ease: 'Power2.easeOut',
        });
      }

      if (this.textures.exists('glow_lines')) {
        this.glowLines = this.add.image(centerX, centerY, 'glow_lines')
          .setScale(0).setAlpha(0).setDepth(rayDepth).setBlendMode('ADD');
        this.glowLines2 = this.add.image(centerX, centerY, 'glow_lines')
          .setScale(0).setAlpha(0).setDepth(rayDepth).setBlendMode('ADD');

        // Fade in
        this.tweens.add({
          targets: [this.glowLines, this.glowLines2],
          scale: 1.5, alpha: 1,
          duration: 1500,
        });
        // Rotate continuously
        this.tweens.add({
          targets: this.glowLines,
          angle: 360, duration: 30000, repeat: -1,
        });
        this.tweens.add({
          targets: this.glowLines2,
          angle: -360, duration: 30000, repeat: -1,
        });
      }

      // Sparkle burst at center — bigger, wider, a few staggered pops.
      if (this.textures.exists('particle_dot') && typeof this.add.particles === 'function') {
        const burst = this.add.particles(centerX, centerY, 'particle_dot', {
          speed: { min: 150, max: 680 },
          angle: { min: 0, max: 360 },
          scale: { start: 1.4, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: 1700,
          frequency: -1,
        });
        burst.setDepth(rayDepth + 1);
        burst.explode(90);
        this.time.delayedCall(200, () => burst.explode(70));
        this.time.delayedCall(450, () => burst.explode(55));
        this.time.delayedCall(2800, () => burst.destroy());
      }
    });

    // Go to the End scene. Win: celebratory balloon transition after the
    // god-ray/sparkle beat. Loss: no celebration — go straight to the Try Again
    // screen quickly so there's no dead empty-cabin gap.
    const cakeData = {
      progressStage: this.progressStage,
      playedCards: Array.from(this.playedCards),
      revealedCakeLayers: Array.from(this.revealedCakeLayers),
      won: this._won,
    };
    if (this._won) {
      this.time.delayedCall(2500, () => {
        this.scene.launch('TransitionScene', { currentScene: 'Game', nextScene: 'End', cakeData });
      });
    } else {
      this.time.delayedCall(200, () => {
        this.scene.launch('End', cakeData);
        this.scene.bringToTop('End');
        this.scene.stop();
      });
    }
  }

  // ===========================================================================
  // RESIZE HANDLER
  // ===========================================================================

  onResize(gameSize) {
    this.reflowForResize({ width: gameSize.width, height: gameSize.height });
  }

  reflowForResize(size) {
    if (!this.cardSprites) return; // Called before finishCreate() completed

    // Refit the cover background and, on an orientation flip, re-render the
    // config-driven background images for the new orientation's positions.
    const W = this.scale.width, H = this.scale.height, isLandscape = W > H;
    if (this.main_bg) {
      this.main_bg.setPosition(W / 2, H / 2)
        .setScale(Math.max(W / this.main_bg.width, H / this.main_bg.height));
    }
    if (this._bgLandscape !== isLandscape) this.renderBackgroundLayers();

    const layout = this.selectLayout();

    // Reposition cards
    Object.keys(this.cardSprites).forEach(key => {
      const pos = layout[key];
      if (pos && this.cardSprites[key]) {
        const card = this.cardSprites[key];
        if (!this.playedCards.has(key)) {
          card.setPosition(pos.x, pos.y);
          if (pos.scale) card.setScale(pos.scale);
          card.setRotation(pos.r || 0);
        }
      }
    });

    // Reposition card back overlays
    this.cardBackOverlays.forEach(overlay => {
      const key = overlay.getData('cardKey');
      const pos = layout[key];
      if (pos && overlay.visible) {
        overlay.setPosition(pos.x, pos.y);
        if (pos.scale) overlay.setScale(pos.scale);
        overlay.setRotation(pos.r || 0);
      }
    });

    // Reposition talon
    if (this.talon_base && layout.talon_base) {
      this.talon_base.setPosition(layout.talon_base.x, layout.talon_base.y);
      if (layout.talon_base.scale) this.talon_base.setScale(layout.talon_base.scale);
    }

    // Reposition scripted starting talon card (seedScriptedTalon)
    if (this.startingTalonCard && layout.talon_base) {
      this.startingTalonCard.setPosition(layout.talon_base.x, layout.talon_base.y);
      this.startingTalonCard.setScale(this.getCardScale());
    }

    // Redraw the talon panel for the new orientation's positions
    this.drawTalonPanel(layout);

    // Reposition talon deck
    if (layout.talon_deck && layout.talon_base) {
      const dp = layout.talon_deck;
      const bp = layout.talon_base;
      // Stock backs spread left-to-right
      this.talonStockBacks.forEach((s, i) => {
        s.setPosition(dp.x + i * (this.talonStockSpacing || 12), dp.y);
        if (dp.scale) s.setScale(dp.scale);
      });
      // Card sprites: current top card at talon_base, rest at stock position
      Object.entries(this.talonDeckSprites).forEach(([key, s]) => {
        if (s.visible && key === this.currentTopCard) {
          s.setPosition(bp.x, bp.y);
        } else if (!this.playedCards.has(key)) {
          s.setPosition(dp.x, dp.y);
        }
        if (dp.scale) s.setScale(dp.scale);
      });
    }

    // Reposition UI
    if (this.logo && layout.logo) {
      this.logo.setPosition(layout.logo.x, layout.logo.y);
    }
    if (this.counter && layout.counter) {
      this.counter.setPosition(layout.counter.x, layout.counter.y);
    }
    if (this.table_bg && layout.table_bg) {
      this.table_bg.setPosition(layout.table_bg.x, layout.table_bg.y);
      if (layout.table_bg.scale) this.table_bg.setScale(layout.table_bg.scale);
    }

    // Reposition special-card glow rings + arrows to follow their cards
    this.updateSpecialCardVisuals();

    // Re-center the top banner for the new orientation
    this.layoutTopBanner();

    // Reposition Wags container and children
    if (this.wags_container && layout.wags_container) {
      const wc = layout.wags_container;
      this.wags_container.setPosition(wc.x, wc.y);
      if (wc.scale) this.wags_container.setScale(wc.scale);

      const wagsParts = [
        'tail',
        'left_eyeball', 'right_eyeball',
        'left_pupil', 'right_pupil',
        'left_eyelash', 'right_eyelash',
        'wags_1', 'birthday_hat',
      ];
      wagsParts.forEach(part => {
        if (this[part] && layout[part]) {
          const pos = layout[part];
          const isEyelid = (part === 'left_eyelash' || part === 'right_eyelash');
          const startY = isEyelid && pos.ye != null ? pos.ye : pos.y;
          this[part].setPosition(pos.x, startY);
          if (pos.scale) this[part].setScale(pos.scale);
          if (pos.r != null) this[part].setRotation(pos.r);
        }
      });

      // Restart tail wag with new base rotation
      if (this.tailWagTween) {
        this.tailWagTween.stop();
        this.tailWagTween = null;
      }
      this.startWagsIdle();
    }

    // Reposition progress bar
    if (this.progressSprites) {
      Object.keys(this.progressSprites).forEach(part => {
        const pos = layout[part];
        if (pos && this.progressSprites[part]) {
          this.progressSprites[part].setPosition(pos.x, pos.y);
          if (pos.scale) this.progressSprites[part].setScale(pos.scale);
        }
      });
    }

    // Reposition icons (relative to their card positions)
    if (this.iconSprites) {
      const config = window.LEVEL_CONFIG;
      const iconMapping = (config.icon_positions || {}).mapping || {};
      const isLandscape = size.width > size.height;

      Object.keys(this.iconSprites).forEach(iconKey => {
        const sprite = this.iconSprites[iconKey];
        const iconInfo = iconMapping[iconKey];
        if (iconInfo && iconInfo.card) {
          const cardPos = layout[iconInfo.card];
          const offsets = isLandscape ? iconInfo.landscape : iconInfo.portrait;
          if (cardPos && offsets) {
            const { dx, dy } = this._rotateOffset(
              this._iconDx(cardPos.x, offsets.dx || 0),
              offsets.dy || 0,
              cardPos.r,
            );
            sprite.setPosition(cardPos.x + dx, cardPos.y + dy);
            sprite.setScale(this.getIconScale());
          }
        } else if (layout[iconKey]) {
          // Explicit icon positions in layout
          const pos = layout[iconKey];
          sprite.setPosition(pos.x, pos.y);
          if (pos.scale) sprite.setScale(pos.scale);
        }
      });
    }

    // Reposition cake (skip if mid-animation to avoid snapping during transition)
    if (this._cakeAnimating) return;
    const config = window.LEVEL_CONFIG;
    const ui = config.ui || {};
    const cakeConfig = ui.collectibleContainer;
    if (this.collectibleContainerSprite && cakeConfig) {
      const isLandscape = size.width > size.height;
      const orient = isLandscape ? 'landscape' : 'portrait';
      const pos = cakeConfig[orient] || cakeConfig;
      this.collectibleContainerSprite.setPosition(pos.x, pos.y);
      if (pos.scale) this.collectibleContainerSprite.setScale(pos.scale);
    }
  }
}
