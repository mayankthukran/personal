/**
 * SoundControls.js — Music & SFX mute toggle buttons
 * ===================================================
 * Self-contained, theme-independent audio controls for playable ads, modeled
 * on the mute toggles competitor playables expose (a music note + a speaker).
 *
 * Icons are drawn with Phaser Graphics (no image assets, no font glyphs) so they
 * render identically across ad webviews. Mute state lives on a single global
 * (window.__playableAudio) so it persists across scene transitions and across the
 * one looping bgm instance — toggling on the EndScene affects the bgm started in
 * the GameScene.
 *
 * Integration (kept tiny on the scene side):
 *   - GameScene registers the looping bgm via SoundControls.registerBgm(sound)
 *   - Each scene's playSound() calls SoundControls.canPlaySfx() before any SFX
 *   - Each scene calls SoundControls.attach(this) to draw the buttons
 *
 * Config comes from window.__SOUND_CONTROLS (injected by build_playable.py):
 *   { enabled, corner: 'br'|'bl'|'tr'|'tl', margin, size, gap,
 *     start_music_muted, start_sfx_muted }
 * Disabled automatically for alpha (recording) builds.
 */
const SoundControls = {
  state() {
    if (!window.__playableAudio) {
      window.__playableAudio = { music: false, sfx: false, bgm: null, _init: false };
    }
    return window.__playableAudio;
  },

  config() {
    return window.__SOUND_CONTROLS || {};
  },

  // Apply persisted mute prefs once, from build config defaults.
  initFromConfig() {
    const s = this.state();
    if (s._init) return;
    const cfg = this.config();
    s.music = !!cfg.start_music_muted;
    s.sfx = !!cfg.start_sfx_muted;
    s._init = true;
  },

  canPlaySfx() { return !this.state().sfx; },

  // Track the single looping bgm so music can be (un)muted later without
  // restarting it, and apply any persisted mute preference immediately.
  registerBgm(sound) {
    const s = this.state();
    s.bgm = sound;
    if (sound) sound.setMute(s.music);
  },

  toggleMusic() {
    const s = this.state();
    s.music = !s.music;
    if (s.bgm) s.bgm.setMute(s.music);
    return s.music;
  },

  toggleSfx() {
    const s = this.state();
    s.sfx = !s.sfx;
    return s.sfx;
  },

  // ---- Icon drawing (local coords centered at 0,0; r = button radius) -------

  drawMusicIcon(g, r, muted, fg) {
    const lw = Math.max(4, r * 0.13);
    const x1 = -r * 0.30, x2 = r * 0.34;
    const topY = -r * 0.48, botY = r * 0.30;
    g.lineStyle(lw, fg, 1);
    // Stems joined by a beam at the top (reads as two eighth notes).
    g.beginPath();
    g.moveTo(x1, botY); g.lineTo(x1, topY); g.lineTo(x2, topY); g.lineTo(x2, botY);
    g.strokePath();
    g.beginPath();
    g.moveTo(x1, topY + lw * 1.7); g.lineTo(x2, topY + lw * 1.7);
    g.strokePath();
    // Note heads.
    g.fillStyle(fg, 1);
    g.fillEllipse(x1 - r * 0.13, botY + r * 0.05, r * 0.36, r * 0.27);
    g.fillEllipse(x2 - r * 0.13, botY + r * 0.05, r * 0.36, r * 0.27);
    if (muted) this.drawSlash(g, r, lw, fg);
  },

  drawSpeakerIcon(g, r, muted, fg) {
    const lw = Math.max(4, r * 0.12);
    const bx = -r * 0.58;
    // Speaker body + cone as a single polygon.
    g.fillStyle(fg, 1);
    g.beginPath();
    g.moveTo(bx, -r * 0.18);
    g.lineTo(bx + r * 0.24, -r * 0.18);
    g.lineTo(bx + r * 0.58, -r * 0.46);
    g.lineTo(bx + r * 0.58, r * 0.46);
    g.lineTo(bx + r * 0.24, r * 0.18);
    g.lineTo(bx, r * 0.18);
    g.closePath();
    g.fillPath();
    g.lineStyle(lw, fg, 1);
    if (!muted) {
      // Two sound-wave arcs radiating from the cone.
      const cx = bx + r * 0.58;
      g.beginPath(); g.arc(cx, 0, r * 0.42, -Math.PI / 4, Math.PI / 4); g.strokePath();
      g.beginPath(); g.arc(cx, 0, r * 0.68, -Math.PI / 4, Math.PI / 4); g.strokePath();
    } else {
      // An "x" where the waves would be — the universal muted speaker.
      const wx = bx + r * 0.74;
      g.beginPath(); g.moveTo(wx, -r * 0.22); g.lineTo(wx + r * 0.4, r * 0.22); g.strokePath();
      g.beginPath(); g.moveTo(wx, r * 0.22); g.lineTo(wx + r * 0.4, -r * 0.22); g.strokePath();
    }
  },

  drawSlash(g, r, lw, fg) {
    g.lineStyle(lw, fg, 1);
    g.beginPath();
    g.moveTo(-r * 0.6, -r * 0.6); g.lineTo(r * 0.6, r * 0.6);
    g.strokePath();
  },

  // ---- Button + layout ------------------------------------------------------

  makeButton(scene, cfg, getMuted, onToggle, drawIcon) {
    const r = cfg.size / 2;
    const cont = scene.add.container(0, 0).setDepth(cfg.depth);
    const bg = scene.add.graphics();
    const icon = scene.add.graphics();
    const hit = scene.add.circle(0, 0, r, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    cont.add([bg, icon, hit]);

    const redraw = () => {
      const muted = getMuted();
      bg.clear();
      bg.fillStyle(cfg.bg, cfg.bgAlpha);
      bg.fillCircle(0, 0, r);
      bg.lineStyle(Math.max(2, r * 0.05), cfg.fg, muted ? 0.25 : 0.5);
      bg.strokeCircle(0, 0, r);
      icon.clear();
      icon.setAlpha(muted ? 0.5 : 1);
      drawIcon.call(this, icon, r, muted, cfg.fg);
    };
    redraw();

    hit.on('pointerdown', (pointer, lx, ly, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      onToggle();
      redraw();
    });

    return cont;
  },

  attach(scene) {
    const cfg = Object.assign({
      enabled: true, corner: 'br', margin: 80, size: 96, gap: 30,
      depth: 500, bg: 0x1a1a2e, bgAlpha: 0.55, fg: 0xffffff,
    }, this.config());
    if (cfg.enabled === false) return;

    this.initFromConfig();

    const music = this.makeButton(scene, cfg,
      () => this.state().music, () => this.toggleMusic(), this.drawMusicIcon);
    const speaker = this.makeButton(scene, cfg,
      () => this.state().sfx, () => this.toggleSfx(), this.drawSpeakerIcon);

    const layout = () => {
      const W = scene.scale.width, H = scene.scale.height;
      const r = cfg.size / 2, m = cfg.margin, step = cfg.size + cfg.gap;
      const right = cfg.corner.indexOf('r') !== -1;
      const bottom = cfg.corner.indexOf('b') !== -1;
      const cy = bottom ? H - m - r : m + r;
      // Music note sits inboard of the speaker, matching competitor layouts.
      const edge = right ? W - m - r : m + r;
      const inboard = right ? edge - step : edge + step;
      speaker.setPosition(edge, cy);
      music.setPosition(inboard, cy);
    };
    layout();

    scene.scale.on('resize', layout);
    scene.events.once('shutdown', () => scene.scale.off('resize', layout));
  },
};
