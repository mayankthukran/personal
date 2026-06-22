/**
 * GameState.js — Pure state machine for solitaire gameplay logic
 * ==============================================================
 * Extracted from GameScene.js to enable unit testing without Phaser.
 * Manages dependency maps, rank matching, card uncovering, and stock/waste.
 *
 * Usage:
 *   const state = new GameState(levelConfig);
 *   state.applyDependencyPlay('spades_2_2');
 *   state.applyStockTap();
 */

class GameState {
  constructor(levelConfig) {
    this.config = levelConfig;
    const gameFlow = levelConfig.game_flow || {};

    // Obstacles: per-card {type, …params, _face/_overlay/_counter}. Playability is
    // gated/extended by obstacle.js (window.PE.obstacle). _obScratch persists
    // per-obstacle state (lifted curtains, gem counts, bomb fuses).
    this.obstacles = levelConfig.obstacles || {};
    this._obScratch = {};

    // Special (variable-value) cards: each successful PLAY ticks their value
    // up or down by 1 (wrapping K<->A). Match-detection uses the live value.
    //   special_cards: { s0: {dir: 'up'|'down', start: <1..13>}, ... }
    this.specialCards = levelConfig.special_cards || {};
    this.specialValues = {};
    for (const [k, s] of Object.entries(this.specialCards)) {
      this.specialValues[k] = s.start;
    }

    // Dependency maps
    this.dependencyMap = {};   // card -> [blockers]
    this.reverseDepMap = {};   // card -> [cards it blocks]
    this.removedCards = new Set();

    // Talon deck state
    this.talonDeckCards = gameFlow.talon_sequence ? [...gameFlow.talon_sequence] : [];
    this.talonCurrentIndex = this.talonDeckCards.length >= 2
      ? this.talonDeckCards.length - 2
      : -1;

    // Current top card (last in talon sequence is initially face-up)
    // True once any head card has ever been on the talon. Used so that a CLEARED
    // head (e.g. after a trap consumes it with no stock left) makes cards
    // un-playable rather than all-playable.
    this._everHadHead = this.talonDeckCards.length > 0;
    // The waste pile in order — each card that has been the talon head, top last.
    // When the head card leaves to cut an obstacle it is popped and the card now on
    // top (the previous waste card) becomes the new head.
    this.wasteStack = [];
    if (this.talonDeckCards.length > 0) {
      this.currentTopCard = this.talonDeckCards[this.talonDeckCards.length - 1];
      this.currentTopRanks = this.rankValuesOf(this.currentTopCard);
      this.currentTopRank = this.currentTopRanks[0];
      this.wasteStack.push(this.currentTopCard);
    } else {
      this.currentTopCard = null;
      this.currentTopRank = 0;
      this.currentTopRanks = [];
    }

    // Uncovered cards (face-up on tableau, all blockers removed)
    this.uncoveredCards = new Set(gameFlow.initially_playable || []);

    // Playable cards (uncovered AND rank-matching)
    this.playableCards = new Set();

    // Build dependency maps
    this.buildDependencyMaps(gameFlow.dependencies || {});

    // Count total tableau cards
    const uiKeys = new Set(['talon_base', 'talon_deck']);
    const portrait = levelConfig.portrait || {};
    this.totalTableauCards = Object.keys(portrait).filter(k => !uiKeys.has(k)).length;

    // Initial playable calculation
    this.recalculatePlayable();
  }

  buildDependencyMaps(dependencies) {
    this.dependencyMap = {};
    this.reverseDepMap = {};

    for (const [card, blockers] of Object.entries(dependencies)) {
      this.dependencyMap[card] = [...blockers];
      for (const blocker of blockers) {
        if (!this.reverseDepMap[blocker]) {
          this.reverseDepMap[blocker] = [];
        }
        this.reverseDepMap[blocker].push(card);
      }
    }
  }

  getRankValue(cardKey) {
    // Special cards report their live (ticked) value, not their static face.
    if (this.specialValues && cardKey in this.specialValues) {
      return this.specialValues[cardKey];
    }
    return this.rankValuesOf(cardKey)[0];
  }

