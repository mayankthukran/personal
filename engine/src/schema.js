/**
 * schema.js — JSON input schema, defaults, validation, and shared helpers
 * =======================================================================
 * The Playable Engine is driven by one JSON spec. This module documents the
 * schema, supplies defaults, validates a spec, and provides the face->asset
 * resolver shared by the editor preview and the assembler.
 *
 * Exposed as window.PE.schema (no build step / modules).
 *
 * ---------------------------------------------------------------------------
 * SPEC SHAPE (v1 — difficulty-select):
 * {
 *   name: string,
 *   platform: "applovin" | "google",
 *   canvas:  { portrait:{width,height}, landscape:{width,height} },
 *   scales:  { card:{portrait,landscape}, talon:{portrait,landscape} },
 *   background: { color:"#rrggbb", portrait?:{image,...}, landscape?:{image,...} },
 *   deck: { card_back: "<asset path>" },
 *   start_scene: {                       // omit or {type:"none"} => boot into the single level
 *     type: "difficulty",
 *     title: { text, color, size, y, y_landscape },
 *     options: [ { id, label, color, image?, portrait:{x,y,scale}, landscape:{x,y,scale} } ]
 *   },
 *   levels: {                            // one entry per option id (or a single level for type:"none")
 *     <id>: {
 *       deal:      { style, stagger, duration, curve_height?, from? },  // global card-intro default
 *       animation: { default:{curve_height,first_duration,second_duration}, per_card?:{} },
 *       game_flow: { mode:"dependency", dependencies, initially_playable, deal_order },
 *       talon:     { sequence:[face...], base:{portrait,landscape}, deck:{portrait,landscape} },
 *       cards:     [ { id, face, asset, role, portrait:{x,y,scale,depth,r}, landscape:{...},
 *                      intro?:{ style, ... } } ]
 *     }
 *   },
 *   end_card: { title, cta_text, lose_title, lose_cta_text, store_url }
 * }
 *
 * Card-intro styles: "deal_curve" | "fade" | "slide" | "flip".
 */
