/**
 * obstacle.js — Obstacle logic registry for the playable engine
 * =============================================================
 * One source of truth for all 12 Royal-Tripeaks obstacles (from
 * PlayableAds_Obstacle_Kit). Each entry documents HOW the obstacle works and
 * implements its logic as small pure hooks that plug into the dependency-graph
 * + ±1-match engine (GameState / GameScene).
 *
 * Runtime model passed to the hooks (`S`):
 *   {
 *     removed: Set<cardId>,     // cards already cleared
 *     headRank: 1..13,          // current talon/head rank (0 = none yet)
 *     headSuit: 'spades'|'hearts'|'diamonds'|'clubs'|null,
 *     headColor: 'red'|'black'|null,
 *     rankOf(cardId)->1..13, suitOf(cardId)->suit, colorOf(cardId)->'red'|'black',
 *     state: {}                 // per-obstacle scratch (counters, lifted flags…)
 *   }
 *
 * Hooks (all optional; sensible defaults applied):
 *   blocked(ob, cardId, S)      -> true if the card cannot be played yet
 *                                  (lock/curtain/shield/kite gates). Default false.
 *   matches(ob, cardId, S)      -> true | false | null. Overrides the ±1 rule:
 *                                  true = playable vs head, false = not,
 *                                  null = fall back to normal ±1 rank match.
 *   onAnyPlay(ob, cardId, playedId, S)  // side effects when some card is played
 *   onMove(ob, cardId, S)               // per move (e.g. bomb counter)
 *   dependencyEdges(cardId, ob) -> [[card, blocker], …]  // static graph edges to
 *                                  inject at build time (lock←key, rope partner).
 *   loses(ob, cardId, S)        -> true if this obstacle has failed the level
 *                                  (bomb reached 0).
 *
 * `params` drives the editor UI; `assets` lists the kit art folder for reference.
 * Exposed as window.PE.obstacle (and module.exports for Node/editor).
 */