  // Every effective rank a card matches on. Normal cards have one; a Double Value
  // obstacle card has TWO consecutive values (lower + upper, K wrapping to A) that
  // fully REPLACE its printed face value — it matches, and is matched, on either.
  rankValuesOf(cardKey) {
    if (this.specialValues && cardKey in this.specialValues) {
      return [this.specialValues[cardKey]];
    }
    const ob = this.obstacles[cardKey];
    if (ob && ob.type === 'DOUBLE_VALUE_CARD') {
      const RANKS = { a: 1, j: 11, q: 12, k: 13 };
      const lo = RANKS[ob.value] || 12;
      const hi = lo === 13 ? 1 : lo + 1;   // K wraps to A
      return [lo, hi];
    }
    // A Mirror card reflects the head value while intact; once broken it FREEZES at
    // the value it was showing and plays as a normal card of that rank.
    if (ob && ob.type === 'MIRROR_CARD') {
      const frozen = this._obScratch['mirror:' + cardKey + ':value'];
      if (frozen != null) return [frozen];
      return [this.currentTopRank || 0];
    }
    return [GameState.parseRank(this.config, cardKey)];
  }

  // Advance every on-board special card one step (wrap 1..13). Called once per
  // successful play. The just-played card is already in removedCards, so skipped.
  tickSpecials() {
    for (const [k, s] of Object.entries(this.specialCards)) {
      if (this.removedCards.has(k)) continue;
      const dir = s.dir === 'down' ? -1 : 1;
      let v = this.specialValues[k] + dir;
      if (v > 13) v = 1;
      if (v < 1) v = 13;
      this.specialValues[k] = v;
    }
  }

  // Parse rank from 'suit_rank' or 'suit_rank_<n>' (uniqueness suffix);
  // e.g. 'spades_10' -> 10, 'spades_a_2' -> 1. Prefers the sprite's
  // texture when available so the suffix is already stripped.
  static parseRank(config, cardKey) {
    const rankMap = {
      'a': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
      '7': 7, '8': 8, '9': 9, '10': 10, 'j': 11, 'q': 12, 'k': 13
    };
    const sprites = (config && config.sprites) || {};
    const sp = sprites[cardKey];
    const tex = sp ? sp.texture : cardKey;
    const m = tex.match(/_(\d+|[ajqk])(?:_\d+)?$/i);
    return m ? (rankMap[m[1].toLowerCase()] || 0) : 0;
  }

  isRankMatch(cardKey) {
    // Both the head and the card can carry two values (Double Value cards), so a
    // match is ANY head-value ±1 of ANY card-value (K↔A wrapping).
    const heads = (this.currentTopRanks && this.currentTopRanks.length)
      ? this.currentTopRanks : [this.currentTopRank];
    // No head on the talon: playable only if a head has never existed yet (initial
    // seeding). Once a head has been on the talon, an empty head blocks all plays.
    if (!heads.some(h => h > 0)) return !this._everHadHead;
    const keys = this.rankValuesOf(cardKey);
    for (const h of heads) {
      if (h <= 0) continue;
      for (const k of keys) {
        if (k <= 0) continue;
        const d = Math.abs(h - k);
        if (d === 1 || d === 12) return true;
      }
    }
    return false;
  }

  // Build the runtime state obstacle.js hooks read from.
  obState(PEo) {
    const sprites = (this.config && this.config.sprites) || {};
    const faceOf = (id) => (sprites[id] && sprites[id].texture) || id;
    const headFace = this.currentTopCard ? faceOf(this.currentTopCard) : null;
    const headSuit = headFace ? PEo.suitFromFace(headFace) : null;
    const headOb = this.currentTopCard ? this.obstacles[this.currentTopCard] : null;
    return {
      removed: this.removedCards,
      headRank: this.currentTopRank,
      headSuit, headColor: PEo.colorOfSuit(headSuit),
      headIsWild: !!(headOb && headOb.type === 'COLOR_WILD'),
      rankOf: (id) => PEo.rankFromFace(faceOf(id)),
      suitOf: (id) => PEo.suitFromFace(faceOf(id)),
      colorOf: (id) => PEo.colorOfSuit(PEo.suitFromFace(faceOf(id))),
      state: this._obScratch,
      obstacleOf: (id) => this.obstacles[id] || null,
    };
  }

