# Playable Engine — JSON-driven browser tool

Load a JSON spec → arrange objects in the **scenes window** → click **Generate** to
download a self-contained playable HTML. It reuses the `the-one-ring` Phaser scene
components (`GameScene`, `GameState`, `EndScene`, `TransitionScene`, `SoundControls`)
plus a new `DifficultyScene`, so the generated playable behaves exactly like the
production builds — just driven by JSON instead of YAML + Python.

The first supported playable type is **difficulty-select**: a start scene with
Easy / Medium / Hard, each routing to its own card-clear flow, then an end card.

## Run

The tool fetches the engine sources and card art at runtime, so it must be served
over HTTP (browsers block `fetch()` on `file://`). Serve from the **repo root**:

```bash
cd /Users/mayankyadav/Downloads/playable-engine
python3 -m http.server 8000
# open http://localhost:8000/engine/
```

The tool auto-loads `engine/samples/difficulty-select.json`.

## Using it

- **Scene tabs** — `Start` · the level scene(s) · `End`. **Difficulty scene** checkbox ON →
  three mode levels (`easy` / `medium` / `hard`) with a difficulty-select Start scene; OFF →
  a single `Game` level with a one-button `PLAY` Start scene. The **Start** and **End** scenes
  are fully authorable here too (drag/scale the title, options/PLAY button, logo, CTA).
- **Portrait ⇄** — toggle orientation; positions are edited per-orientation.
- **Drag** any object (title, difficulty option, card, talon markers, background layers)
  to reposition it.
- **＋ BG image** — add a background image layer (placed/scaled per orientation); drag it
  on the canvas and set its scale / fit / depth (or remove it) in the inspector.
- **Inspector** (right) — edit `x / y / scale / depth / r`, fit, an option's label, or a
  card's **intro** style. Every object (card, difficulty option, logo, background, talon
  base/deck, telon graphic) has a **Remove** button. Selecting never changes z-order.
- **Multi-select** — **shift-click** to add/remove objects, or **drag a box** over empty
  space. With several selected: **drag** any of them to move the whole group, and use the
  inspector's **Scale ×** (multiply) / **Scale =** (set) to bulk-resize, or **Remove** all.
- **Difficulty scene** checkbox — ON builds a start scene that routes to each level
  (Easy/Medium/Hard…); OFF builds a single game scene (the current level).
- **Layer (Bring ↑ / Send ↓)** in a card's inspector raises/lowers its depth — what renders
  on top and what counts as "above" for coverage.