(function () {
  const PE = (window.PE = window.PE || {});

  const SAMPLE_URL = 'samples/difficulty-select.json';

  const DEFAULTS = {
    platform: 'applovin',
    canvas: {
      portrait: { width: 1080, height: 1920 },
      landscape: { width: 1920, height: 1080 },
    },
    scales: {
      card: { portrait: 0.35, landscape: 0.27 },
      talon: { portrait: 1.2, landscape: 1.1 },
    },
    background: { color: '#142a6c' },
    animation: { default: { curve_height: 150, first_duration: 400, second_duration: 300 } },
    deal: { style: 'deal_curve', stagger: 60, duration: 450 },
  };

  const INTRO_STYLES = ['deal_curve', 'fade', 'slide', 'flip', 'drop_top'];
  // Friendly labels for the editor's intro dropdown.
  const INTRO_LABELS = {
    deal_curve: 'Deal from talon (curve)',
    fade: 'Fade + scale in',
    slide: 'Slide in from edge',
    flip: 'Flip in at slot',
    drop_top: 'Drop from top — one by one',
  };
  // Ambient / intro animations that can be attached to ANY non-card item
  // (background images, logo, difficulty options). Played by GameScene's
  // global applyItemAnim() helper.
  const ITEM_ANIM_STYLES = ['none', 'float', 'sway', 'pulse', 'spin', 'fade_in', 'pop_in'];
  const ITEM_ANIM_LABELS = {
    none: 'None',
    float: 'Float (up & down)',
    sway: 'Sway (rock side to side)',
    pulse: 'Pulse (scale in/out)',
    spin: 'Spin (rotate forever)',
    fade_in: 'Fade in (once)',
    pop_in: 'Pop in (once)',
  };

  const NETWORKS = ['applovin', 'google', 'meta', 'unityads'];

  // face "heart_9" / "spades_a" -> repo-relative master card PNG path.
  const SUIT_DIR = {
    heart: 'hearts', hearts: 'hearts', spade: 'spade', spades: 'spade',
    club: 'clubs', clubs: 'clubs', diamond: 'diamonds', diamonds: 'diamonds',
  };
  const SUIT_CAP = { hearts: 'Heart', spade: 'Spades', clubs: 'Clubs', diamonds: 'Diamonds' };
  const RANK_CAP = { a: 'A', j: 'J', q: 'Q', k: 'K' };

  function faceToAsset(face) {
    const i = face.indexOf('_');
    if (i < 0) return null;
    const suit = face.slice(0, i), rank = face.slice(i + 1);
    const dir = SUIT_DIR[suit];
    if (!dir) return null;
    const r = RANK_CAP[rank] || rank.toUpperCase();
    return `the-one-ring-main/playables/master/assets/cards/${dir}/${SUIT_CAP[dir]}-${r}.png`;
  }

  // Reverse of faceToAsset: a master card path/filename -> face, e.g.
  // ".../clubs/Clubs-J.png" or "Clubs-J.png" -> "clubs_j". Returns null when the
  // name isn't a recognizable card (so custom art keeps the card's current face).
  const NAME_TO_SUIT = {
    heart: 'hearts', hearts: 'hearts', spade: 'spades', spades: 'spades',
    club: 'clubs', clubs: 'clubs', diamond: 'diamonds', diamonds: 'diamonds',
  };
  function assetToFace(name) {
    if (!name) return null;
    const base = String(name).split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '');
    const m = base.match(/^([A-Za-z]+)[ _-]?([0-9]{1,2}|[AJQKajqk])$/);
    if (!m) return null;
    const suit = NAME_TO_SUIT[m[1].toLowerCase()];
    if (!suit) return null;
    return suit + '_' + m[2].toLowerCase();
  }

  // Apply defaults onto a (possibly partial) spec. Non-destructive copy.
  function withDefaults(spec) {
    const s = JSON.parse(JSON.stringify(spec || {}));
    s.platform = s.platform || DEFAULTS.platform;
    s.network = s.network || s.platform || 'applovin';
    s.canvas = s.canvas || DEFAULTS.canvas;
    s.scales = s.scales || DEFAULTS.scales;
    s.background = s.background || { ...DEFAULTS.background };
    // Multiple background layers, each placed/scaled per orientation. `fit:"cover"`
    // fills the canvas (x/y/scale ignored); otherwise the image is centered at x,y.
    if (!Array.isArray(s.background.layers)) s.background.layers = [];
    s.background.layers.forEach((L, i) => { if (L.id == null) L.id = 'bg' + i; });
    s.levels = s.levels || {};
    for (const id of Object.keys(s.levels)) {
      const lv = s.levels[id];
      lv.animation = lv.animation || DEFAULTS.animation;
      lv.deal = lv.deal || { ...DEFAULTS.deal };
      lv.game_flow = lv.game_flow || { mode: 'dependency' };
      lv.talon = lv.talon || { sequence: [], base: {}, deck: {} };
      lv.cards = lv.cards || [];
      // Fill missing card assets from face. Card intro is GLOBAL now (lv.deal), so
      // strip any legacy per-card `intro` so every card follows the scene's intro.
      lv.cards.forEach(c => {
        if (!c.asset && c.face) c.asset = faceToAsset(c.face);
        if (c.intro) delete c.intro;
      });
    }
    return s;
  }

  // Returns {ok, errors:[...]} — lightweight structural validation.
  function validate(spec) {
    const e = [];
    if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec is not an object'] };
    if (!spec.levels || !Object.keys(spec.levels).length) e.push('levels: at least one level required');
    const ss = spec.start_scene;
    if (ss && ss.type === 'difficulty') {
      const ids = (ss.options || []).map(o => o.id);
      if (ids.length < 1) e.push('start_scene.options: need at least 1 option');
      ids.forEach(id => { if (!spec.levels[id]) e.push(`start_scene option "${id}" has no matching levels.${id}`); });
    }
    for (const [id, lv] of Object.entries(spec.levels || {})) {
      if (!lv.cards || !lv.cards.length) e.push(`levels.${id}.cards: empty`);
      const gf = lv.game_flow || {};
      if (!gf.dependencies && !(gf.deal_order || []).length) {
        e.push(`levels.${id}.game_flow: missing dependencies/deal_order`);
      }
      (lv.cards || []).forEach(c => {
        if (!c.id) e.push(`levels.${id}: a card is missing id`);
        if (!c.face) e.push(`levels.${id}.${c.id || '?'}: missing face`);
        if (c.intro && c.intro.style && !INTRO_STYLES.includes(c.intro.style)) {
          e.push(`levels.${id}.${c.id}: unknown intro style "${c.intro.style}"`);
        }
      });
    }
    return { ok: e.length === 0, errors: e };
  }

  // Collect every unique texture key (face) the spec references, with its path.
  // Returns { face: path }.
  function collectTextures(spec) {
    const out = {};
    for (const lv of Object.values(spec.levels || {})) {
      (lv.cards || []).forEach(c => { out[c.face] = c.asset || faceToAsset(c.face); });
      ((lv.talon || {}).sequence || []).forEach(f => { out[f] = faceToAsset(f); });
    }
    return out;
  }

  PE.schema = {
    SAMPLE_URL, DEFAULTS, INTRO_STYLES, INTRO_LABELS, ITEM_ANIM_STYLES, ITEM_ANIM_LABELS, NETWORKS,
    faceToAsset, assetToFace, withDefaults, validate, collectTextures,
  };
})();