  // PE.obstacle (or null) + the obstacle runtime state, recomputed fresh.
  _obContext() {
    const PEo = (typeof window !== 'undefined' && window.PE && window.PE.obstacle) ? window.PE.obstacle : null;
    const hasObstacles = this.obstacles && Object.keys(this.obstacles).length > 0;
    return { PEo, S: (PEo && hasObstacles) ? this.obState(PEo) : null };
  }

  // Is this single (uncovered) card playable against the CURRENT head right now?
  _isCardPlayable(key, ctx) {
    const c = ctx || this._obContext();
    const normal = this.talonDeckCards.length > 0 ? this.isRankMatch(key) : true;
    if (c.S) {
      const ob = this.obstacles[key];
      if (ob) return c.PEo.isPlayable(ob, key, c.S, normal);
    }
    return normal;
  }

  recalculatePlayable() {
    this.playableCards = new Set();
    const ctx = this._obContext();
    for (const key of this.uncoveredCards) {
      if (this._isCardPlayable(key, ctx)) this.playableCards.add(key);
    }
  }

  resolveNewlyPlayable(removedKey) {
    const blocked = this.reverseDepMap[removedKey] || [];
    const newlyPlayable = [];

    for (const card of blocked) {
      const blockers = this.dependencyMap[card] || [];
      const allRemoved = blockers.every(b => this.removedCards.has(b));
      if (allRemoved && !this.removedCards.has(card) && !this.uncoveredCards.has(card)) {
        newlyPlayable.push(card);
      }
    }

    return newlyPlayable;
  }

  applyDependencyPlay(key, opts) {
    opts = opts || {};
    if (!this.playableCards.has(key)) {
      return { success: false, reason: 'not_playable' };
    }

    this.uncoveredCards.delete(key);
    this.removedCards.add(key);

    // This card becomes the new top for ±1 matching (its value at play time).
    // Key cards (opts.keepHead) are consumed to open a lock and do NOT become
    // the head — they fly to the door, not the talon.
    if (!opts.keepHead && this.talonDeckCards.length > 0) {
      this.currentTopCard = key;
      this.currentTopRanks = this.rankValuesOf(key);
      this.currentTopRank = this.currentTopRanks[0];
      this._everHadHead = true;
      this.wasteStack.push(key);   // this played card is now on top of the waste
    }

    // Every successful play ticks the remaining special cards' values.
    this.tickSpecials();

    // Resolve newly uncovered cards
    const newlyUncovered = this.resolveNewlyPlayable(key);
    for (const cardKey of newlyUncovered) {
      this.uncoveredCards.add(cardKey);
    }

    // Recalculate playable
    this.recalculatePlayable();

    // Check win condition
    const isGameOver = this.removedCards.size >= this.totalTableauCards;

    return {
      success: true,
      newTopRank: this.currentTopRank,
      newlyUncovered,
      isGameOver,
      playableCards: new Set(this.playableCards),
    };
  }

  // Consume a Key card (it flies to the door, doesn't become the head) and
  // uncover anything it was covering.
  forceRemoveKey(keyId) {
    this.uncoveredCards.delete(keyId);
    this.removedCards.add(keyId);
    const newly = this.resolveNewlyPlayable(keyId);
    newly.forEach(c => this.uncoveredCards.add(c));
    this.recalculatePlayable();
    return newly;
  }