- **Depends on** (per card) — the cards that cover it; it flips only once they're all
  cleared. Empty = a top card that starts face-up. This is the manual control (same model as
  the reference playables' per-card `dependencies`).
- **⤧ Fix flip order** auto-fills those dependencies from the layout: a card is covered by
  any overlapping card *above* it (higher depth, or — at equal depth — later in the list).
  **Non-overlapping cards never cover each other**, so a depth-4 and a depth-6 card both flip
  if neither has an overlapping card above. Run it, then tweak any card's **Depends on** by
  hand. (Dragging a card no longer overwrites your manual dependencies.)
- **Layer (Bring ↑ / Send ↓)** sets a card's depth — which renders on top, and which is
  "above" for coverage.
- **JSON Spec** panel — live view of the spec; edit it and hit **Apply JSON →**.
- **Network** dropdown — choose the ad network (AppLovin / Google / Meta / Unity Ads).
- **▶ Live Test** — assembles the playable and opens it in a **new tab** so you can play
  it locally for testing (no download).
- **Build (inline+split)** — builds the selected network and downloads
  `<name>_<network>.zip` with the **exact Wags layout**:
  - `inline/index.html` — single self-contained file (everything embedded).
  - `split/index.html` + `split/assets/index.js` — tiny HTML that loads the engine +
    assets from an external JS file.
  - `split/dist.zip` — the zipped split build (the uploadable), inside `split/` just like
    the Wags `ad-builds`.
- **Build all networks** — one zip with every network × (inline + split):
  ```
  <name>_all-networks.zip
    applovin/inline/index.html
    applovin/split/index.html
    applovin/split/assets/index.js
    google/...  meta/...  unityads/...
  ```
  Assets are embedded once and reused; only the per-network `<head>` SDK + redirect differ.

## JSON schema (v1)

See `src/schema.js` for the authoritative shape and defaults. Outline:

```jsonc
{
  "name": "difficulty-select",
  "network": "applovin",             // applovin | google | meta | unityads
  "logo": { "image":"engine/assets/logo/solitaire_logo.webp",
            "portrait":{"x":540,"y":175,"scale":1.05}, "landscape":{"x":960,"y":80,"scale":0.62} },
  "canvas":  { "portrait": {"width":1080,"height":1920}, "landscape": {...} },
  "scales":  { "card": {"portrait":0.35,"landscape":0.27}, "talon": {...} },
  "background": {
    "color": "#142a6c",
    "portrait":  {"image":"<cover bg, repo path or data URI>"}, "landscape": {...},
    "layers": [                          // multiple placed/scaled bg images
      { "id":"table", "image":"<path|data URI>", "fit":"none", "depth":1,
        "portrait":{"x":540,"y":1660,"scale":0.95}, "landscape":{"x":960,"y":980,"scale":0.95} }
      // fit:"cover" fills the canvas (x/y/scale ignored)
    ]
  },
  "talon_panel": true,                   // engine's drawn talon panel behind stock+waste
  "deck": {
    "card_back": "the-one-ring-main/playables/master/assets/cards/Back_Card.png",
    "talon_base": "<optional talon pile art>"   // embedded as the talon_base texture
  },

  "start_scene": {                    // omit / {"type":"none"} => boot straight into the single level
    "type": "difficulty",
    "title":   { "text":"CHOOSE DIFFICULTY", "color":"#ffe9a8", "size":0.058, "y":300, "y_landscape":150 },
    "options": [ { "id":"easy", "label":"EASY", "color":"#2ed573", "image":"<optional art>",
                   "portrait":{"x":540,"y":760,"scale":1}, "landscape":{...} } ]
  },

  "levels": {                        // one entry per option id (or a single level for type:"none")
    "easy": {
      "deal":      { "style":"deal_curve", "stagger":70, "duration":480, "curve_height":260 },
      "animation": { "default":{"curve_height":150,"first_duration":400,"second_duration":300} },
      "game_flow": { "mode":"dependency", "dependencies":{...},
                     "initially_playable":[...], "deal_order":[...] },
      "talon":     { "sequence":["diamonds_a"],
                     "base":{"portrait":{"x":540,"y":1497,"scale":1.2,"depth":25},"landscape":{...}},
                     "deck":{"portrait":{...},"landscape":{...}} },
      "cards":     [ { "id":"s0", "face":"heart_4", "role":"tableau",
                       "portrait":{"x":540,"y":321,"scale":1.2,"depth":3,"r":0}, "landscape":{...},
                       "intro":{"style":"flip","duration":420} } ]
    }
  },

  "end_card": { "title":"You Win!", "cta_text":"PLAY NOW",
                "lose_title":"So Close!", "lose_cta_text":"TRY AGAIN",
                "store_url":"<Google Play URL>", "apple_url":"<App Store URL>" }
}
```

### Networks & redirect (same as the Wags Water build)

Each network gets the correct `<head>` SDK injection and CTA redirect:

| Network   | `<head>`                         | CTA redirect |
|-----------|----------------------------------|--------------|
| applovin  | `mraid.js`                       | `mraid.open(storeUrl)` |
| unityads  | `mraid.js` + store-url globals   | `mraid.open(storeUrl)` |
| google    | `ExitApi` stub                   | `ExitApi.exit()` |
| meta      | none                             | `FbPlayableAd.onCTAClick()` |

`openCTA()` mirrors the Wags logic: pick the store URL by platform (`apple_url` on iOS,
`store_url`/`google_url` elsewhere), call the network SDK, else fall back to `market://` /
`itms-apps://` deep links then `window.open`. It fires from the End-scene CTA.

### Logo

`logo.image` is embedded as the `logo` texture and shown on the difficulty (start) scene
and during gameplay, positioned/scaled per orientation. It's draggable in the editor.

### Card intros

Set per level via `levels.<id>.deal.style` (global default) or per card via
`card.intro.style`:

| style        | effect |
|--------------|--------|
| `deal_curve` | fly from the talon along an arc to the slot (`curve_height`) |
| `fade`       | fade + scale up in place |
| `slide`      | slide in from an edge (`from: top\|bottom\|left\|right`) |
| `flip`       | flip-in at the slot (stays face-down until the reveal step) |

Common knobs: `stagger` (ms between cards), `duration`, `delay`.

### Obstacles

All 12 Royal-Tripeaks obstacles (from `PlayableAds_Obstacle_Kit`) are catalogued in
`src/obstacle.js` — one entry per obstacle with its description, editor params, and logic
hooks (`blocked` / `matches` / `onAnyPlay` / `onMove` / `dependencyEdges` / `loses`):

`LOCK_AND_KEY · DOUBLE_VALUE_CARD · TRAP_CARD · BALLOON_BASKET · MIRROR_CARD · COLOR_CARD ·
ROPE_CARD · GEM_SHIELD (+ GEM) · COLOR_WILD · BOMB_CARD · COLOR_SUIT_CARD · KITE_BLOCKER`

In a level scene, select a card → the inspector's **Obstacle** dropdown turns it into any
obstacle (with per-obstacle fields, e.g. the lock's key card, the bomb's counter, the
curtain's colour/suit). Each obstacle card shows a badge on the canvas, and `card.obstacle`
is written to the JSON and carried into the build under `obstacles`.

Runtime — obstacle cards swap to the kit art and follow their mechanic:
- **Lock & Key** — *fully animated, automatic*: the door card is a **pure door** (it replaces
  the card, not drawn over it — no card behind its face). The moment the Key card is
  **revealed** (uncovered) it **auto-flies** to the door (arc + spin, no tap) — and the cards
  the key was sitting on flip up as it lifts off — then a glow flashes, the door plays its
  3-frame open with a sparkle burst and **fades away entirely**, revealing/flipping the cards
  it was covering. Modeled on the reference `playable_2_long_level_door_unlock`.
- **Bomb** — the counter drops each move; at 0 the bomb art blows up (scale + flash) and the
  level is **lost**; play the card to defuse.
- **Color-Wild** — plays on any same-colour head.
- **Mirror** — a **glass mirror** (`Mirror Card 01.png`, sized to cover the card) under a gold
  **frame** (`Mirror Card_256.png`, bordering around it) reflects the **current head value**,
  re-syncing with a sheen (`Oval_sheen.png`) as the head changes. **Two taps:** the first
  *breaks* it (frame + glass vanish with a glow) and **freezes** the card at the value it was
  showing — now a normal card; the second *plays* it on the ±1 rule. The head being a **wild
  card** blocks breaking (it shakes). If breaking it leaves **no move on the board**, the end
  scene fires (a breakable mirror / cuttable trap counts as a move, so the end waits for it).
- **Double-Value** — its two consecutive ranks (lower J/Q/K + the next up, K↔A wrap →
  Q+J, K+Q, A+K) **replace** the card's printed value. Rendered **~1.35× larger**, it plays
  when the head is ±1 of *either* value, and as the head it can be matched on either. Red
  (Diamond/Heart) or black (Spade/Club) art is chosen from the card's own suit.
- **Color Curtain** — *fully animated*: a red/black curtain (**roller + cloth**) covers the
  card on flip and blocks it. When the talon **head is the same colour** (rank ignored; a
  matching-colour wild also works), **tapping the head** sends the head card to the curtain,
  which **splits open** (the `Cut_Left`/`cut_Right` halves slide apart, roller lifts) to reveal
  the card — now a normal ±1 card. Like the trap, the head card **completely moves** off the
  talon to cut it, and the **card now on top of the waste becomes the new head** (the previous
  waste card; it falls back to the next stock card, then empty). ±1 matching then uses **that**
  new head. A liftable curtain counts as a move, so the end scene waits until it's opened.
- **Suit curtain** — same mechanic and animation as the colour curtain, but one of **four
  per-suit drapes** (♠ ♦ ♥ ♣) opened only by a head of **exactly that suit** (a matching-colour
  wild also works: black → ♠/♣, red → ♥/♦). The head moves to cut it and reverts the same way.
- **Trap (rope)** — *fully animated*: the rope appears the moment the card flips face-up and
  the card is **un-tappable** while roped. When the talon **head** is ±1 of the trap's value
  (or a wild/mirror head), **tapping the head** sends the **full-size head card** flying
  (spin + arc) to the trap, where the rope **snaps into pieces** (the `1.png` broken-rope art)
  with a sparkle. The head card **completely moves** off the talon and fades at the trap, and
  the **card now on top of the waste becomes the new head** (the previous waste card; falls back
  to the next stock card, then empty). The freed card then plays only when **that** new head is
  ±1 of it. A cuttable rope counts as a remaining move, so the dead-board **end scene waits until
  the rope is cut** and only fires if no move is left after. Input locked during the ~1.2 s cut.

All kit art (faces, overlays, and animation frames) is embedded from
`PlayableAds_Obstacle_Kit` at build time. Lock & Key and Trap have full bespoke animations; the
others use the correct mechanic with basic reveal animations — their bespoke sequences (curtain
cut-apart, gem flights, kite clouds, balloon pops) build on the same framework.

### Talon & gameplay

Give a level a `talon.sequence` (a list of card faces) to enable the **talon** mechanic
like the Wags ads: a stock pile you tap, a face-up waste card, and ±1 rank matching —
each tableau card you clear flips and flies to the talon and becomes the new top.
Set `deck.talon_image` to draw a talon-pile graphic (the Wags `telon`) behind the
stock/waste; it's auto-placed at the talon midpoint and draggable in the editor. `talon.base` /
`talon.deck` position the waste and stock per orientation. With an **empty** sequence the
level is a free dependency-clear (any uncovered card is tappable). Difficulty in the sample
scales by tableau size **and** stock depth (Easy 15/1 · Medium 15/9 · Hard 17/12), all
proven solvable. The three difficulties share one embedded deck, so the build stays small.

### Cards & assets

`face` is a master-deck texture key (`heart_4`, `spades_a`, `clubs_q`, …). The
`asset` path is auto-derived from the face if omitted. Card faces and the card back
are WebP-compressed at Generate time to keep builds under the size cap; the same deck
art is embedded once and shared across all three difficulties.

## How it maps to the engine

- `DifficultyScene` (new, in `the-one-ring/playables/common/scenes/`) boots first when
  `window.LEVEL_BUNDLE` is present, shows the options, and on tap merges the shared
  fields + the chosen `levels[id]` into `window.LEVEL_CONFIG`, then starts `GameScene`.
- `GameScene.animateCardsIn()` gained additive intro support (`deal` / `intro`); with
  neither set it keeps the original whole-board slide, so existing YAML/Python builds
  are unchanged.
- `assembler.js` is the browser equivalent of `build_playable.py`: it inlines Phaser +
  the scenes + the config + base64 assets into `template.html`.

## Deferred

Obstacles, boosters, events/areas/characters, lose-branching, obfuscation, and the
BigQuery catalog are out of scope for v1 (see `../spec.md`).