(function () {
  // ---- rank / suit / color helpers ------------------------------------------
  const RANKS = { a: 1, j: 11, q: 12, k: 13 };
  function rankFromFace(face) {
    const m = String(face || '').match(/_(\d+|[ajqk])$/i);
    if (!m) return 0;
    const r = m[1].toLowerCase();
    return RANKS[r] || parseInt(r, 10) || 0;
  }
  function suitFromFace(face) {
    const m = String(face || '').match(/^(spades?|hearts?|diamonds?|clubs?)/i);
    if (!m) return null;
    const s = m[1].toLowerCase();
    return s.startsWith('spade') ? 'spades' : s.startsWith('heart') ? 'hearts'
      : s.startsWith('diamond') ? 'diamonds' : 'clubs';
  }
  const colorOfSuit = (s) => (s === 'hearts' || s === 'diamonds') ? 'red' : (s ? 'black' : null);
  // ±1 with King↔Ace wrap.
  function isPlusMinusOne(a, b) {
    if (!a || !b) return false;
    const d = Math.abs(a - b);
    return d === 1 || d === 12;
  }

  const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
  const cardParam = (key, label) => ({ key, label, type: 'card' });
  const num = (key, label, def) => ({ key, label, type: 'number', default: def });
  const choice = (key, label, options, def) => ({ key, label, type: 'select', options, default: def });

  // ---- the 12 obstacles ------------------------------------------------------
  const OBSTACLES = {

    LOCK_AND_KEY: {
      label: 'Lock & Key', unlocks: 6, assets: '01_LOCK_AND_KEY_CARD',
      desc: 'A closed door covers the card. It sits face-up but rejects taps until the ' +
            'Key card is collected: the key flies to the door, the door opens, and the ' +
            'card behind is revealed and becomes playable.',
      params: [cardParam('key', 'Key card id')],
      // Face-up but blocked until the key card has been collected.
      blocked: (ob, id, S) => ob.key ? !S.removed.has(ob.key) : false,
      faceUp: true,   // shown face-up from the start (door visible), not dealt face-down
    },

    DOUBLE_VALUE_CARD: {
      label: 'Double Value', unlocks: 51, assets: '02_DOUBLE_VALUE_CARD',
      desc: 'Shows two consecutive ranks (e.g. Q/J) that REPLACE the card\'s printed ' +
            'value. Rendered ~1.35× larger. Plays if the head is ±1 of EITHER value, ' +
            'and as the head it can be matched on either. Configure the lower value ' +
            '(J/Q/K → pairs Q+J, K+Q, A+K).',
      params: [choice('value', 'Lower value', ['j', 'q', 'k'], 'q')],
      // The two-value match is handled directly by GameState.rankValuesOf so the
      // card matches (and is matched as the head) on BOTH values — no single-head
      // hook here, which could only see one head value.
      enlarge: 1.35,
    },

    TRAP_CARD: {
      label: 'Trap (rope)', unlocks: 61, assets: '03_TRAP_CARD',
      desc: 'Rope-bound card. It is BLOCKED (un-tappable) while roped. When the talon ' +
            'head is ±1 of its value the rope becomes cuttable: tapping the head sends ' +
            'it to the trap and slices the rope, freeing the card — which then plays as ' +
            'a normal ±1 card. One-hit unlock, no counter.',
      params: [],
      // Blocked until its rope has been cut (scratch flag set by GameScene). After
      // cutting it matches on the normal ±1 rule (no override).
      blocked: (ob, id, S) => !S.state['trap:' + id],
    },

    BALLOON_BASKET: {
      label: 'Balloon Basket', unlocks: 71, assets: '04_BALLOON_BASKET', advanced: true,
      desc: 'Optional side objective: up to 4 balloons hold cards; match them like ' +
            'board cards to pop them and earn the prize basket. Not a board-card gate.',
      params: [num('balloons', 'Balloon count', 4)],
      matches: () => null,
    },

    MIRROR_CARD: {
      label: 'Mirror', unlocks: 81, assets: '05_MIRROR_CARD',
      desc: 'A gold frame (Mirror Card_256) + glass mirror (Mirror Card 01) sit over the ' +
            'card and reflect the current head value, re-syncing as the head changes. ' +
            'Tap once to break the mirror (frame + glass vanish with a glow), freezing ' +
            'the card at that value as a normal card; tap again to play it on the ±1 ' +
            'rule. If the head is a wild card it cannot be broken (it shakes).',
      params: [],
      // Locked (un-playable) until the mirror is broken; then it is a plain card
      // frozen at the value it mirrored and plays on the normal ±1 rule.
      blocked: (ob, id, S) => !S.state['mirror:' + id],
    },

    COLOR_CARD: {
      label: 'Color Curtain', unlocks: 101, assets: '06_COLOR_CARD',
      desc: 'A red/black curtain (roller + cloth) hides the card and blocks it. When the ' +
            'talon head is the SAME COLOR (rank ignored; a matching-colour wild also works), ' +
            'tapping the head sends it to the curtain and splits it open (cut halves), ' +
            'revealing the card — which then plays as a normal ±1 card.',
      params: [choice('color', 'Curtain color', ['red', 'black'], 'red')],
      // Blocked until the curtain has been cut open (scratch flag set by GameScene).
      blocked: (ob, id, S) => !S.state['curtain:' + id],
    },

    ROPE_CARD: {
      label: 'Rope (pair)', unlocks: 131, assets: '07_ROPE_CARD',
      desc: 'Two cards tied together. Playing one auto-collects its partner. Set the ' +
            'partner card id.',
      params: [cardParam('partner', 'Partner card id')],
      onAnyPlay: (ob, id, playedId, S) => { if (playedId === id && ob.partner) S.collectAlso = ob.partner; },
    },

    GEM_SHIELD: {
      label: 'Gem Shield', unlocks: 201, assets: '08_GEM_SHIELD',
      desc: 'A shield with 3 or 5 gem slots. Playing gem-carrying cards fills slots; ' +
            'when full the shield drops and the card is playable. Mark gem cards as the ' +
            '"Gem" obstacle.',
      params: [num('hits', 'Gem slots (3 or 5)', 3)],
      blocked: (ob, id, S) => (S.state[id + ':gems'] || 0) < (ob.hits || 3),
      onAnyPlay: (ob, id, playedId, S) => {
        const o = S.obstacleOf(playedId);
        if (o && o.type === 'GEM') S.state[id + ':gems'] = (S.state[id + ':gems'] || 0) + 1;
      },
    },

    GEM: {
      label: 'Gem (carrier)', assets: '08_GEM_SHIELD',
      desc: 'A normal card carrying a gem. When played, its gem flies to a Gem Shield ' +
            'slot. Plays on normal ±1.',
      params: [choice('color', 'Gem color', ['blue', 'green'], 'blue')],
      matches: () => null,
    },

    COLOR_WILD: {
      label: 'Color Wild', unlocks: 301, assets: '09_COLOR_WILD',
      desc: 'A wild restricted to one color: plays onto any head of its color (rank ' +
            'ignored). As the new head it matches anything of that color.',
      params: [choice('color', 'Wild color', ['red', 'black'], 'red')],
      matches: (ob, id, S) => S.headColor == null ? true : S.headColor === ob.color,
      isWild: true,
    },

    BOMB_CARD: {
      label: 'Bomb (counter)', unlocks: 401, assets: '10_BOMB_CARD',
      desc: 'Carries a counter that drops by 1 every move. Play it (normal ±1) to ' +
            'defuse before it hits 0; at 0 the level is lost.',
      params: [num('fuse', 'Counter start', 10)],
      matches: () => null,
      onMove: (ob, id, S) => {
        if (S.removed.has(id)) return;
        const k = id + ':fuse';
        if (S.state[k] == null) S.state[k] = ob.fuse || 10;
        S.state[k] -= 1;
      },
      loses: (ob, id, S) => !S.removed.has(id) && (S.state[id + ':fuse'] != null) && S.state[id + ':fuse'] <= 0,
    },

    COLOR_SUIT_CARD: {
      label: 'Suit Curtain', unlocks: 801, assets: '11_COLOR_SUIT_CARD',
      desc: 'Like Color Curtain but stricter: a specific suit is shown and only a head ' +
            'card of EXACTLY that suit opens it (tap the head; rank ignored). The card ' +
            'under it then plays as a normal ±1 card.',
      params: [choice('suit', 'Curtain suit', SUITS, 'spades')],
      // Blocked until the curtain has been cut open (scratch flag set by GameScene).
      blocked: (ob, id, S) => !S.state['curtain:' + id],
    },

    KITE_BLOCKER: {
      label: 'Kite Blocker', unlocks: 1001, assets: '12_KITE_BLOCKER', advanced: true,
      desc: 'A cloud hides a group of cards behind kites. Each kite needs a rank, suit ' +
            'or color play to clear; when all kites are cleared the cloud lifts and the ' +
            'hidden cards flip up. Configure kite requirements + covered card ids.',
      params: [
        { key: 'kites', label: 'Kites (e.g. rank:5, suit:hearts, color:red)', type: 'list' },
        { key: 'covers', label: 'Covered card ids', type: 'list' },
      ],
      blocked: (ob, id, S) => {
        // The covered cards are blocked until every kite is cleared.
        const kites = ob.kites || [];
        return !kites.every(k => kiteCleared(k, S));
      },
      onAnyPlay: (ob, id, playedId, S) => {
        (ob.kites || []).forEach(k => {
          if (kiteMatch(k, playedId, S)) S.state['kite:' + JSON.stringify(k)] = true;
        });
      },
    },
  };

  // Kite helpers (rank / suit / color requirement on a played card).
  function kiteMatch(k, playedId, S) {
    const parts = String(k).split(':'); const type = parts[0], val = parts[1];
    if (type === 'rank') return S.rankOf(playedId) === (RANKS[val] || parseInt(val, 10));
    if (type === 'suit') return S.suitOf(playedId) === val;
    if (type === 'color') return S.colorOf(playedId) === val;
    return false;
  }
  function kiteCleared(k, S) { return !!S.state['kite:' + JSON.stringify(k)]; }

  // ---- generic resolver used by the runtime ---------------------------------
  // Given a card's obstacle + state, decide if it is currently playable vs head.
  function isPlayable(ob, cardId, S, normalMatch) {
    if (!ob) return normalMatch;
    const def = OBSTACLES[ob.type];
    if (!def) return normalMatch;
    if (def.blocked && def.blocked(ob, cardId, S)) return false;
    if (def.matches) {
      const m = def.matches(ob, cardId, S);
      if (m === true) return true;
      if (m === false) return false;
    }
    return normalMatch;  // null / undefined → normal ±1 rule
  }

  // Build the extra dependency edges across a level's obstacle map (Lock, Rope).
  function dependencyEdges(obstacleMap) {
    const edges = [];
    for (const [cardId, ob] of Object.entries(obstacleMap || {})) {
      const def = OBSTACLES[ob.type];
      if (def && def.dependencyEdges) edges.push(...def.dependencyEdges(cardId, ob));
    }
    return edges;
  }

  const TYPES = Object.keys(OBSTACLES);

  // ---- art: which kit sprite(s) an obstacle card uses ------------------------
  // Returns { face?, overlay?, counter? } as repo-relative paths into the kit.
  // `face`   replaces the card face; `overlay` is drawn on top of the card.
  const OB_DIR = 'PlayableAds_Obstacle_Kit';
  function resolveArt(ob, cardFace) {
    const color = colorOfSuit(suitFromFace(cardFace));
    const A = (folder, file) => `${OB_DIR}/${folder}/Assets/${file}`;
    switch (ob.type) {
      // The card's face IS the door; opening swaps it to the card's real face.
      case 'LOCK_AND_KEY': return { face: A('01_LOCK_AND_KEY_CARD', 'Lock Card.png') };
      case 'KEY':          return { face: A('01_LOCK_AND_KEY_CARD', 'Key Card.png') };
      case 'DOUBLE_VALUE_CARD': {
        const pair = { j: 'QJ', q: 'KQ', k: 'AK' }[ob.value || 'q'];
        const grp = color === 'red' ? 'Card_Diamond&Heart' : 'Card_Spade&-Club';
        return { face: A('02_DOUBLE_VALUE_CARD', `${grp}_${pair}.png`) };
      }
      case 'TRAP_CARD':    return { overlay: A('03_TRAP_CARD', 'Rope.png') };
      // Glass-frame overlay (semi-transparent); the card face shows the live head value.
      case 'MIRROR_CARD':  return { overlay: A('05_MIRROR_CARD', 'Mirror Card 01.png') };
      case 'COLOR_CARD':   return { overlay: A('06_COLOR_CARD', `curtain_parts/${ob.color === 'black' ? 'Black_plane' : 'Red_plane'}_cloth.png`) };
      case 'COLOR_WILD':   return { face: A('09_COLOR_WILD', `${ob.color === 'black' ? 'Black' : 'Red'}_wild_card.png`) };
      case 'BOMB_CARD':    return { overlay: A('10_BOMB_CARD', 'Bomb.png'), counter: true };
      case 'COLOR_SUIT_CARD': {
        const m = { spades: 'Black_Spades', hearts: 'Red_heart', diamonds: 'Red_dimond', clubs: 'Black_Club' };
        return { overlay: A('11_COLOR_SUIT_CARD', `curtain_parts/${m[ob.suit || 'spades']}_cloth.png`) };
      }
      case 'GEM_SHIELD':   return { overlay: A('08_GEM_SHIELD', `512px/${(ob.hits || 3) >= 5 ? '5_GemShield/5Gem_BG' : '3_GemShield/Shield-3slots'}.png`) };
      case 'GEM':          return { overlay: A('08_GEM_SHIELD', `1024px/Collectible_${ob.color === 'green' ? 'GreenGem' : 'BlueGem'}.png`) };
      default:             return {};
    }
  }

  // ---- extra animation frames per obstacle type -----------------------------
  // Embedded under stable texture keys `oba_<TYPE>_<name>` so GameScene can play
  // the proper sequences (door opening, rope slicing, curtain cut, explosion…).
  const A2 = (folder, file) => `${OB_DIR}/${folder}/Assets/${file}`;
  const ANIM = {
    LOCK_AND_KEY: {
      open1: A2('01_LOCK_AND_KEY_CARD', 'Blocker_Lock-Door_Open1.png'),
      open2: A2('01_LOCK_AND_KEY_CARD', 'Blocker_Lock-Door_Open2.png'),
      open3: A2('01_LOCK_AND_KEY_CARD', 'Blocker_Lock-Door_Open3.png'),
      key:   A2('01_LOCK_AND_KEY_CARD', 'Blocker-Key.png'),
      glow:  A2('01_LOCK_AND_KEY_CARD', 'Glow Card.png'),
      star:  A2('01_LOCK_AND_KEY_CARD', 'lock_key_parts/star_02.png'),
    },
    TRAP_CARD: {
      slice1: A2('03_TRAP_CARD', 'Slice_Rop1_2.png'),
      slice2: A2('03_TRAP_CARD', 'Slice_Rop2_2.png'),
      broken: A2('03_TRAP_CARD', '1.png'),   // snapped rope pieces shown on the cut
      star:   A2('01_LOCK_AND_KEY_CARD', 'lock_key_parts/star_02.png'),
    },
    BOMB_CARD: { bg: A2('10_BOMB_CARD', 'main_bg.png') },
    MIRROR_CARD: {
      sheen: A2('05_MIRROR_CARD', 'Oval_sheen.png'),
      frame: A2('05_MIRROR_CARD', 'Mirror Card_256.png'),
    },
  };
  // Curtain cut halves (Color + Suit) share the same naming.
  function curtainParts(folder, variant) {
    return {
      left: A2(folder, `curtain_parts/${variant}_Cut_Left.png`),
      right: A2(folder, `curtain_parts/${variant}_cut_Right_.png`),
      roller: A2(folder, `curtain_parts/${variant}_roller.png`),
    };
  }
  // Return { textureKey: path } for every animation frame an obstacle type needs.
  function animAssets(type, ob) {
    const out = {};
    const add = (m) => { for (const k in m) out[`oba_${type}_${k}`] = m[k]; };
    if (ANIM[type]) add(ANIM[type]);
    if (type === 'COLOR_CARD') add(curtainParts('06_COLOR_CARD', (ob && ob.color === 'black') ? 'Black_plane' : 'Red_plane'));
    if (type === 'COLOR_SUIT_CARD') {
      const m = { spades: 'Black_Spades', hearts: 'Red_heart', diamonds: 'Red_dimond', clubs: 'Black_Club' };
      add(curtainParts('11_COLOR_SUIT_CARD', m[(ob && ob.suit) || 'spades']));
    }
    return out;
  }

  const API = {
    OBSTACLES, TYPES, isPlayable, dependencyEdges, resolveArt, animAssets,
    rankFromFace, suitFromFace, colorOfSuit, isPlusMinusOne, kiteMatch, kiteCleared,
  };
  if (typeof window !== 'undefined') (window.PE = window.PE || {}).obstacle = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