  // Trap (rope) cards: which uncovered traps the current head can free (head ±1 of
  // the trap value, or a wild/mirror head which frees any trap). The head card frees
  // the trap — the trap itself is never tapped.
  freeableTraps() {
    const out = [];
    const headOb = this.currentTopCard ? this.obstacles[this.currentTopCard] : null;
    const headWild = headOb && (headOb.type === 'COLOR_WILD' || headOb.type === 'MIRROR_CARD');
    for (const [id, ob] of Object.entries(this.obstacles)) {
      if (!ob || ob.type !== 'TRAP_CARD') continue;
      if (this._obScratch['trap:' + id]) continue;        // already freed
      if (!this.uncoveredCards.has(id)) continue;          // must be revealed
      if (headWild || this.isRankMatch(id)) out.push(id);  // head ±1 of trap value
    }
    return out;
  }

  // Cut a trap's rope: mark it freed so it now plays on the normal ±1 rule.
  freeTrap(trapId) {
    this._obScratch['trap:' + trapId] = true;
    this.recalculatePlayable();
    return this.playableCards.has(trapId);
  }

  // The current head's colour ('red'|'black'|null). A colour-wild head uses its
  // own configured colour.
  _headColor() {
    const PEo = (typeof window !== 'undefined' && window.PE && window.PE.obstacle) ? window.PE.obstacle : null;
    if (!PEo || !this.currentTopCard) return null;
    const headOb = this.obstacles[this.currentTopCard];
    if (headOb && headOb.type === 'COLOR_WILD') return headOb.color || null;
    const sprites = (this.config && this.config.sprites) || {};
    const face = (sprites[this.currentTopCard] && sprites[this.currentTopCard].texture) || this.currentTopCard;
    return PEo.colorOfSuit(PEo.suitFromFace(face));
  }

  // The current head's suit ('spades'|'hearts'|'diamonds'|'clubs'|null).
  _headSuit() {
    const PEo = (typeof window !== 'undefined' && window.PE && window.PE.obstacle) ? window.PE.obstacle : null;
    if (!PEo || !this.currentTopCard) return null;
    const sprites = (this.config && this.config.sprites) || {};
    const face = (sprites[this.currentTopCard] && sprites[this.currentTopCard].texture) || this.currentTopCard;
    return PEo.suitFromFace(face);
  }

  // Curtain cards the current head can open: a COLOR curtain needs a same-colour head,
  // a SUIT curtain needs the exact suit. (Not yet cut, and revealed.)
  liftableCurtains() {
    const out = [];
    const hc = this._headColor();           // head colour (a wild head uses its own colour)
    const hs = this._headSuit();            // head's exact suit
    const headOb = this.currentTopCard ? this.obstacles[this.currentTopCard] : null;
    const headWildColor = (headOb && headOb.type === 'COLOR_WILD') ? (headOb.color || null) : null;
    const suitColor = (s) => (s === 'hearts' || s === 'diamonds') ? 'red' : 'black';
    for (const [id, ob] of Object.entries(this.obstacles)) {
      if (!ob) continue;
      if (this._obScratch['curtain:' + id]) continue;   // already opened
      if (!this.uncoveredCards.has(id)) continue;         // must be revealed
      // Colour curtain: a head of the SAME COLOUR opens it.
      if (ob.type === 'COLOR_CARD' && hc && ob.color === hc) out.push(id);
      // Suit curtain: a head of EXACTLY that suit opens it; a matching-colour wild
      // also works (black wild → spades/clubs, red wild → hearts/diamonds).
      else if (ob.type === 'COLOR_SUIT_CARD') {
        if (hs && ob.suit === hs) out.push(id);
        else if (headWildColor && headWildColor === suitColor(ob.suit)) out.push(id);
      }
    }
    return out;
  }

  // Open a colour curtain: mark it cut so the card under it plays on the ±1 rule.
  liftCurtain(id) {
    this._obScratch['curtain:' + id] = true;
    this.recalculatePlayable();
  }

  // Break a mirror: it becomes a normal card frozen at the value it was reflecting,
  // and is now playable on the ±1 rule.
  unlockMirror(id) {
    this._obScratch['mirror:' + id] = true;                       // un-blocks it
    this._obScratch['mirror:' + id + ':value'] = this.currentTopRank || 0;  // freeze value
    this.recalculatePlayable();
  }

