/**
 * EndScene.js — End/Celebration Scene
 * =====================================
 * Displays the completed cake, Wags celebration, confetti particles,
 * and CTA (call-to-action) button.
 *
 * Receives cake state from GameScene via scene data.
 * CTA redirect uses clickOut() defined on Phaser.Scene.prototype.
 */

class End extends Phaser.Scene {
  playSound(key, config) {
    if (typeof SoundControls !== 'undefined' && !SoundControls.canPlaySfx()) return;
    if (this.cache.audio.exists(key)) this.sound.play(key, config);
  }

  constructor() {
    super('End');

    // Positions extracted from original obfuscated EndScene
    this.LAYOUT_PORTRAIT = {
      logo:       { x: 0x21c, y: 0x8c, scale: 0.5 },
      banner_hbd: { x: 0x21c, y: 0xe6, scale: 1.15 },
      banner_wags:{ x: 0x21c, y: 0x172, scale: 1.15 },
      balloon_left:  { x: 0x8c, y: 0x47e, scale: 1.5, depth: 15 },
      balloon_right: { x: 0x38e, y: 0x47e, scale: 1.5, depth: 15 },
      counter:    { x: 0x21c, y: 0x6a4 },

      // Wags character
      wags_container: { x: 0x140, y: 0x4e2, scale: 1.35 },
      wags_L_eyeball: { x: 0x1e, y: -0x4b, depth: 999 },
      wags_R_eyeball: { x: 0x4b, y: -0x4f, depth: 999 },
      wags_Leyelash:  { x: 0x2a, y: -0x55, depth: 5 },
      wags_Reyelash:  { x: 0x58, y: -0x5a, depth: 5 },
      wags_L_pupil:   { x: 0x1d, y: -0x49, scale: 0.9, depth: 998 },
      wags_R_pupil:   { x: 0x49, y: -0x4d, scale: 0.9, depth: 998 },
      wags: { x: 0xf, y: 0x0, depth: 2 },
      tail: { x: -0x41, y: 0x64, r: -0.4, depth: 1 },
      wags_tongue: { x: 0x3e, y: -0x26, depth: 3 },
      wags_hat:    { x: 0x26, y: -0xa7, scale: 0.9, depth: 6 },

      // Cake — container + internal layer offsets
      collectibleContainer: { x: 0x2da, y: 0x55a, scale: 1.2 },
      round_base:                 { x: 0, y: 0 },
      base_white_top_layer:       { x: 0, y: -0xa0 },
      base_white_bottom_layer:    { x: 0, y: -0x37 },
      base_pink_top_layer:        { x: 0, y: -0xa0 },
      base_pink_bottom_layer:     { x: 0, y: -0x37 },
      frosting_blue_bottom:       { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_blue_top:          { x: 0, y: -0xbe, scale: 1, depth: 4 },
      frosting_pink_bottom:       { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_pink_top:          { x: 0, y: -0xbe, scale: 1, depth: 4 },
      frosting_purple_bottom:     { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_purple_top:        { x: 0, y: -0xbe, scale: 1, depth: 4 },
      frosting_yellow_bottom:     { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_yellow_top:        { x: 0, y: -0xbe, scale: 1, depth: 4 },
      topping_strawberry_layer_01:{ x: 0, y: -0xe6, scale: 1, depth: 5 },
      topping_strawberry_layer_02:{ x: 0, y: -0x82, scale: 1, depth: 5 },
      topping_strawberry_layer_03:{ x: 0, y: -0x14, scale: 1, depth: 5 },
      topping_treats_layer_01:    { x: 0, y: -0xe6, scale: 1, depth: 5 },
      topping_treats_layer_02:    { x: 0, y: -0x82, scale: 1, depth: 5 },
      topping_treats_layer_03:    { x: 0, y: -0x14, scale: 1, depth: 5 },

      playNow_Btn: { x: 0x21c, y: 0x60e, scale: 0.65 },
      cta: { x: 0x21c, y: 0x5c8, scale: 1.0 },
    };

    this.LAYOUT_LANDSCAPE = {
      logo:       { x: 0x3c0, y: 0x50, scale: 0.5 },
      banner_hbd: { x: 0x3c0, y: 0x7d, scale: 1.3 },
      banner_wags:{ x: 0x3c0, y: 0xff, scale: 1.3 },
      balloon_left:  { x: 0x1c2, y: 0x280, scale: 1.2, depth: 15 },
      balloon_right: { x: 0x5dc, y: 0x280, scale: 1.2, depth: 15 },
      counter:    { x: 0x3c0, y: 0x442 },

      // Wags character
      wags_container: { x: 0x2ee, y: 0x2a3, scale: 1.1 },
      wags_L_eyeball: { x: 0x1e, y: -0x4b, depth: 999 },
      wags_R_eyeball: { x: 0x4b, y: -0x4f, depth: 999 },
      wags_Leyelash:  { x: 0x2a, y: -0x55, depth: 5 },
      wags_Reyelash:  { x: 0x58, y: -0x5a, depth: 5 },
      wags_L_pupil:   { x: 0x1d, y: -0x49, scale: 0.9, depth: 998 },
      wags_R_pupil:   { x: 0x49, y: -0x4d, scale: 0.9, depth: 998 },
      wags: { x: 0xf, y: 0x0, depth: 2 },
      tail: { x: -0x41, y: 0x64, r: -0.4, depth: 1 },
      wags_tongue: { x: 0x3e, y: -0x26, depth: 3 },
      wags_hat:    { x: 0x26, y: -0xa7, scale: 0.9, depth: 6 },

      // Cake — container + internal layer offsets
      collectibleContainer: { x: 0x47e, y: 0x320, scale: 0.9 },
      round_base:                 { x: 0, y: 0, depth: 2 },
      base_white_top_layer:       { x: 0, y: -0xa0, depth: 4 },
      base_white_bottom_layer:    { x: 0, y: -0x37, depth: 3 },
      base_pink_top_layer:        { x: 0, y: -0xa0, depth: 4 },
      base_pink_bottom_layer:     { x: 0, y: -0x37, depth: 3 },
      frosting_blue_bottom:       { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_blue_top:          { x: 0, y: -0xbe, scale: 1, depth: 4 },
      frosting_pink_bottom:       { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_pink_top:          { x: 0, y: -0xbe, scale: 1, depth: 4 },
      frosting_purple_bottom:     { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_purple_top:        { x: 0, y: -0xbe, scale: 1, depth: 4 },
      frosting_yellow_bottom:     { x: 0, y: -0x64, scale: 1, depth: 4 },
      frosting_yellow_top:        { x: 0, y: -0xbe, scale: 1, depth: 4 },
      topping_strawberry_layer_01:{ x: 0, y: -0xe6, scale: 1, depth: 5 },
      topping_strawberry_layer_02:{ x: 0, y: -0x82, scale: 1, depth: 5 },
      topping_strawberry_layer_03:{ x: 0, y: -0x14, scale: 1, depth: 5 },
      topping_treats_layer_01:    { x: 0, y: -0xe6, scale: 1, depth: 5 },
      topping_treats_layer_02:    { x: 0, y: -0x82, scale: 1, depth: 5 },
      topping_treats_layer_03:    { x: 0, y: -0x14, scale: 1, depth: 5 },

      playNow_Btn: { x: 0x3c0, y: 0x3ac, scale: 0.65 },
      cta: { x: 0x3c0, y: 0x3d4, scale: 0.9 },
    };

  }

  // Draw the config-driven background layers (same logic as GameScene) so the end
  // scene's backdrop matches the game and the editor's End-scene preview.
  renderBackgroundLayers() {
    const config = window.LEVEL_CONFIG || {};
    const sceneId = 'end';
    const layers = (config.background && config.background.layers) || [];
    const W = this.scale.width, H = this.scale.height;
    const isLandscape = W > H;
    this._ctaImgs = [];   // CTA button images on this scene (for the hand pointer)
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
        if (p.r) img.setRotation(p.r);
      }
      if (window.applyItemAnim) window.applyItemAnim(this, img, window.layerSceneAnim ? window.layerSceneAnim(L, sceneId) : null);
      if (L.cta) {
        img.setInteractive({ useHandCursor: true });
        img.on('pointerdown', () => this.clickOut && this.clickOut());
        this._ctaImgs.push({ img, L });
      }
    });
  }

  // Build the hand-tap animation from hand_000..hand_004 if not already created.
  _ensureHandAnimation() {
    if (this.anims.exists('hand_animation')) return true;
    const frames = [];
    for (let i = 0; i <= 10; i++) {
      const key = 'hand_' + String(i).padStart(3, '0');
      if (this.textures.exists(key)) frames.push({ key });
    }
    if (frames.length < 2) return false;
    this.anims.create({ key: 'hand_animation', frames, frameRate: 10, repeat: 2 });
    return true;
  }

  // Animated hand pointer that taps a CTA button (3 cycles → hide → re-show),
  // the same loop as the gameplay hint. Enabled per CTA via its "show hand" flag.
  _attachCtaHand(targetImg) {
    if (!targetImg || !this.textures.exists('hand_000') || !this._ensureHandAnimation()) return;
    const hand = this.add.sprite(0, 0, 'hand_000')
      .setOrigin(0.3, 0.0).setScale(0.7)
      .setDepth((targetImg.depth || 90) + 1).setVisible(false);
    this._ctaHand = hand;
    const show = () => {
      if (!hand.scene) return;
      // Same offset as the gameplay hand on cards: slightly right + above centre.
      hand.setPosition(targetImg.x + 15, targetImg.y - 40);
      hand.setVisible(true);
      hand.play('hand_animation');
    };
    hand.on('animationcomplete', (anim) => {
      if (!anim || anim.key !== 'hand_animation') return;
      hand.setVisible(false);
      this.time.delayedCall(1500, show);
    });
    this.time.delayedCall(900, show);   // first tap after the end card settles
  }

  // Minimal end card for engine builds — mirrors the editor's End scene: main_bg
  // (cover) + per-scene background images + logo + win title + CTA. No themed art.
  _createEngineEndCard() {
    const config = window.LEVEL_CONFIG || {};
    const il = this.scale.width > this.scale.height;

    // Cover background, then the config-driven background-layer images (scene 'end').
    if (this.textures.exists('main_bg')) {
      const bg = this.add.image(this.scale.width / 2, this.scale.height / 2, 'main_bg').setDepth(0);
      bg.setScale(Math.max(this.scale.width / bg.width, this.scale.height / bg.height));
      this.main_bg = bg;
    }
    this.renderBackgroundLayers();

    // Logo — same position the editor draws it (the level layout's logo slot).
    const llayout = config[il ? 'landscape' : 'portrait'] || {};
    const logoPos = llayout.logo;
    if (logoPos && this.textures.exists('logo')) {
      this.logo = this.add.image(logoPos.x, logoPos.y, 'logo')
        .setScale(logoPos.scale != null ? logoPos.scale : 0.5).setDepth(100);
      if (window.applyItemAnim) window.applyItemAnim(this, this.logo, logoPos.anim);
    }

    // Win title — read from end_card.title_pos in the editor.
    this.createWinTitle();

    // No built-in CTA button. Place a "CTA button" item on the End scene for a
    // tappable store button (rendered by renderBackgroundLayers above). The whole
    // end card is still tappable as a fallback, and gameEnd fires shortly after.
    this.input.on('pointerdown', () => this.clickOut && this.clickOut());
    if (window.gameEnd) this.time.delayedCall(900, () => window.gameEnd());

    // Hand pointer on a CTA button that has "show hand pointer" enabled.
    const handCta = (this._ctaImgs || []).find(c => c.L.hand);
    if (handCta) this._attachCtaHand(handCta.img);

    // Rebuild on orientation flip so positions track the new layout. off→on so
    // the listener stays single across restarts (the scale manager is global).
    this._engLandscape = il;
    this.scale.off('resize', this._engEndResize, this);
    this.scale.on('resize', this._engEndResize, this);
    if (typeof SoundControls !== 'undefined') SoundControls.attach(this);
  }

  _engEndResize() {
    const land = this.scale.width > this.scale.height;
    if (this._engLandscape === land) return;
    this._engLandscape = land;
    this.scene.restart({ won: this.won });
  }

  create(data) {
    // End card is on screen → ENDCARD_SHOWN (deduped window-side).
    window.trackAL && window.trackAL('ENDCARD_SHOWN');

    const cakeData = data || {};
    this.revealedCakeLayers = new Set(cakeData.revealedCakeLayers || []);
    this.won = cakeData.won !== false; // win unless explicitly a dead-board loss

    // Engine builds render a minimal end card that matches the editor's End scene
    // exactly — just background, logo, win title and CTA — with none of the themed
    // wags/cake/reward/banner art of the one-ring playables.
    if ((window.LEVEL_CONFIG || {}).engine_end_card) { this._createEngineEndCard(); return; }

    const isLandscape = this.scale.width > this.scale.height;

    // Per-key deep merge: config end_layout overrides base layout per key,
    // so themes (e.g. pizza) can override collectibleContainer position and add
    // reward layer positions while inheriting all Wags/UI positions.
    const configEndLayout = ((window.LEVEL_CONFIG || {}).end_layout || {})[isLandscape ? 'landscape' : 'portrait'] || {};
    const baseLayout = isLandscape ? this.LAYOUT_LANDSCAPE : this.LAYOUT_PORTRAIT;
    const layout = {};
    for (const key of Object.keys(baseLayout)) {
      layout[key] = configEndLayout[key] ? { ...baseLayout[key], ...configEndLayout[key] } : baseLayout[key];
    }
    for (const key of Object.keys(configEndLayout)) {
      if (!(key in layout)) layout[key] = configEndLayout[key];
    }

    // Load character config from LEVEL_CONFIG (theme-specific)
    const charConfig = (window.LEVEL_CONFIG || {}).character || {};
    this.WAGS_TEXTURES = charConfig.end_textures || {
      wags: 'wags_3', wags_L_eyeball: 'left_eyeball', wags_R_eyeball: 'right_eyeball',
      wags_L_pupil: 'left_pupil', wags_R_pupil: 'right_pupil',
      wags_Leyelash: 'left_eyelash', wags_Reyelash: 'right_eyelash',
      wags_tongue: 'tongue', tail: 'tail', wags_hat: 'birthday_hat',
    };
    this.WAGS_ORIGINS = charConfig.end_origins || {
      tail: [1, 1], wags_tongue: [0.5, 0], wags_Leyelash: [1, 0], wags_Reyelash: [1, 0],
    };

    // Background — same as the game (and the editor's End preview): the main_bg
    // image plus every config-driven background layer (e.g. the throne-room art),
    // so the end scene's backdrop matches what you arranged in the editor.
    if (this.textures.exists('main_bg')) {
      const bg = this.add.image(this.scale.width / 2, this.scale.height / 2, 'main_bg')
        .setDepth(0);
      const scaleX = this.scale.width / bg.width;
      const scaleY = this.scale.height / bg.height;
      bg.setScale(Math.max(scaleX, scaleY));
      this.main_bg = bg;
    }
    this.renderBackgroundLayers();

    // Table/surface foreground layer (config-driven, optional)
    if (layout.table_bg && this.textures.exists('table_bg')) {
      const tbPos = layout.table_bg;
      this.table_bg = this.add.image(tbPos.x, tbPos.y, 'table_bg')
        .setScale(tbPos.scale || 1)
        .setDepth(tbPos.depth || 2);
    }

    // Logo
    if (layout.logo && this.textures.exists('logo')) {
      this.logo = this.add.image(layout.logo.x, layout.logo.y, 'logo')
        .setScale(layout.logo.scale)
        .setDepth(100)
        .setAlpha(0);
    }

    // Banners
    if (this.textures.exists('banner_happy_birthday')) {
      this.banner_hbd = this.add.image(layout.banner_hbd.x, layout.banner_hbd.y, 'banner_happy_birthday')
        .setScale(layout.banner_hbd.scale)
        .setDepth(100)
        .setAlpha(0);
    }
    if (this.textures.exists('banner_wags')) {
      this.banner_wags = this.add.image(layout.banner_wags.x, layout.banner_wags.y, 'banner_wags')
        .setScale(layout.banner_wags.scale)
        .setDepth(100)
        .setAlpha(0);
    }

    // Balloons
    if (this.textures.exists('balloons_left')) {
      this.balloon_left = this.add.image(layout.balloon_left.x, layout.balloon_left.y, 'balloons_left')
        .setScale(layout.balloon_left.scale)
        .setDepth(layout.balloon_left.depth || 50);
    }
    if (this.textures.exists('balloons_right')) {
      this.balloon_right = this.add.image(layout.balloon_right.x, layout.balloon_right.y, 'balloons_right')
        .setScale(layout.balloon_right.scale)
        .setDepth(layout.balloon_right.depth || 50);
    }

    // Cake
    this.createCake(layout);

    // Wags
    this.createWags(layout);

    // Counter (table background — below wags and cake)
    if (this.textures.exists('counter')) {
      this.add.image(layout.counter.x, layout.counter.y, 'counter')
        .setDepth(20);
    }

    // CTA button
    this.createCTA(layout);

    // Win title (collectible-free themes)
    this.createWinTitle();

    // Reward chest beside Wags (win only)
    this.createRewardBox(layout);

    // Confetti particles
    this.createParticleEmitters();

    // Start celebration animation
    this.startCelebration();

    // Resize handler
    this.scale.on('resize', this.onOrientationChange, this);

    // Mute toggles (music + SFX) — bgm started in GameScene keeps playing here,
    // so the music toggle controls that same instance.
    if (typeof SoundControls !== 'undefined') SoundControls.attach(this);
  }

  createCake(layout) {
    const cakePos = layout.collectibleContainer;
    if (!cakePos) return;

    this.collectibleContainer = this.add.container(cakePos.x, cakePos.y)
      .setScale(cakePos.scale || 1)
      .setDepth(30);

    const rewardConfig = (window.LEVEL_CONFIG || {}).reward || {};
    const cakeParts = rewardConfig.parts || [];
    const basePart = rewardConfig.base_part || 'round_base';

    const hasRevealData = this.revealedCakeLayers && this.revealedCakeLayers.size > 0;
    cakeParts.forEach(part => {
      if (!this.textures.exists(part)) return;

      const pos = layout[part] || { x: 0, y: 0 };
      const sprite = this.add.image(pos.x || 0, pos.y || 0, part)
        .setOrigin(0.5);
      if (pos.scale) sprite.setScale(pos.scale);
      if (pos.depth) sprite.setDepth(pos.depth);

      // Show base always; other layers only if revealed (or no data = show all)
      if (hasRevealData && part !== basePart && !this.revealedCakeLayers.has(part)) {
        sprite.setVisible(false);
      }

      this[part] = sprite;
      this.collectibleContainer.add(sprite);
    });
  }

  createWags(layout) {
    if (!layout.wags_container) return;

    const wc = layout.wags_container;
    this.wags_container = this.add.container(wc.x, wc.y)
      .setScale(wc.scale || 1)
      .setDepth(50);

    const charConfig = (window.LEVEL_CONFIG || {}).character || {};
    const parts = charConfig.end_parts || [
      'wags_L_eyeball', 'wags_R_eyeball', 'wags_L_pupil', 'wags_R_pupil',
      'wags_Leyelash', 'wags_Reyelash', 'tail', 'wags', 'wags_tongue', 'wags_hat',
    ];

    parts.forEach(part => {
      const pos = layout[part];
      if (!pos) return;

      let texKey = this.WAGS_TEXTURES[part] || part;
      // For 'wags' part, use the first dance animation frame as initial texture
      // (and create as Sprite so we can play the looping dance anim)
      if (part === 'wags' && this.textures.exists('wags_dance_01')) {
        texKey = 'wags_dance_01';
      }
      if (!this.textures.exists(texKey)) return;

      const origin = this.WAGS_ORIGINS[part] || [0.5, 0.5];
      // 'wags' needs to be a Sprite (not Image) to support anims.play()
      const sprite = part === 'wags'
        ? this.add.sprite(pos.x, pos.y, texKey).setOrigin(origin[0], origin[1])
        : this.add.image(pos.x, pos.y, texKey).setOrigin(origin[0], origin[1]);
      if (pos.scale) sprite.setScale(pos.scale);
      if (pos.r) sprite.setRotation(pos.r);
      if (pos.depth) sprite.setDepth(pos.depth);

      this[part] = sprite;
      this.wags_container.add(sprite);
    });

    // ===== Real DANCE animation — Veo-generated 18-frame loop =====
    if (this.won && this.wags && this.wags.play) {
      // Build the dance anim here if it wasn't registered globally
      if (!this.anims.exists('wags_dance')) {
        const frames = [];
        for (let i = 1; i <= 18; i++) {
          const k = `wags_dance_${String(i).padStart(2, '0')}`;
          if (this.textures.exists(k)) frames.push({ key: k });
        }
        if (frames.length >= 2) {
          this.anims.create({ key: 'wags_dance', frames, frameRate: 9, repeat: -1 });
        }
      }
      if (this.anims.exists('wags_dance')) {
        this.wags.play({ key: 'wags_dance', repeat: -1 });
      }
    }

    // (Skipping the old bounce-chain tween — the anim provides the motion)
    if (false && this.won && this.wags_container) {
      const baseY  = this.wags_container.y;
      const baseSc = this.wags_container.scaleX;

      // Bounce chain — same animation grammar as the gameplay scene but bigger:
      // anticipation → rise (stretch) → peak → fall → land (squash) → recover → pause
      this.tweens.chain({
        targets: this.wags_container,
        loop: -1,
        tweens: [
          // Anticipation — pre-squash crouch (volume preserved)
          { scaleX: baseSc * 1.05, scaleY: baseSc * 0.94, duration: 110, ease: 'Sine.easeIn' },
          // Rise — stretch up (slim & tall)
          { y: baseY - 30, scaleX: baseSc * 0.96, scaleY: baseSc * 1.08,
            duration: 250, ease: 'Back.easeOut' },
          // Hold at peak briefly
          { y: baseY - 30, scaleX: baseSc * 0.96, scaleY: baseSc * 1.08, duration: 60 },
          // Fall — back to neutral
          { y: baseY, scaleX: baseSc, scaleY: baseSc, duration: 220, ease: 'Sine.easeIn' },
          // Squash on landing — wide and short, then recover (overshoot)
          { scaleX: baseSc * 1.12, scaleY: baseSc * 0.86, duration: 80, ease: 'Quad.easeOut' },
          { scaleX: baseSc, scaleY: baseSc, duration: 150, ease: 'Back.easeOut' },
          // Pause between dance moves
          { duration: 140 },
        ],
      });

      // Rotation wobble at a different cadence — overlapping motion = organic, not mechanical
      this.tweens.add({
        targets: this.wags_container,
        rotation: { from: -0.06, to: 0.06 },
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Tail wag
    if (this.tail) {
      this.tweens.add({
        targets: this.tail,
        rotation: -0.4,
        duration: 200,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.tweens.add({
            targets: this.tail,
            angle: 10,
            duration: 300,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        },
      });
    }

    // Tongue animation
    if (this.wags_tongue) {
      this.tweens.add({
        targets: this.wags_tongue,
        scaleY: 1.2,
        duration: 300,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Eye tracking animation (pupils shift right and back)
    if (this.wags_L_pupil && this.wags_R_pupil) {
      this.tweens.add({
        targets: [this.wags_L_pupil, this.wags_R_pupil],
        x: '+=7',
        duration: 200,
        ease: 'Sine.easeInOut',
        yoyo: true,
        delay: 200,
        hold: 250,
        loop: -1,
        loopDelay: 2500,
      });
    }

    // Eye blinking — eyelashes start closed, then blink open/closed
    if (this.wags_Leyelash) this.wags_Leyelash.scaleY = 0;
    if (this.wags_Reyelash) this.wags_Reyelash.scaleY = 0;
    this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => {
        const targets = [this.wags_Leyelash, this.wags_Reyelash].filter(Boolean);
        if (targets.length > 0) {
          this.tweens.add({
            targets,
            scaleY: 1,
            duration: 150,
            yoyo: true,
            ease: 'Sine.easeInOut',
          });
        }
      },
    });
  }

  createCTA(layout) {
    const endCard = (window.LEVEL_CONFIG || {}).end_card || {};
    const il = this.scale.width > this.scale.height;
    // Config-driven CTA position/scale (editable in the engine editor), else layout default.
    const cp = ((endCard.cta_pos || {})[il ? 'landscape' : 'portrait']) || {};
    const ctaPos = Object.assign({ x: this.scale.width / 2, y: this.scale.height * 0.8 }, layout.cta || {}, cp);

    const ctaText = this.won ? endCard.cta_text : (endCard.lose_cta_text || endCard.cta_text);

    // Prefer an embedded CTA button image (play_button, e.g. the Wags PLAY NOW
    // art); fall back to a drawn text CTA when no image is supplied.
    if (this.textures.exists('play_button')) {
      const img = this.add.image(ctaPos.x, ctaPos.y, 'play_button')
        .setDepth(200).setInteractive().setAlpha(0);
      img.setScale(ctaPos.scale || Math.min(1, (this.scale.width * 0.55) / img.width));
      this.ctaButton = img;
    } else if (ctaText) {
      this.createTextCTA(ctaPos, ctaText, this.won);
      return;
    } else if (this.textures.exists('playNow_Btn')) {
      const btnPos = layout.playNow_Btn || ctaPos;
      this.ctaButton = this.add.image(btnPos.x, btnPos.y, 'playNow_Btn')
        .setScale(btnPos.scale || 1)
        .setDepth(200)
        .setInteractive()
        .setAlpha(0);
    }

    if (this.ctaButton) {
      this.ctaButton.on('pointerdown', () => this.clickOut());
    }

    // Also allow tapping anywhere
    this.input.on('pointerdown', () => this.clickOut());
  }

  // Largest scale <= 1 that keeps a text object within maxWidth (1 if it fits).
  fitScale(textObj, maxWidth) {
    return Math.min(1, maxWidth / textObj.width);
  }

  // Drawn CTA button (e.g. "DOWNLOAD NOW" / "TRY AGAIN") — no texture needed.
  createTextCTA(pos, text, won) {
    const il = this.scale.width > this.scale.height;
    const bw = il ? 470 : 760;
    const bh = il ? 112 : 176;
    const fillTop    = won ? 0x46c863 : 0xffa047;  // bright top
    const fillBottom = won ? 0x1f7f30 : 0xb15a0e;  // dark bottom (3D depth)
    const strokeCol  = won ? '#1b5e20' : '#8a4b00';
    const cont = this.add.container(pos.x, pos.y).setDepth(205).setAlpha(0).setScale(0.92);

    // Layered 3D button — drop shadow, dark base, main face (top half lighter), top highlight
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.32);
    shadow.fillRoundedRect(-bw / 2 + 4, -bh / 2 + 10, bw, bh, bh / 2);   // soft offset shadow

    const base = this.add.graphics();
    base.fillStyle(fillBottom, 1);
    base.fillRoundedRect(-bw / 2, -bh / 2 + 6, bw, bh, bh / 2);          // dark base (the 3D "side")

    const face = this.add.graphics();
    face.fillStyle(fillTop, 1);
    face.fillRoundedRect(-bw / 2, -bh / 2, bw, bh - 4, bh / 2);          // main face

    // Top highlight (slim curved gloss along the upper edge)
    const gloss = this.add.graphics();
    gloss.fillStyle(0xffffff, 0.28);
    gloss.fillRoundedRect(-bw / 2 + 10, -bh / 2 + 6, bw - 20, bh * 0.35, bh * 0.25);

    // Gold outer stroke
    const stroke = this.add.graphics();
    stroke.lineStyle(8, 0xf9a825, 1);
    stroke.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);

    const label = this.add.text(0, -2, text, {
      fontFamily: 'Arial, "Helvetica Neue", sans-serif', fontStyle: 'bold',
      fontSize: (il ? 50 : 78) + 'px', color: '#ffffff', stroke: strokeCol, strokeThickness: 6,
    }).setOrigin(0.5);
    // Auto-fit so long CTAs (e.g. "CLAIM YOUR CROWN") stay inside the button.
    label.setScale(this.fitScale(label, bw - bh * 0.6));

    cont.add([shadow, base, face, gloss, stroke, label]);
    // For interactive geom (matching old behavior)
    const g = stroke;
    cont.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
    cont.on('pointerdown', () => this.clickOut());
    this.customCta = cont; // not this.ctaButton — keep startCelebration's image logic out of it
    this.tweens.add({
      targets: cont, alpha: 1, scale: 1, duration: 450, delay: 900, ease: 'Back.easeOut',
      onComplete: () => {
        if (window.gameEnd) window.gameEnd();
        this.tweens.add({ targets: cont, scale: { from: 1, to: 1.10 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      },
    });
  }

  // Floating end title (no plate/button) — win or lose variant.
  createWinTitle() {
    const ec = (window.LEVEL_CONFIG || {}).end_card || {};
    const title = this.won ? (ec.title || 'You Win!') : (ec.lose_title || 'Try Again');
    if (!title) return;
    const il = this.scale.width > this.scale.height;
    // Config-driven position/size (editable in the engine editor), else defaults.
    const tp = ((ec.title_pos || {})[il ? 'landscape' : 'portrait']) || {};
    const cx = tp.x != null ? tp.x : this.scale.width / 2;
    const cy = tp.y != null ? tp.y : (il ? 0.24 : 0.25) * this.scale.height;
    const fontSize = tp.size != null ? tp.size : (il ? 112 : 168);

    const t = this.add.text(cx, cy, title, {
      fontFamily: 'Arial Black, Arial, sans-serif', fontStyle: 'bold', align: 'center',
      fontSize: fontSize + 'px',
      color: this.won ? '#FFE05A' : '#FFFFFF',
      stroke: this.won ? '#7a3b00' : '#21456b',
      strokeThickness: il ? 16 : 24,
    }).setOrigin(0.5).setDepth(212).setAlpha(0).setScale(0.4)
      .setShadow(0, 10, 'rgba(0,0,0,0.55)', 16, true, true);

    // Auto-fit: long titles (e.g. "You won the crown!") pop in to a scale that
    // keeps them on-screen instead of spilling off the edges.
    const fit = this.fitScale(t, this.scale.width * 0.92);

    this.tweens.add({
      targets: t, alpha: 1, scale: fit, duration: 280, delay: 400, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: t, y: cy - 16, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      }),
    });
  }

  // Reward chest beside Wags on the win screen (win only).
  createRewardBox(layout) {
    if (!this.won || !this.textures.exists('reward_box')) return;
    const il = this.scale.width > this.scale.height;
    const wc = layout.wags_container || { x: this.scale.width * 0.3, y: this.scale.height * 0.82 };
    const x = wc.x + (il ? 370 : 380);
    const y = wc.y + (il ? 40 : 70);
    const target = il ? 0.34 : 0.42;
    const box = this.add.image(x, y, 'reward_box')
      .setOrigin(0.5, 1).setDepth(55).setScale(0).setAlpha(0);
    this.tweens.add({
      targets: box, scale: target, alpha: 1, duration: 600, delay: 750, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: box, y: y - 16, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      }),
    });
  }

  createParticleEmitters() {
    if (!this.won) return; // celebration confetti is win-only
    if (!this.textures.exists('confetti_particle_06')) return;
    if (typeof this.add.particles !== 'function') return;

    const isLandscape = this.scale.width > this.scale.height;
    const layout = isLandscape ? this.LAYOUT_LANDSCAPE : this.LAYOUT_PORTRAIT;

    const emitterConfig = {
      emitZone: {
        type: 'random',
        source: new Phaser.Geom.Line(0, 0, 100, -90),
      },
      speed: { min: 200, max: 720 },
      angle: { min: 0, max: 360 },
      tint: [0xabeee, 0xfdee57, 0xf94b3f, 0xa9f040, 0xfe8429, 0xb9cada],
      tintFill: true,
      scaleX: isLandscape ? [0.6, 1.0, 1.6, 2.0] : [1.4, 1.8, 2.4],
      scaleY: isLandscape ? [0.1, 0.1, 0.2, 1.6] : [0.1, 0.1, 0.2, 2.2, 2.6],
      lifespan: 1500,
      gravityY: 380,
      rotate: { min: 0, max: 360 },
      emitting: false,
    };

    // Emitter positions: use layout keys if defined, else fall back to points
    // spread across the top of the screen (the clean EndScene layout has none).
    const W = this.scale.width, H = this.scale.height;
    const emitterKeys = ['leftEmitter', 'leftEmitter2', 'rightEmitter', 'rightEmitter2'];
    let points = emitterKeys.map(k => layout[k]).filter(Boolean);
    if (points.length === 0) {
      points = [0.12, 0.26, 0.4, 0.5, 0.6, 0.74, 0.88]
        .map(fx => ({ x: W * fx, y: H * 0.08 }));
    }
    const emitters = points.map(pos =>
      this.add.particles(pos.x, pos.y, 'confetti_particle_06', emitterConfig).setDepth(208));

    // Sustained rain: staggered bursts spread over ~4s so it keeps falling
    // (a single burst vanishes too quickly and reads as "weak").
    this.playSound('party_popper_explode');
    this.time.addEvent({
      delay: 400, repeat: 14,    // synced with "You Win!" title — same delay so they pop together
      callback: () => emitters.forEach((e, i) => this.time.delayedCall(55 * i, () => e.explode(24))),
    });
  }

  startCelebration() {
    this.playSound('surprise');

    const isLandscape = this.scale.width > this.scale.height;
    const layout = isLandscape ? this.LAYOUT_LANDSCAPE : this.LAYOUT_PORTRAIT;

    // Zoom camera in
    this.cameras.main.setZoom(1.4);
    this.cameras.main.zoomTo(1, 2000, 'Power2');

    this.time.delayedCall(200, () => {
      // Animate cake to final position
      if (this.collectibleContainer) {
        this.tweens.add({
          targets: this.collectibleContainer,
          x: layout.collectibleContainer.x,
          y: layout.collectibleContainer.y,
          duration: 800,
          ease: 'Power2',
          onComplete: () => this.startWagsAnimation(),
        });
      }

      // Logo fade in
      if (this.logo) {
        this.tweens.add({
          targets: this.logo,
          scale: layout.logo.scale,
          alpha: 1,
          duration: 500,
          ease: 'Power2',
          onComplete: () => {
            this.time.delayedCall(100, () => this.startEyeBlinking && this.startEyeBlinking());
          },
        });
      }

      // Balloons slide in
      if (this.balloon_left) {
        this.tweens.add({
          targets: this.balloon_left,
          x: layout.balloon_left.x,
          alpha: 1,
          duration: 800,
          ease: 'Power2',
        });
      }
      if (this.balloon_right) {
        this.tweens.add({
          targets: this.balloon_right,
          x: layout.balloon_right.x,
          alpha: 1,
          duration: 800,
          ease: 'Power2',
        });
      }

      // Banners
      if (this.banner_hbd) {
        this.tweens.add({
          targets: this.banner_hbd,
          y: layout.banner_hbd.y,
          scaleY: { from: 0.6, to: layout.banner_hbd.scale },
          alpha: 1,
          duration: 500,
          ease: 'Power2',
        });
      }
      if (this.banner_wags) {
        this.tweens.add({
          targets: this.banner_wags,
          y: layout.banner_wags.y,
          scaleY: { from: 0.6, to: layout.banner_wags.scale },
          alpha: 1,
          duration: 500,
          ease: 'Power2',
        });
      }

      // Wags slide in
      if (this.wags_container) {
        this.tweens.add({
          targets: this.wags_container,
          x: layout.wags_container.x,
          alpha: 1,
          duration: 800,
          ease: 'Power2',
          onComplete: () => {
            // Show CTA after wags arrives
            if (this.ctaButton) {
              this.tweens.add({
                targets: this.ctaButton,
                scale: layout.playNow_Btn ? layout.playNow_Btn.scale : (layout.cta.scale || 1),
                alpha: 1,
                duration: 500,
                ease: 'Power2',
                onComplete: () => {
                  if (window.gameEnd) window.gameEnd();

                  // Pulse CTA
                  this.tweens.add({
                    targets: this.ctaButton,
                    scale: { from: 0.65, to: 0.6 },
                    duration: 1000,
                    yoyo: true,
                    repeat: -1,
                  });
                },
              });
            }
          },
        });
      }
    });
  }

  startWagsAnimation() {
    // Wags animation is handled by the tweens set up in createWags
  }

  onOrientationChange() {
    this.reflowForResize({
      width: this.scale.width,
      height: this.scale.height,
    });
  }

  reflowForResize(size) {
    const isLandscape = size.width > size.height;

    // Same deep merge as create() — apply config overrides
    const configEndLayout = ((window.LEVEL_CONFIG || {}).end_layout || {})[isLandscape ? 'landscape' : 'portrait'] || {};
    const baseLayout = isLandscape ? this.LAYOUT_LANDSCAPE : this.LAYOUT_PORTRAIT;
    const layout = {};
    for (const key of Object.keys(baseLayout)) {
      layout[key] = configEndLayout[key] ? { ...baseLayout[key], ...configEndLayout[key] } : baseLayout[key];
    }
    for (const key of Object.keys(configEndLayout)) {
      if (!(key in layout)) layout[key] = configEndLayout[key];
    }

    // Reposition main_bg with cover-fit
    if (this.main_bg) {
      this.main_bg.setPosition(size.width / 2, size.height / 2).setOrigin(0.5, 0.5);
      const scaleX = size.width / this.main_bg.texture.getSourceImage().width;
      const scaleY = size.height / this.main_bg.texture.getSourceImage().height;
      this.main_bg.setScale(Math.max(scaleX, scaleY));
    }

    // Cake layer list for special handling — from config
    const rewardConfig = (window.LEVEL_CONFIG || {}).reward || {};
    const cakeLayerKeys = rewardConfig.parts || [];

    // Reposition all elements that exist in layout
    for (const key in layout) {
      if (!this[key] || !layout.hasOwnProperty(key)) continue;

      const { x, y, scale, alpha, depth, r } = layout[key];

      if (cakeLayerKeys.includes(key)) {
        // Cake layers: update position within container
        this[key].setPosition(x, y);
        if (scale) this[key].setScale(scale);
        if (alpha !== undefined) this[key].setAlpha(alpha);
        if (depth) this[key].setDepth(depth);
      } else {
        // UI elements + wags: update position
        this[key].setPosition(x, y).setRotation(r || 0);
        if (scale) this[key].setScale(scale);
        if (alpha !== undefined) this[key].setAlpha(alpha);
        if (depth) this[key].setDepth(depth);
      }
    }
  }
}