  // Intact (un-broken) mirrors that the player could break right now — a remaining
  // move (unless the head is a wild card, which blocks breaking).
  breakableMirrors() {
    const out = [];
    const headOb = this.currentTopCard ? this.obstacles[this.currentTopCard] : null;
    if (headOb && headOb.type === 'COLOR_WILD') return out;   // wild head can't be mirrored
    for (const [id, ob] of Object.entries(this.obstacles)) {
      if (!ob || ob.type !== 'MIRROR_CARD') continue;
      if (this._obScratch['mirror:' + id]) continue;     // already broken
      if (!this.uncoveredCards.has(id)) continue;         // must be revealed
      out.push(id);
    }
    return out;
  }

  // Remove the current head (e.g. it was consumed cutting a trap and no stock
  // remains). With _everHadHead set, nothing is playable until a new head appears.
  clearHead() {
    this.currentTopCard = null;
    this.currentTopRanks = [];
    this.currentTopRank = 0;
    this.recalculatePlayable();
  }

  // The head card left to cut an obstacle: pop it off the waste and make the card now
  // on top (the previous waste card) the new head. ±1 matching then uses THAT head.
  // Falls back to the next stock card, then to empty, if the waste runs out.
  revertHead() {
    if (this.wasteStack.length > 0) this.wasteStack.pop();   // the head that just left
    if (this.wasteStack.length > 0) {
      this.currentTopCard = this.wasteStack[this.wasteStack.length - 1];
      this.currentTopRanks = this.rankValuesOf(this.currentTopCard);
      this.currentTopRank = this.currentTopRanks[0];
      this.recalculatePlayable();
      return this.currentTopCard;
    }
    if (this.talonCurrentIndex >= 0) { this.applyStockTap(); return this.currentTopCard; }
    this.clearHead();
    return null;
  }

  // Open a Lock door: drop the lock as a blocker for the cards behind it so they
  // are revealed. Returns the newly-uncovered cards.
  openLock(lockId) {
    const newly = [];
    const dependents = this.reverseDepMap[lockId] || [];
    for (const c of dependents) {
      this.dependencyMap[c] = (this.dependencyMap[c] || []).filter(b => b !== lockId);
      const allRemoved = this.dependencyMap[c].every(b => this.removedCards.has(b));
      if (allRemoved && !this.removedCards.has(c) && !this.uncoveredCards.has(c)) {
        this.uncoveredCards.add(c); newly.push(c);
      }
    }
    this.recalculatePlayable();
    return newly;
  }

  applyStockTap() {
    if (this.talonCurrentIndex < 0) {
      return { success: false, reason: 'stock_exhausted' };
    }

    const key = this.talonDeckCards[this.talonCurrentIndex];
    this.currentTopCard = key;
    this.currentTopRanks = this.rankValuesOf(key);
    this.currentTopRank = this.currentTopRanks[0];
    this._everHadHead = true;
    this.wasteStack.push(key);   // the drawn stock card is now on top of the waste
    this.talonCurrentIndex--;

    const stockExhausted = this.talonCurrentIndex < 0;

    // Recalculate playable
    this.recalculatePlayable();

    return {
      success: true,
      flippedKey: key,
      newTopRank: this.currentTopRank,
      stockExhausted,
      playableCards: new Set(this.playableCards),
    };
  }

  isDeadBoard() {
    // Re-derive freshly from the live board so a stale playableCards can never cause
    // a false "dead" — check EVERY uncovered card against the CURRENT head.
    if (this.talonCurrentIndex >= 0) return false;        // stock can still be drawn
    if (this.freeableTraps().length > 0) return false;    // a trap rope can still be cut
    if (this.breakableMirrors().length > 0) return false; // a mirror can still be broken
    if (this.liftableCurtains().length > 0) return false; // a curtain can still be opened
    const ctx = this._obContext();
    for (const key of this.uncoveredCards) {
      if (this.removedCards.has(key)) continue;
      if (this._isCardPlayable(key, ctx)) return false;   // a valid move exists
    }
    return true;
  }
}

// Export for both Node.js (testing) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameState };
}
