/**
 * editor.js — the scenes-window editor
 * ====================================
 * Loads a JSON spec, renders the current scene's objects on a canvas sized to
 * the chosen orientation, lets you drag objects to reposition them (writing back
 * to the in-memory spec + JSON panel), edit properties in an inspector, and
 * Generate the finished playable via the assembler.
 */
(function () {
  const PE = window.PE;
  const $ = (s) => document.querySelector(s);

  const state = {
    spec: null,
    scene: null,          // 'difficulty' or a level id
    orient: 'portrait',
    selected: null,       // primary selected id (for the single-object inspector)
    selection: new Set(), // all selected ids (multi-select)
    dragging: null,       // group drag state
    marquee: null,        // drag-box select
  };
  // Select exactly one (or none); keeps selection + primary in sync.
  function selectOnly(id) { state.selection = new Set(id ? [id] : []); state.selected = id || null; }
  function selectedItems() { return (state._items || []).filter(it => state.selection.has(it.id)); }

  const canvas = $('#scene-canvas');
  const ctx = canvas.getContext('2d');
  const progress = $('#progress');

  const imgCache = {};    // path -> HTMLImageElement (or 'pending')
  function getImg(path) {
    if (!path) return null;
    if (imgCache[path] === undefined) {
      imgCache[path] = 'pending';
      const img = new Image();
      img.onload = () => { imgCache[path] = img; render(); };
      img.onerror = () => { imgCache[path] = null; };
      img.src = path.indexOf('data:') === 0 ? path : '../' + path;
    }
    return (imgCache[path] && imgCache[path] !== 'pending') ? imgCache[path] : null;
  }

  // ---- progress / status -----------------------------------------------------
  function status(msg, cls) { progress.textContent = msg; progress.className = cls || ''; }

  // ---- load / apply ----------------------------------------------------------
  async function loadSample() {
    status('Loading sample…');
    const r = await fetch(PE.schema.SAMPLE_URL);
    const spec = await r.json();
    setSpec(spec);
    status('Sample loaded.', 'ok');
  }

  function setSpec(spec) {
    state.spec = PE.schema.withDefaults(spec);
    dedupeLayerIds();   // repair any duplicate background-layer ids from older specs
    const ns = $('#net-select'); if (ns) ns.value = state.spec.network || 'applovin';
    // Difficulty = a start scene with more than one option (Easy/Medium/Hard…).
    const ss = state.spec.start_scene;
    const cd = $('#chk-difficulty'); if (cd) cd.checked = !!(ss && ss.type === 'difficulty' && (ss.options || []).length > 1);
    state.scene = 'start';
    selectOnly(null);
    buildTabs();
    syncJSON();
    histInit();     // reset undo history to the freshly-loaded spec
    render();
  }

  function syncJSON() { $('#json').value = JSON.stringify(state.spec, null, 2); commitHistory(); }

  // ---- undo / redo -----------------------------------------------------------
  // A list of spec snapshots with a pointer. Every edit (via syncJSON) schedules a
  // debounced commit so rapid changes (typing, dragging) coalesce into one step.
  let _hist = [], _histPtr = -1, _commitT = null, _restoring = false;
  function histInit() {
    clearTimeout(_commitT);
    _hist = state.spec ? [JSON.stringify(state.spec)] : [];
    _histPtr = _hist.length - 1;
    updateHistButtons();
  }
  function doCommit() {
    if (!state.spec) return false;
    const s = JSON.stringify(state.spec);
    if (_hist[_histPtr] === s) return false;     // no change
    _hist = _hist.slice(0, _histPtr + 1);         // drop any redo branch
    _hist.push(s);
    if (_hist.length > 80) _hist.shift();
    _histPtr = _hist.length - 1;
    updateHistButtons();
    return true;
  }
  function commitHistory() { if (_restoring || !state.spec) return; clearTimeout(_commitT); _commitT = setTimeout(doCommit, 350); }
  function restoreHistory(idx) {
    _restoring = true;
    state.spec = JSON.parse(_hist[idx]); _histPtr = idx;
    const ns = $('#net-select'); if (ns) ns.value = state.spec.network || 'applovin';
    if (state.scene !== 'start' && state.scene !== 'end' && !state.spec.levels[state.scene]) state.scene = 'start';
    selectOnly(null); buildTabs(); render(); inspector(); syncJSON();
    _restoring = false;
    updateHistButtons();
  }
  function undo() { clearTimeout(_commitT); doCommit(); if (_histPtr > 0) restoreHistory(_histPtr - 1); else status('Nothing to undo.'); }
  function redo() { clearTimeout(_commitT); if (_histPtr < _hist.length - 1) restoreHistory(_histPtr + 1); else status('Nothing to redo.'); }
  function updateHistButtons() {
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = _histPtr <= 0;
    if (r) r.disabled = _histPtr >= _hist.length - 1;
  }

  function applyJSON() {
    try {
      const spec = JSON.parse($('#json').value);
      setSpec(spec);
      status('JSON applied.', 'ok');
    } catch (e) { status('JSON parse error: ' + e.message, 'err'); }
  }

  // ---- scene tabs ------------------------------------------------------------
  function buildTabs() {
    const host = $('#scene-tabs');
    host.innerHTML = '';
    const spec = state.spec;
    const ss = spec.start_scene || {};
    const opts = ss.options || [];
    const diffOn = ss.type === 'difficulty' && opts.length > 1;
    const levelIds = Object.keys(spec.levels);
    // Difficulty ON → the three mode levels; OFF → a single game level.
    const shown = diffOn
      ? opts.map(o => o.id).filter(id => spec.levels[id])
      : [(opts[0] && spec.levels[opts[0].id]) ? opts[0].id : levelIds[0]];
    // Start scene · level scene(s) · End scene.
    const tabs = [['start', 'Start']]
      .concat(shown.map(id => [id, diffOn ? id : 'Game']))
      .concat([['end', 'End']]);
    if (!tabs.find(t => t[0] === state.scene)) state.scene = 'start';
    tabs.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.className = 'tab' + (id === state.scene ? ' active' : '');
      b.textContent = label;
      b.onclick = () => { state.scene = id; selectOnly(null); buildTabs(); render(); inspector(); };
      host.appendChild(b);
    });
  }

  // Toggle the difficulty-select scene. ON → a start scene that routes to each
  // level (Easy/Medium/Hard…). OFF → no start scene, a single game scene (the
  // current level), which the build boots straight into.
  function setDifficultyMode(on) {
    const spec = state.spec; if (!spec) return;
    const levelIds = Object.keys(spec.levels);
    const pw = spec.canvas.portrait, lw = spec.canvas.landscape;
    if (on) {
      // Start scene routes to all three mode levels.
      const palette = ['#2ed573', '#ffa502', '#ff4757', '#3a86ff'];
      spec.start_scene = {
        type: 'difficulty',
        title: { text: 'CHOOSE DIFFICULTY', color: '#ffe9a8', size: 0.058, y: 300, y_landscape: 150 },
        options: levelIds.map((id, i) => ({ id, label: id.toUpperCase(), color: palette[i] || '#3a86ff',
          portrait: { x: Math.round(pw.width / 2), y: Math.round(pw.height * (0.38 + i * 0.16)), scale: 0.6 },
          landscape: { x: Math.round(lw.width * (0.3 + i * 0.2)), y: Math.round(lw.height * 0.55), scale: 0.5 } })),
      };
    } else {
      // Single game: one PLAY button on the start scene routing to the first level.
      const cur = (spec.start_scene && (spec.start_scene.options || [])[0] && spec.levels[spec.start_scene.options[0].id])
        ? spec.start_scene.options[0].id : (spec.levels[state.scene] ? state.scene : levelIds[0]);
      spec.start_scene = {
        type: 'difficulty',
        title: { text: '', color: '#ffe9a8', size: 0.058, y: 300, y_landscape: 150 },
        options: [{ id: cur, label: 'PLAY', color: '#2ed573',
          portrait: { x: Math.round(pw.width / 2), y: Math.round(pw.height * 0.62), scale: 0.7 },
          landscape: { x: Math.round(lw.width / 2), y: Math.round(lw.height * 0.62), scale: 0.6 } }],
      };
    }
    state.scene = 'start';
    selectOnly(null); buildTabs(); render(); inspector(); syncJSON();
    status(on ? 'Difficulty scene ON — three mode levels.' : 'Difficulty scene OFF — single game scene.', 'ok');
  }

  // ---- scene-scoped images ---------------------------------------------------
  // Every editable scene id in tab order: start (difficulty only), each level, end.
  function allSceneIds() {
    const spec = state.spec, ids = [];
    if (spec.start_scene && spec.start_scene.type === 'difficulty') ids.push('start');
    Object.keys(spec.levels || {}).forEach(id => ids.push(id));
    ids.push('end');
    return ids;
  }
  function sceneLabel(id) { return id === 'start' ? 'Start' : id === 'end' ? 'End' : id; }
  // A background-layer image is in ALL scenes when scenes is absent or '*'.
  function layerAllScenes(L) { return L.scenes == null || L.scenes === '*'; }
  function layerInScene(L, sceneId) {
    return layerAllScenes(L) || (Array.isArray(L.scenes) && L.scenes.includes(sceneId));
  }
  // The per-scene position object for a layer (materialized from its base so that
  // dragging/scaling edits THIS scene only). Cover layers keep one shared pos.
  function layerScenePos(L, sceneId, o) {
    return layerSceneLayout(L, sceneId, o)[o];
  }
  // The per-scene layout container { portrait, landscape, anim } for a layer.
  // Animation lives here (per scene), so an image can animate in one scene only.
  function layerSceneLayout(L, sceneId, o) {
    L.layouts = L.layouts || {};
    const sc = L.layouts[sceneId] || (L.layouts[sceneId] = {});
    const orient = o || state.orient;
    if (!sc[orient]) sc[orient] = Object.assign({}, L[orient] || { x: 540, y: 760, scale: 1 });
    return sc;
  }

  // ---- object model ----------------------------------------------------------
  // Returns draggable items for the current scene+orientation. Each item holds a
  // reference to the underlying spec pos object so edits mutate the spec.
  function items() {
    const o = state.orient;
    const list = [];
    const spec = state.spec;
    const cardScale = (spec.scales.card || {})[o] || 0.35;
    const talonScale = (spec.scales.talon || {})[o] || 1.1;
    const W = spec.canvas[o].width, H = spec.canvas[o].height;

    // Background layers — global to every scene, drawn lowest. `cover` layers fill
    // the canvas (small centered handle for selection); others are freely placed.
    ((spec.background && spec.background.layers) || []).forEach((L, i) => {
      if (!layerInScene(L, state.scene)) return;   // hidden in this scene
      const isCover = L.fit === 'cover';
      // Cover layers fill the canvas (one shared pos); placed images get a
      // per-scene position so the same image can sit differently per scene.
      const p = isCover ? (L[o] || (L[o] = { x: W / 2, y: H / 2, scale: 1 }))
                        : layerScenePos(L, state.scene, o);
      const img = getImg((o === 'landscape' && L.image_landscape) ? L.image_landscape : L.image);
      const cs = img ? Math.max(W / img.width, H / img.height) : 1;
      const sc = p.scale != null ? p.scale : 1;
      const dw = img ? (isCover ? cs * img.width : img.width * sc) : 200;
      const dh = img ? (isCover ? cs * img.height : img.height * sc) : 200;
      list.push({
        id: 'bg:' + (L.id != null ? L.id : i), kind: 'bg',
        label: (L.cta ? 'CTA: ' : 'BG: ') + (L.id != null ? L.id : i) + (isCover ? ' (cover)' : ''),
        depth: L.depth != null ? L.depth : -1, pos: p, layer: L,
        get x() { return isCover ? W / 2 : p.x; }, get y() { return isCover ? H / 2 : p.y; },
        w: isCover ? 180 : dw, h: isCover ? 180 : dh,
        draw(c) {
          if (img) {
            if (isCover) c.drawImage(img, W / 2 - cs * img.width / 2, H / 2 - cs * img.height / 2, cs * img.width, cs * img.height);
            else c.drawImage(img, p.x - dw / 2, p.y - dh / 2, dw, dh);
          } else {
            const x = isCover ? W / 2 : p.x, y = isCover ? H / 2 : p.y;
            c.fillStyle = '#2c3358'; c.fillRect(x - 90, y - 60, 180, 120);
            c.fillStyle = '#8b92ad'; c.font = '22px Arial'; c.textAlign = 'center'; c.fillText('bg image…', x, y);
          }
        },
      });
    });

    // Logo — a UI element shown on the start + game scenes; editable everywhere.
    if (spec.logo && spec.logo.image) {
      const lp = spec.logo[o] || (spec.logo[o] = { x: W / 2, y: Math.round(H * 0.08), scale: 0.5 });
      const img = getImg(spec.logo.image);
      const sc = lp.scale != null ? lp.scale : 0.5;
      const w = (img ? img.width : 330) * sc, h = (img ? img.height : 170) * sc;
      list.push({
        id: 'logo', kind: 'logo', label: 'Logo', depth: 60, pos: lp,
        get x() { return lp.x; }, get y() { return lp.y; }, w, h,
        draw(c) {
          if (img) c.drawImage(img, lp.x - w / 2, lp.y - h / 2, w, h);
          else { c.fillStyle = '#ffffff22'; c.fillRect(lp.x - w / 2, lp.y - h / 2, w, h); c.fillStyle = '#fff'; c.font = '24px Arial'; c.textAlign = 'center'; c.fillText('LOGO', lp.x, lp.y); }
        },
      });
    }

    if (state.scene === 'start') {
      const ss = spec.start_scene || (spec.start_scene = { type: 'difficulty', options: [] });
      const W = spec.canvas[o].width;
      // Title removed from the start scene — keep it explicitly empty so the build
      // never renders the default "SELECT DIFFICULTY".
      ss.title = { text: '' };
      (ss.options || []).forEach((opt, i) => {
        const p = opt[o] || (opt[o] = { x: W / 2, y: spec.canvas[o].height * (0.4 + i * 0.18), scale: 1 });
        const img = opt.image ? getImg(opt.image) : null;
        const sc = p.scale != null ? p.scale : 1;
        const w = (img ? img.width : 360) * sc, h = (img ? img.height : 200) * sc;
        list.push({
          id: 'opt:' + opt.id, kind: 'option', label: 'Option: ' + opt.id, depth: 20,
          pos: p, opt, w, h, get x() { return p.x; }, get y() { return p.y; },
          draw(c) {
            if (img) { c.drawImage(img, p.x - w / 2, p.y - h / 2, w, h); return; }
            drawBadge(c, p.x, p.y, 360 * sc, 200 * sc, opt.color, (opt.label || opt.id));
          },
        });
      });
      return list;
    }

    if (state.scene === 'end') {
      const ec = spec.end_card || (spec.end_card = {});
      // Win title
      const tp = (ec.title_pos || (ec.title_pos = {}))[o] || (ec.title_pos[o] = { x: W / 2, y: Math.round(H * 0.25), size: o === 'landscape' ? 112 : 168 });
      list.push({
        id: 'end_title', kind: 'endtitle', label: 'Win title', depth: 100, pos: tp,
        get x() { return tp.x; }, get y() { return tp.y; }, w: W * 0.85, h: (tp.size || 168) * 1.2,
        draw(c) {
          c.save();
          c.font = `bold ${Math.round(tp.size || 168)}px "Arial Black", Arial`;
          c.fillStyle = '#FFE05A'; c.strokeStyle = '#7a3b00'; c.lineWidth = 20;
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.strokeText(ec.title || 'You Win!', tp.x, tp.y); c.fillText(ec.title || 'You Win!', tp.x, tp.y);
          c.restore();
        },
      });
      // No built-in end-card CTA button — add a "CTA button" via Add item instead
      // (it has image/position/scene/animation controls and opens the store URL).
      return list;
    }

    // level scene
    const lv = spec.levels[state.scene];
    if (!lv) return list;
    (lv.cards || []).forEach(card => {
      const p = card[o] || (card[o] = { x: 540, y: 600, scale: cardScale, depth: 1 });
      const img = getImg(card.asset || PE.schema.faceToAsset(card.face));
      // Some obstacle cards render larger at runtime (Double Value ~1.35×); mirror
      // that here so authoring shows the true on-screen size.
      const obDef = card.obstacle && (PE.obstacle || {}).OBSTACLES && PE.obstacle.OBSTACLES[card.obstacle.type];
      const enlarge = (obDef && obDef.enlarge) || 1;
      const sc = (p.scale != null ? p.scale : cardScale) * enlarge;
      const w = (img ? img.width : 240) * sc, h = (img ? img.height : 340) * sc;
      list.push({
        id: 'card:' + card.id, kind: 'card', label: card.id + ' (' + card.face + ')',
        depth: p.depth || 1, pos: p, card, w, h, get x() { return p.x; }, get y() { return p.y; },
        draw(c) {
          c.save(); c.translate(p.x, p.y); if (p.r) c.rotate(p.r);
          if (img) c.drawImage(img, -w / 2, -h / 2, w, h);
          else drawCardRect(c, w, h, card.face);
          // Obstacle badge — a labelled chip in the card's top-left corner.
          if (card.obstacle && card.obstacle.type) {
            const def = (PE.obstacle || {}).OBSTACLES && PE.obstacle.OBSTACLES[card.obstacle.type];
            const txt = (def ? def.label : card.obstacle.type).toUpperCase().slice(0, 10);
            const bw = Math.max(90, txt.length * 16), bh = 40;
            c.fillStyle = 'rgba(123,92,255,0.92)';
            roundRect(c, -w / 2 + 6, -h / 2 + 6, bw, bh, 8); c.fill();
            c.fillStyle = '#fff'; c.font = 'bold 24px Arial'; c.textAlign = 'left'; c.textBaseline = 'middle';
            c.fillText(txt, -w / 2 + 14, -h / 2 + 6 + bh / 2);
          }
          c.restore();
        },
      });
    });
    // Wags-style talon: no base graphic (no telon pile, no base board art). The
    // base marker is just the position where the active card sits; both markers
    // preview as a card-back so the designer can place them.
    const t = lv.talon || {};
    ['base', 'deck'].forEach(which => {
      const slot = t[which]; if (!slot) return;
      const p = slot[o] || (slot[o] = { x: 540, y: 1400, scale: talonScale, depth: 25 });
      const img = getImg(spec.deck && spec.deck.card_back);
      const sc = p.scale != null ? p.scale : talonScale;
      const w = (img ? img.width : 200) * sc, h = (img ? img.height : 290) * sc;
      list.push({
        id: 'talon:' + which, kind: 'talon', label: 'talon_' + which, depth: p.depth || 25,
        pos: p, w, h, get x() { return p.x; }, get y() { return p.y; },
        draw(c) {
          // base marker is the active-card slot — draw at half alpha as a guide
          c.globalAlpha = which === 'base' ? 0.5 : 1;
          if (img) c.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);
          else drawCardRect(c, w, h, which, p.x, p.y);
          c.globalAlpha = 1;
          c.fillStyle = '#fff'; c.font = '20px Arial'; c.textAlign = 'center';
          c.fillText('talon_' + which, p.x, p.y + h / 2 + 18);
        },
      });
    });
    return list;
  }

  function drawBadge(c, x, y, w, h, color, label) {
    const r = 28;
    c.save();
    c.fillStyle = color || '#3a86ff';
    roundRect(c, x - w / 2, y - h / 2, w, h, r); c.fill();
    c.lineWidth = 6; c.strokeStyle = '#ffffff'; c.stroke();
    c.fillStyle = '#fff'; c.font = `bold ${Math.round(h * 0.32)}px Arial`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((label || '').toUpperCase(), x, y);
    c.restore();
  }
  function drawCardRect(c, w, h, label) {
    roundRect(c, -w / 2, -h / 2, w, h, 10);
    c.fillStyle = '#f4f6ff'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#26304d'; c.stroke();
    c.fillStyle = '#26304d'; c.font = `bold ${Math.round(h * 0.18)}px Arial`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 0, 0);
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---- render ----------------------------------------------------------------
  function render() {
    const spec = state.spec; if (!spec) return;
    const o = state.orient;
    const W = spec.canvas[o].width, H = spec.canvas[o].height;
    canvas.width = W; canvas.height = H;
    fitCanvas(W, H);

    // bg
    ctx.fillStyle = (spec.background && spec.background.color) || '#0e1a3a';
    ctx.fillRect(0, 0, W, H);
    const bgImg = (spec.background && spec.background[o] && spec.background[o].image)
      ? getImg(spec.background[o].image) : null;
    if (bgImg) {
      const s = Math.max(W / bgImg.width, H / bgImg.height);
      ctx.drawImage(bgImg, W / 2 - bgImg.width * s / 2, H / 2 - bgImg.height * s / 2, bgImg.width * s, bgImg.height * s);
    }

    // Draw every object at its real depth — selection never changes z-order.
    const list = items().sort((a, b) => (a.depth || 0) - (b.depth || 0));
    list.forEach(it => it.draw(ctx));
    state._items = list;

    // Selection outlines on top (object stays at its real depth). Primary is
    // brighter; other selected are dimmer.
    ctx.save();
    ctx.lineWidth = Math.max(2, W * 0.004); ctx.setLineDash([12, 8]);
    list.filter(it => state.selection.has(it.id)).forEach(it => {
      ctx.strokeStyle = it.id === state.selected ? '#4dd0ff' : '#7b5cff';
      ctx.strokeRect(it.x - it.w / 2, it.y - it.h / 2, it.w, it.h);
    });
    // Marquee box
    if (state.marquee) {
      const m = state.marquee;
      ctx.setLineDash([8, 6]); ctx.strokeStyle = '#4dd0ff';
      ctx.strokeRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.fillStyle = 'rgba(77,208,255,0.10)';
      ctx.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
    ctx.restore();
  }

  function fitCanvas(W, H) {
    const stage = $('#stage');
    const pad = 24;
    const aw = stage.clientWidth - pad, ah = stage.clientHeight - pad;
    const s = Math.min(aw / W, ah / H);
    canvas.style.width = Math.round(W * s) + 'px';
    canvas.style.height = Math.round(H * s) + 'px';
  }

  // ---- interaction -----------------------------------------------------------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * canvas.width,
      y: (e.clientY - r.top) / r.height * canvas.height,
    };
  }
  function hitTest(px, py) {
    const list = state._items || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (px >= it.x - it.w / 2 && px <= it.x + it.w / 2 && py >= it.y - it.h / 2 && py <= it.y + it.h / 2) return it;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const it = hitTest(p.x, p.y);
    // Shift-click toggles an object in the multi-selection.
    if (e.shiftKey) {
      if (it) { if (state.selection.has(it.id)) state.selection.delete(it.id); else state.selection.add(it.id); state.selected = it.id; }
      render(); inspector(); return;
    }
    // Plain click on an unselected object selects just it; clicking an
    // already-selected object keeps the group (so you can drag them together).
    if (it && !state.selection.has(it.id)) selectOnly(it.id);
    else if (it) state.selected = it.id;
    else selectOnly(null);

    if (it) {
      // Group drag — record each selected object's start position.
      const sel = selectedItems();
      state.dragging = { startP: p, items: sel.map(s => ({ kind: s.kind, pos: s.pos, yKey: s.yKey,
        x0: s.pos.x, y0: s.kind === 'title' ? s.pos[s.yKey] : s.pos.y })) };
      canvas.setPointerCapture(e.pointerId);
    } else {
      state.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };  // start a drag-box
    }
    render(); inspector();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toCanvas(e);
    if (state.dragging) {
      const dx = p.x - state.dragging.startP.x, dy = p.y - state.dragging.startP.y;
      state.dragging.items.forEach(d => {
        if (d.kind === 'title') { d.pos[d.yKey] = Math.round(d.y0 + dy); }
        else { d.pos.x = Math.round(d.x0 + dx); d.pos.y = Math.round(d.y0 + dy); }
      });
      render(); inspector(); syncJSON();
    } else if (state.marquee) {
      state.marquee.x1 = p.x; state.marquee.y1 = p.y; render();
    }
  });
  function endDrag() {
    if (state.marquee) {
      const m = state.marquee;
      const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1), X = Math.max(m.x0, m.x1), Y = Math.max(m.y0, m.y1);
      if (X - x > 8 && Y - y > 8) {
        state.selection = new Set((state._items || []).filter(it => it.x >= x && it.x <= X && it.y >= y && it.y <= Y).map(it => it.id));
        state.selected = [...state.selection][0] || null;
      }
      state.marquee = null; render(); inspector();
    }
    state.dragging = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- inspector -------------------------------------------------------------
  function inspector() {
    const who = $('#insp-who'), fields = $('#insp-fields');
    fields.innerHTML = '';

    const numRow = (lbl, obj, key, step) => row(lbl, () => {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = step || 1; inp.value = obj[key] != null ? obj[key] : '';
      inp.oninput = () => { obj[key] = parseFloat(inp.value); render(); syncJSON(); };
      return inp;
    });

    // Animation rows for any non-card item. `host` is the object that carries an
    // optional `anim` ({type,amount,duration}); the runtime's applyItemAnim plays it.
    const appendAnimFields = (host) => {
      fields.appendChild(row('Animation', () => {
        const sel = document.createElement('select');
        (PE.schema.ITEM_ANIM_STYLES || ['none']).forEach(s => {
          const o = document.createElement('option'); o.value = s;
          o.textContent = (PE.schema.ITEM_ANIM_LABELS || {})[s] || s; sel.appendChild(o);
        });
        sel.value = (host.anim && host.anim.type) || 'none';
        sel.onchange = () => {
          if (sel.value === 'none') { delete host.anim; }
          else {
            host.anim = host.anim || {};
            host.anim.type = sel.value;
            if (host.anim.duration == null) host.anim.duration = 1500;
            if (['float', 'sway', 'pulse'].includes(sel.value) && host.anim.amount == null)
              host.anim.amount = sel.value === 'pulse' ? 1.08 : (sel.value === 'sway' ? 5 : 18);
          }
          render(); inspector(); syncJSON();
        };
        return sel;
      }));
      const a = host.anim;
      if (a && a.type && a.type !== 'none') {
        if (['float', 'sway', 'pulse'].includes(a.type)) {
          fields.appendChild(numRow(a.type === 'pulse' ? 'Scale ×' : (a.type === 'sway' ? 'Angle°' : 'Distance'), a, 'amount', 0.01));
        }
        fields.appendChild(numRow('Duration ms', a, 'duration'));
      }
    };

    // Multi-select: bulk move (drag the group) + bulk resize.
    if (state.selection.size > 1) {
      const sel = selectedItems();
      who.textContent = state.selection.size + ' objects selected';
      fields.appendChild(applyRow('Scale ×', '1.1', (f) => {
        sel.forEach(it => { if (it.pos) it.pos.scale = +(((it.pos.scale != null ? it.pos.scale : 1) * f)).toFixed(3); });
        render(); syncJSON();
      }));
      fields.appendChild(applyRow('Scale =', '1', (v) => {
        sel.forEach(it => { if (it.pos) it.pos.scale = v; }); render(); syncJSON();
      }));
      fields.appendChild(removeRow(() => { sel.forEach(removeAny); state.selection.clear(); }));
      const tip = document.createElement('div'); tip.style.cssText = 'font-size:11px;color:var(--dim);margin-top:6px';
      tip.textContent = 'Drag any selected object to move the group. Shift-click to add/remove; drag empty space to box-select.';
      fields.appendChild(tip);
      return;
    }

    const it = (state._items || []).find(x => x.id === state.selected);
    if (!it) {
      // Nothing selected: on a level scene, show the SCENE-WIDE card intro that
      // applies to every card at once (no per-card intro any more).
      const lv = state.spec && state.spec.levels[state.scene];
      if (lv) {
        who.textContent = 'Scene "' + state.scene + '" — card intro';
        const deal = lv.deal || (lv.deal = { style: 'deal_curve', stagger: 60, duration: 450 });
        fields.appendChild(row('Card intro', () => {
          const sel = document.createElement('select');
          PE.schema.INTRO_STYLES.forEach(s => {
            const o = document.createElement('option'); o.value = s;
            o.textContent = (PE.schema.INTRO_LABELS || {})[s] || s; sel.appendChild(o);
          });
          sel.value = deal.style || 'deal_curve';
          sel.onchange = () => { deal.style = sel.value; syncJSON(); };
          return sel;
        }));
        fields.appendChild(numRow('Stagger ms', deal, 'stagger'));
        fields.appendChild(numRow('Duration ms', deal, 'duration'));
        const tip = document.createElement('div'); tip.style.cssText = 'font-size:11px;color:var(--dim);margin-top:6px;line-height:1.4';
        tip.textContent = 'Applies to ALL cards in this scene at once. Select a card for its own X/Y/scale/obstacle.';
        fields.appendChild(tip);
      } else {
        who.textContent = 'Nothing selected';
      }
      return;
    }
    who.textContent = it.label;

    if (it.kind === 'title') {
      fields.appendChild(row('Text', () => {
        const inp = document.createElement('input'); inp.value = it.pos.text || '';
        inp.oninput = () => { it.pos.text = inp.value; render(); syncJSON(); }; return inp;
      }));
      fields.appendChild(numRow('Y', it.pos, it.yKey));
      fields.appendChild(numRow('Size', it.pos, 'size', 0.001));
    } else if (it.kind === 'card') {
      fields.appendChild(numRow('X', it.pos, 'x'));
      fields.appendChild(numRow('Y', it.pos, 'y'));
      fields.appendChild(numRow('Scale', it.pos, 'scale', 0.001));
      fields.appendChild(numRow('Depth', it.pos, 'depth'));
      // Layer up/down — raise/lower this card's depth (what renders on top, and
      // what's "above" for coverage / flipping).
      fields.appendChild(twoBtnRow('Layer', 'Bring ↑', 'Send ↓',
        () => { it.pos.depth = (it.pos.depth || 0) + 1; render(); inspector(); syncJSON(); },
        () => { it.pos.depth = (it.pos.depth || 0) - 1; render(); inspector(); syncJSON(); }));
      // Manual dependencies — which cards cover this one (it flips only when they
      // are all cleared). Empty = a top card that starts face-up.
      const _lv = state.spec.levels[state.scene];
      if (_lv) {
        const gf = _lv.game_flow || (_lv.game_flow = { mode: 'dependency' });
        gf.dependencies = gf.dependencies || {};
        fields.appendChild(row('Depends on', () => {
          const inp = document.createElement('input');
          inp.value = (gf.dependencies[it.card.id] || []).join(', ');
          inp.placeholder = 'covering card ids, e.g. s3, s5';
          inp.oninput = () => {
            const ids = inp.value.split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length) gf.dependencies[it.card.id] = ids; else delete gf.dependencies[it.card.id];
            refreshFlowFromDeps(_lv); render(); syncJSON();
          };
          return inp;
        }));
      }
      fields.appendChild(numRow('Rot (r)', it.pos, 'r', 0.01));
      // Card identity — suit + rank. Changing it keeps the card's NAME, art and
      // game value in sync (label shows "id (suit_rank)").
      {
        const CARD_SUITS = ['hearts', 'clubs', 'diamonds', 'spades'];
        const CARD_RANKS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k'];
        const parts = (it.card.face || 'hearts_a').split('_');
        const setFace = (suit, rank) => {
          it.card.face = suit + '_' + rank;
          it.card.asset = PE.schema.faceToAsset(it.card.face);
          render(); inspector(); syncJSON();
        };
        fields.appendChild(row('Suit', () => {
          const sel = document.createElement('select');
          CARD_SUITS.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
          sel.value = CARD_SUITS.includes(parts[0]) ? parts[0] : 'hearts';
          sel.onchange = () => setFace(sel.value, (it.card.face || 'hearts_a').split('_')[1]);
          return sel;
        }));
        fields.appendChild(row('Rank', () => {
          const sel = document.createElement('select');
          CARD_RANKS.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r.toUpperCase(); sel.appendChild(o); });
          sel.value = CARD_RANKS.includes(parts[1]) ? parts[1] : 'a';
          sel.onchange = () => setFace((it.card.face || 'hearts_a').split('_')[0], sel.value);
          return sel;
        }));
      }
      // Custom art — keeps the card's name in sync with the dropped file when its
      // name is a recognizable card (e.g. "Clubs-J.png" -> clubs_j).
      fields.appendChild(replaceImageRow('Custom art', (uri, name) => {
        it.card.asset = uri;
        const face = PE.schema.assetToFace(name);
        if (face) it.card.face = face;
      }));
      // Obstacle selector — mark this card as Normal or any obstacle type.
      fields.appendChild(row('Obstacle', () => {
        const sel = document.createElement('select');
        const none = document.createElement('option'); none.value = ''; none.textContent = 'Normal'; sel.appendChild(none);
        // Only these obstacles are offered for now (the rest are hidden).
        const ALLOWED_OBSTACLES = ['LOCK_AND_KEY', 'DOUBLE_VALUE_CARD', 'TRAP_CARD', 'MIRROR_CARD', 'COLOR_CARD', 'COLOR_SUIT_CARD'];
        Object.entries((PE.obstacle || {}).OBSTACLES || {}).forEach(([t, d]) => {
          if (!ALLOWED_OBSTACLES.includes(t)) return;
          const o = document.createElement('option'); o.value = t; o.textContent = d.label + (d.advanced ? ' (adv)' : ''); sel.appendChild(o);
        });
        sel.value = (it.card.obstacle && it.card.obstacle.type) || '';
        sel.onchange = () => {
          if (!sel.value) { delete it.card.obstacle; }
          else {
            const def = PE.obstacle.OBSTACLES[sel.value];
            const ob = { type: sel.value };
            (def.params || []).forEach(p => { if (p.default != null) ob[p.key] = p.default; });
            it.card.obstacle = ob;
          }
          render(); inspector(); syncJSON();
        };
        return sel;
      }));
      if (it.card.obstacle && PE.obstacle.OBSTACLES[it.card.obstacle.type]) {
        const def = PE.obstacle.OBSTACLES[it.card.obstacle.type];
        const ob = it.card.obstacle;
        (def.params || []).forEach(p => {
          if (p.type === 'number') fields.appendChild(numRow(p.label, ob, p.key));
          else if (p.type === 'select') fields.appendChild(row(p.label, () => {
            const s = document.createElement('select');
            p.options.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; s.appendChild(o); });
            s.value = ob[p.key] != null ? ob[p.key] : (p.default || p.options[0]);
            s.onchange = () => { ob[p.key] = s.value; render(); syncJSON(); };
            return s;
          }));
          else fields.appendChild(row(p.label, () => {
            const i = document.createElement('input');
            i.value = ob[p.key] != null ? (Array.isArray(ob[p.key]) ? ob[p.key].join(',') : ob[p.key]) : '';
            i.placeholder = p.type === 'card' ? 'e.g. s5' : (p.type === 'list' ? 'comma,separated' : '');
            i.oninput = () => { const v = i.value.trim(); ob[p.key] = p.type === 'list' ? v.split(',').map(x => x.trim()).filter(Boolean) : v; syncJSON(); };
            return i;
          }));
        });
        const hint = document.createElement('div'); hint.style.cssText = 'font-size:11px;color:var(--dim);margin-top:4px;line-height:1.35'; hint.textContent = def.desc; fields.appendChild(hint);
      }
      fields.appendChild(removeRow(() => removeCard(state.scene, it.card.id)));
    } else if (it.kind === 'endtitle') {
      const ec = state.spec.end_card || (state.spec.end_card = {});
      fields.appendChild(row('Text', () => { const i = document.createElement('input'); i.value = ec.title || 'You Win!'; i.oninput = () => { ec.title = i.value; render(); syncJSON(); }; return i; }));
      fields.appendChild(numRow('X', it.pos, 'x'));
      fields.appendChild(numRow('Y', it.pos, 'y'));
      fields.appendChild(numRow('Size', it.pos, 'size'));
    } else if (it.kind === 'endcta') {
      const ec = state.spec.end_card || (state.spec.end_card = {});
      fields.appendChild(row('Text', () => { const i = document.createElement('input'); i.value = ec.cta_text || 'PLAY NOW'; i.oninput = () => { ec.cta_text = i.value; render(); syncJSON(); }; return i; }));
      fields.appendChild(numRow('X', it.pos, 'x'));
      fields.appendChild(numRow('Y', it.pos, 'y'));
      fields.appendChild(numRow('Scale', it.pos, 'scale', 0.01));
      // Same CTA behaviour as the "CTA button" item — opens the store via openCTA
      // (iOS → Apple URL, Android → Store URL). All CTAs share these URLs.
      fields.appendChild(row('Store URL', () => { const i = document.createElement('input'); i.value = ec.store_url || ''; i.placeholder = 'Google Play URL (Android)'; i.oninput = () => { ec.store_url = i.value; syncJSON(); }; return i; }));
      fields.appendChild(row('Apple URL', () => { const i = document.createElement('input'); i.value = ec.apple_url || ''; i.placeholder = 'App Store URL (iOS)'; i.oninput = () => { ec.apple_url = i.value; syncJSON(); }; return i; }));
      fields.appendChild(replaceImageRow('Image', (uri) => { ec.cta_image = uri; }));
      const ctaNote = document.createElement('div');
      ctaNote.style.cssText = 'font-size:11px;color:var(--dim);margin:2px 0 6px;line-height:1.35';
      ctaNote.textContent = 'Tapping opens the store: iOS → Apple URL, Android → Store URL. Shared by every CTA button + end-card CTA.';
      fields.appendChild(ctaNote);
    } else if (it.kind === 'bg') {
      fields.appendChild(row('Fit', () => {
        const sel = document.createElement('select');
        ['none', 'cover'].forEach(v => { const op = document.createElement('option'); op.value = v; op.textContent = v; sel.appendChild(op); });
        sel.value = it.layer.fit || 'none';
        sel.onchange = () => { it.layer.fit = sel.value; render(); inspector(); syncJSON(); };
        return sel;
      }));
      fields.appendChild(numRow('X', it.pos, 'x'));
      fields.appendChild(numRow('Y', it.pos, 'y'));
      fields.appendChild(numRow('Scale', it.pos, 'scale', 0.001));
      fields.appendChild(numRow('Depth', it.layer, 'depth'));
      fields.appendChild(replaceImageRow('Image', (uri) => { it.layer.image = uri; if (it.layer.image_landscape) it.layer.image_landscape = uri; }));
      // CTA buttons open the store URL (iOS → Apple URL, Android → Store URL) via
      // openCTA — the same check the Wags ads use. All CTA buttons share these URLs.
      if (it.layer.cta) {
        const ec = state.spec.end_card || (state.spec.end_card = {});
        fields.appendChild(row('Store URL', () => {
          const i = document.createElement('input'); i.value = ec.store_url || ''; i.placeholder = 'Google Play URL (Android)';
          i.oninput = () => { ec.store_url = i.value; syncJSON(); }; return i;
        }));
        fields.appendChild(row('Apple URL', () => {
          const i = document.createElement('input'); i.value = ec.apple_url || ''; i.placeholder = 'App Store URL (iOS)';
          i.oninput = () => { ec.apple_url = i.value; syncJSON(); }; return i;
        }));
        const n = document.createElement('div');
        n.style.cssText = 'font-size:11px;color:var(--dim);margin:2px 0 6px;line-height:1.35';
        n.textContent = 'Tapping opens the store: iOS → Apple URL, Android → Store URL. Shared by every CTA button + end-card CTA.';
        fields.appendChild(n);
        // Animated hand pointer tapping this CTA on the end scene.
        fields.appendChild(checkRow('Show hand pointer', () => !!it.layer.hand, (v) => {
          if (v) it.layer.hand = true; else delete it.layer.hand;
        }));
      }
      // Animation is per scene — set on this scene's layout, so it plays only here.
      appendAnimFields(layerSceneLayout(it.layer, state.scene));
      // Scene presence — show in every scene, or pick specific scenes. Position &
      // scale (X/Y/Scale above) are stored PER scene, so the same image can sit
      // differently in each scene it appears in.
      fields.appendChild(checkRow('All scenes', () => layerAllScenes(it.layer), (v) => {
        if (v) delete it.layer.scenes;
        else it.layer.scenes = [state.scene];
      }));
      if (!layerAllScenes(it.layer)) {
        allSceneIds().forEach(sid => {
          fields.appendChild(checkRow('  • ' + sceneLabel(sid),
            () => Array.isArray(it.layer.scenes) && it.layer.scenes.includes(sid),
            (v) => {
              let arr = Array.isArray(it.layer.scenes) ? it.layer.scenes.slice() : [];
              if (v) { if (!arr.includes(sid)) arr.push(sid); } else arr = arr.filter(x => x !== sid);
              if (!arr.length) arr = [state.scene];   // never fully empty
              it.layer.scenes = arr;
            }));
        });
      }
      const sceneTip = document.createElement('div');
      sceneTip.style.cssText = 'font-size:11px;color:var(--dim);margin:2px 0 6px;line-height:1.35';
      sceneTip.textContent = 'Editing position & scale for the "' + sceneLabel(state.scene) + '" scene.';
      fields.appendChild(sceneTip);
      fields.appendChild(row('', () => {
        const b = document.createElement('button'); b.textContent = 'Remove layer'; b.className = 'danger';
        b.style.background = 'var(--danger)'; b.style.borderColor = 'var(--danger)';
        b.onclick = () => {
          const arr = state.spec.background.layers, idx = arr.indexOf(it.layer);
          if (idx >= 0) arr.splice(idx, 1);
          selectOnly(null); render(); inspector(); syncJSON();
        };
        return b;
      }));
    } else { // option / talon
      fields.appendChild(numRow('X', it.pos, 'x'));
      fields.appendChild(numRow('Y', it.pos, 'y'));
      fields.appendChild(numRow('Scale', it.pos, 'scale', 0.001));
      if (it.kind === 'talon') {
        fields.appendChild(numRow('Depth', it.pos, 'depth'));
        // Wags-style talon: no base graphic (no telon pile, no base board art).
        // The talon is just the active card; only the card-back art (used by the
        // deck / active card) is configurable.
        fields.appendChild(replaceImageRow('Card back', (uri) => {
          state.spec.deck = state.spec.deck || {};
          state.spec.deck.card_back = uri;
        }));
        fields.appendChild(removeRow(() => removeTalonItem(it)));
      }
      if (it.kind === 'option') {
        fields.appendChild(row('Label', () => {
          const inp = document.createElement('input'); inp.value = it.opt.label || '';
          inp.oninput = () => { it.opt.label = inp.value; render(); syncJSON(); }; return inp;
        }));
        fields.appendChild(replaceImageRow('Image', (uri) => { it.opt.image = uri; }));
        fields.appendChild(removeRow(() => {
          state.spec.start_scene.options = state.spec.start_scene.options.filter(o => o.id !== it.opt.id);
        }));
      }
      if (it.kind === 'logo') {
        fields.appendChild(replaceImageRow('Image', (uri) => { state.spec.logo.image = uri; }));
        appendAnimFields(state.spec.logo);
        fields.appendChild(removeRow(() => { delete state.spec.logo; }));
      }
    }
  }
  function row(label, makeInput) {
    const d = document.createElement('div'); d.className = 'row';
    const l = document.createElement('label'); l.textContent = label;
    d.appendChild(l); d.appendChild(makeInput()); return d;
  }
  // A red "Remove" button row that runs fn() then deselects + refreshes.
  function removeRow(fn) {
    return row('', () => {
      const b = document.createElement('button'); b.textContent = 'Remove';
      b.style.background = 'var(--danger)'; b.style.borderColor = 'var(--danger)';
      b.onclick = () => { fn(); selectOnly(null); render(); inspector(); syncJSON(); };
      return b;
    });
  }
  // A "Replace image" button row — pick an image file and apply it as a data URI.
  function replaceImageRow(label, applyUri) {
    return row(label || '', () => {
      const b = document.createElement('button'); b.textContent = '⟳ Replace image';
      b.onclick = () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = () => {
          const f = inp.files && inp.files[0]; if (!f) return;
          status('Reading image…');
          const fr = new FileReader();
          fr.onerror = () => status('Could not read the file.', 'err');
          fr.onload = () => { applyUri(fr.result, f.name); render(); inspector(); syncJSON(); status('✓ Image replaced.', 'ok'); };
          fr.readAsDataURL(f);
        };
        inp.click();
      };
      return b;
    });
  }
  // A label + checkbox row.
  function checkRow(label, getVal, setVal) {
    const d = document.createElement('div'); d.className = 'row';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!getVal(); inp.style.flex = 'none'; inp.style.width = 'auto';
    inp.onchange = () => { setVal(inp.checked); render(); inspector(); syncJSON(); };
    d.appendChild(l); d.appendChild(inp); return d;
  }
  // A label + two buttons (e.g. Layer Bring↑ / Send↓).
  function twoBtnRow(label, t1, t2, f1, f2) {
    const d = document.createElement('div'); d.className = 'row';
    const l = document.createElement('label'); l.textContent = label;
    const b1 = document.createElement('button'); b1.textContent = t1; b1.style.flex = '1'; b1.onclick = f1;
    const b2 = document.createElement('button'); b2.textContent = t2; b2.style.flex = '1'; b2.onclick = f2;
    d.appendChild(l); d.appendChild(b1); d.appendChild(b2); return d;
  }
  // Recompute initially_playable + deal_order from the level's dependency map.
  // A card starts face-up iff it has no dependencies (nothing covers it).
  function refreshFlowFromDeps(lv) {
    const gf = lv.game_flow || (lv.game_flow = { mode: 'dependency' });
    const deps = gf.dependencies || (gf.dependencies = {});
    const ids = lv.cards.map(c => c.id);
    gf.initially_playable = ids.filter(id => !(deps[id] && deps[id].length));
    gf.deal_order = (gf.deal_order || []).filter(id => ids.includes(id));
    ids.forEach(id => { if (!gf.deal_order.includes(id)) gf.deal_order.push(id); });
  }

  // Recompute which cards are covered (and so face-up / playable) from the actual
  // card layout: a card is covered by any higher-depth card that overlaps it.
  // Rebuilds the level's dependency graph, initially_playable and deal_order so
  // the flip order matches what you've arranged.
  function recomputeCoverage(silent) {
    const spec = state.spec;
    const lvId = spec.levels[state.scene] ? state.scene : Object.keys(spec.levels)[0];
    const lv = spec.levels[lvId]; if (!lv || !lv.cards) { if (!silent) status('Open a level scene first.', 'err'); return; }
    const o = state.orient;
    const cardScale = (spec.scales.card || {})[o] || 0.35;
    const box = (c) => {
      const p = c[o] || {}; const img = getImg(c.asset || PE.schema.faceToAsset(c.face));
      const sc = p.scale != null ? p.scale : cardScale;
      return { x: p.x, y: p.y, w: (img ? img.width : 240) * sc, h: (img ? img.height : 340) * sc, depth: p.depth || 0 };
    };
    const overlaps = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
      const iy = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
      return (ix * iy) > Math.min(a.w * a.h, b.w * b.h) * 0.22;   // >22% of the smaller card
    };
    const boxes = {}, idx = {}; lv.cards.forEach((c, i) => { boxes[c.id] = box(c); idx[c.id] = i; });
    // A card is covered by any card that OVERLAPS it and is above it — higher
    // depth, or (equal depth) later in the list (render order). Non-overlapping
    // cards never cover each other regardless of depth.
    const above = (b, a) => boxes[b].depth > boxes[a].depth || (boxes[b].depth === boxes[a].depth && idx[b] > idx[a]);
    const deps = {};
    lv.cards.forEach(a => {
      deps[a.id] = lv.cards.filter(b => b.id !== a.id && overlaps(boxes[a.id], boxes[b.id]) && above(b.id, a.id)).map(b => b.id);
    });
    lv.game_flow = lv.game_flow || { mode: 'dependency' };
    lv.game_flow.dependencies = deps;
    lv.game_flow.deal_order = lv.cards.map(c => c.id).sort((x, y) => boxes[x].depth - boxes[y].depth);
    refreshFlowFromDeps(lv);
    syncJSON(); render();
    if (!silent) status(`Flip order recomputed for "${lvId}" — ${lv.game_flow.initially_playable.length} top card(s) start face-up.`, 'ok');
  }

  // A label + number input + Apply button (used for bulk operations).
  function applyRow(label, def, apply) {
    const d = document.createElement('div'); d.className = 'row';
    const l = document.createElement('label'); l.textContent = label;
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = 0.05; inp.value = def; inp.style.flex = '1';
    const b = document.createElement('button'); b.textContent = 'Apply'; b.style.padding = '4px 10px';
    b.onclick = () => { const v = parseFloat(inp.value); if (!isNaN(v)) apply(v); };
    d.appendChild(l); d.appendChild(inp); d.appendChild(b); return d;
  }
  // Remove any object by kind (used by bulk remove).
  function removeAny(it) {
    const spec = state.spec;
    if (it.kind === 'card') removeCard(state.scene, it.card.id);
    else if (it.kind === 'bg') { const a = spec.background.layers, i = a.indexOf(it.layer); if (i >= 0) a.splice(i, 1); }
    else if (it.kind === 'option') { spec.start_scene.options = spec.start_scene.options.filter(o => o.id !== it.opt.id); }
    else if (it.kind === 'logo') { delete spec.logo; }
    else if (it.kind === 'talon') removeTalonItem(it);
  }
  // Add a talon deck (stock) + base card to the CURRENT level, with no brown board.
  // Editable afterwards via the inspector (X/Y/scale/depth). Only adds what's missing.
  function addTalon() {
    const spec = state.spec; if (!spec) { status('Load a spec first.', 'err'); return; }
    const lv = spec.levels[state.scene];
    if (!lv) { status('Open a level/game scene to add a talon.', 'err'); return; }
    lv.talon = lv.talon || { sequence: [] };
    if (!Array.isArray(lv.talon.sequence)) lv.talon.sequence = [];
    const pw = spec.canvas.portrait, lwc = spec.canvas.landscape;
    const ps = (spec.scales.talon || {}).portrait || 1.1;
    const ls = (spec.scales.talon || {}).landscape || 1.1;
    let added = [];
    if (!lv.talon.base) {
      lv.talon.base = {
        portrait: { x: Math.round(pw.width / 2), y: Math.round(pw.height * 0.8), scale: ps, depth: 25 },
        landscape: { x: Math.round(lwc.width * 0.56), y: Math.round(lwc.height * 0.78), scale: ls, depth: 25 },
      };
      added.push('base');
    }
    if (!lv.talon.deck) {
      lv.talon.deck = {
        portrait: { x: Math.round(pw.width * 0.31), y: Math.round(pw.height * 0.8), scale: ps, depth: 26 },
        landscape: { x: Math.round(lwc.width * 0.42), y: Math.round(lwc.height * 0.78), scale: ls, depth: 26 },
      };
      added.push('deck');
    }
    // Wags-style talon: no base graphic at all — no telon pile, no base board
    // art, no drawn brown board. The talon is just the active/current card.
    delete lv.telon;
    spec.deck = spec.deck || {};
    delete spec.deck.talon_image;
    delete spec.deck.talon_base;
    spec.talon_panel = false;        // no programmatic brown board
    spec.talon_base_graphic = false; // no base graphic behind the active card
    selectOnly('talon:base'); render(); inspector(); syncJSON();
    status(added.length ? `✓ Talon ${added.join(' + ')} added to "${state.scene}" — just the active card, no base graphic (like Wags).`
                        : `Talon already present in "${state.scene}" — no base graphic (like Wags).`, 'ok');
  }

  // Add a new card to the current level, centred, ready to drag/place. Defaults
  // to a placeholder face; set its image/obstacle in the inspector.
  function addCard() {
    const spec = state.spec; if (!spec) { status('Load a spec first.', 'err'); return; }
    const lv = spec.levels[state.scene];
    if (!lv) { status('Open a level scene to add a card.', 'err'); return; }
    lv.cards = lv.cards || [];
    const ids = new Set(lv.cards.map(c => c.id));
    let n = 0; while (ids.has('s' + n)) n++;
    const id = 's' + n;
    const pw = spec.canvas.portrait, lwc = spec.canvas.landscape;
    const cs = spec.scales.card || {};
    const face = 'hearts_a';
    lv.cards.push({
      id, face, asset: PE.schema.faceToAsset(face),
      portrait: { x: Math.round(pw.width / 2), y: Math.round(pw.height / 2), scale: cs.portrait || 0.35, depth: 1 },
      landscape: { x: Math.round(lwc.width / 2), y: Math.round(lwc.height / 2), scale: cs.landscape || 0.27, depth: 1 },
    });
    refreshFlowFromDeps(lv);
    selectOnly('card:' + id); render(); inspector(); syncJSON();
    status(`✓ Card "${id}" added to "${state.scene}" — drag to place; set its image/obstacle in the inspector.`, 'ok');
  }

  // Add a CTA button — a tappable image that opens the store URL via openCTA
  // (iOS → Apple URL, Android → Google URL, same as the Wags ads). Stored as a
  // background-layer image with cta:true, so it gets all the scene-scoping,
  // per-scene position/size and animation controls images have.
  // A background-layer id that isn't already taken (prefix + lowest free index),
  // so adding/removing layers never produces a duplicate id (and duplicate label).
  function nextLayerId(prefix) {
    const used = new Set(((state.spec.background || {}).layers || []).map(l => l.id));
    let n = 0; while (used.has(prefix + n)) n++;
    return prefix + n;
  }
  // Repair duplicate/missing background-layer ids (older specs could collide),
  // so each layer has a unique inspector name + texture key.
  function dedupeLayerIds() {
    const layers = ((state.spec || {}).background || {}).layers || [];
    const seen = new Set();
    layers.forEach(L => {
      const prefix = L.cta ? 'cta' : 'bg';
      if (L.id == null || seen.has(L.id)) {
        let n = 0; while (seen.has(prefix + n)) n++;
        L.id = prefix + n;
      }
      seen.add(L.id);
    });
  }
  function addCtaButton() {
    const spec = state.spec; if (!spec) { status('Load a spec first.', 'err'); return; }
    spec.background = spec.background || { color: '#142a6c', layers: [] };
    spec.background.layers = spec.background.layers || [];
    spec.end_card = spec.end_card || {};
    const pw = spec.canvas.portrait, lw = spec.canvas.landscape;
    const id = nextLayerId('cta');
    spec.background.layers.push({
      id, image: 'engine/assets/cta/play_now.webp', fit: 'none', depth: 90, cta: true,
      portrait: { x: Math.round(pw.width / 2), y: Math.round(pw.height * 0.82), scale: 0.9 },
      landscape: { x: Math.round(lw.width / 2), y: Math.round(lw.height * 0.82), scale: 0.6 },
    });
    selectOnly('bg:' + id); render(); inspector(); syncJSON();
    status('✓ CTA button added — tapping opens the store URL (set it in the inspector). Drag to place.', 'ok');
  }

  // Small popup anchored under the "Add item" button: choose Image, Card or CTA.
  function closeAddMenu() { const m = document.getElementById('add-menu'); if (m) m.remove(); }
  function openAddMenu(btn) {
    closeAddMenu();
    const menu = document.createElement('div');
    menu.id = 'add-menu';
    menu.style.cssText = 'position:absolute;z-index:1000;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;box-shadow:0 8px 24px #0008';
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.round(r.left) + 'px';
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    const mk = (label, fn) => {
      const b = document.createElement('button'); b.textContent = label; b.style.textAlign = 'left';
      b.onclick = () => { closeAddMenu(); fn(); };
      return b;
    };
    menu.appendChild(mk('🖼  Image', () => $('#file-bg').click()));
    menu.appendChild(mk('🃏  Card', addCard));
    menu.appendChild(mk('🔘  CTA button', addCtaButton));
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('pointerdown', function onDown(ev) {
      if (menu.contains(ev.target)) { document.addEventListener('pointerdown', onDown, { once: true }); return; }
      closeAddMenu();
    }, { once: true }), 0);
  }

  // Remove a talon piece: the telon graphic, the waste base, or the stock deck (+ its cards).
  function removeTalonItem(it) {
    const lv = state.spec.levels[state.scene]; if (!lv) return;
    if (it.id === 'telon') { delete lv.telon; delete state.spec.deck.talon_image; }
    else if (it.id === 'talon:base') { if (lv.talon) delete lv.talon.base; }
    else if (it.id === 'talon:deck') { if (lv.talon) { delete lv.talon.deck; lv.talon.sequence = []; } }
  }
  // Remove a card and scrub it from the level's game flow so the deal stays valid.
  function removeCard(levelId, cardId) {
    const lv = state.spec.levels[levelId]; if (!lv) return;
    lv.cards = (lv.cards || []).filter(c => c.id !== cardId);
    const gf = lv.game_flow || {};
    if (gf.deal_order) gf.deal_order = gf.deal_order.filter(k => k !== cardId);
    if (gf.initially_playable) gf.initially_playable = gf.initially_playable.filter(k => k !== cardId);
    if (gf.dependencies) {
      delete gf.dependencies[cardId];
      for (const k of Object.keys(gf.dependencies)) gf.dependencies[k] = gf.dependencies[k].filter(b => b !== cardId);
    }
  }

  // ---- generate --------------------------------------------------------------
  // Open the playable in a new tab to play/test it live (no download).
  function liveTest() {
    const net = $('#net-select').value;
    // Open the window synchronously (inside the click gesture) to dodge popup
    // blockers, then point it at the assembled playable once it's built.
    const w = window.open('', '_blank');
    if (w) w.document.write('<title>Live Test</title><body style="margin:0;background:#000;color:#9fb;font-family:sans-serif"><p style="padding:16px">Building playable…</p></body>');
    status('Building live preview…');
    PE.assembler.assemble(state.spec, { compress: true, network: net }, (m) => status(m))
      .then(res => {
        const url = URL.createObjectURL(new Blob([res.html], { type: 'text/html' }));
        if (w) w.location.href = url; else PE.assembler.download(res.html, 'live-test.html');
        status('Live test opened in a new tab. Play it there.', 'ok');
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      })
      .catch(e => { if (w) w.close(); status('Live test failed: ' + e.message, 'err'); console.error(e); });
  }

  // Build inline + split for the selected network and download a zip
  // (<net>/inline/index.html + <net>/split/{index.html,assets/index.js}).
  async function generate() {
    const btn = $('#btn-generate'); btn.disabled = true;
    const net = $('#net-select').value;
    try {
      const pkg = await PE.assembler.buildPackage(state.spec, [net], { compress: true }, (m) => status(m));
      PE.assembler.downloadBlob(pkg.blob, (state.spec.name || 'playable') + '_' + net + '.zip');
      const s = pkg.summary[0];
      const mb = (s.bytes / 1024 / 1024).toFixed(2), capmb = (s.cap / 1024 / 1024).toFixed(1);
      status(`Built ${net} (inline + split) — ${mb} MB${s.over ? ` ⚠ OVER ${capmb} MB cap` : ` (cap ${capmb} MB)`}. Zip downloaded.`, s.over ? 'warn' : 'ok');
    } catch (e) {
      status('Generate failed: ' + e.message, 'err'); console.error(e);
    } finally { btn.disabled = false; }
  }

  // Build inline + split for every network, packaged in one zip — the same build
  // method as the Wags Water ad (per-network inline/ + split/).
  async function buildAll() {
    const btn = $('#btn-build-all'); btn.disabled = true;
    try {
      const pkg = await PE.assembler.buildPackage(state.spec, PE.schema.NETWORKS, { compress: true }, (m) => status(m));
      PE.assembler.downloadBlob(pkg.blob, (state.spec.name || 'playable') + '_all-networks.zip');
      const over = pkg.summary.filter(r => r.over).map(r => r.network);
      const sizes = pkg.summary.map(r => `${r.network} ${(r.bytes / 1024 / 1024).toFixed(2)}MB`).join(' · ');
      status(`Built ${pkg.summary.length} networks × (inline+split): ${sizes}.` + (over.length ? ` ⚠ over cap: ${over.join(', ')}` : ' Zip downloaded.'), over.length ? 'warn' : 'ok');
    } catch (e) {
      status('Build all failed: ' + e.message, 'err'); console.error(e);
    } finally { btn.disabled = false; }
  }

  // ---- wire up ---------------------------------------------------------------
  $('#btn-orient').onclick = () => {
    state.orient = state.orient === 'portrait' ? 'landscape' : 'portrait';
    $('#btn-orient').textContent = (state.orient === 'portrait' ? 'Portrait' : 'Landscape') + ' ⇄';
    selectOnly(null); render(); inspector();
  };
  $('#btn-test').onclick = liveTest;
  $('#btn-build-all').onclick = buildAll;
  $('#chk-difficulty').onchange = (e) => setDifficultyMode(e.target.checked);
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-add-talon').onclick = addTalon;
  $('#btn-add-item').onclick = (e) => openAddMenu(e.currentTarget);
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;  // leave native field undo alone
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); if (e.shiftKey) redo(); else undo();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); redo();
    }
  });
  $('#net-select').onchange = () => { if (state.spec) { state.spec.network = $('#net-select').value; syncJSON(); } };
  $('#btn-apply').onclick = applyJSON;
  $('#btn-save').onclick = () => PE.assembler.download(JSON.stringify(state.spec, null, 2), (state.spec.name || 'spec') + '.json');
  $('#btn-reload').onclick = loadSample;
  $('#btn-generate').onclick = generate;
  $('#file-bg').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!state.spec) { status('Load a spec first (Reload Sample) before adding a background.', 'err'); return; }
    if (!state.spec.background) state.spec.background = { color: '#142a6c', layers: [] };
    status('Reading image…');
    const fr = new FileReader();
    fr.onerror = () => status('Could not read the file.', 'err');
    fr.onload = () => {
      const dataURI = fr.result;
      // Probe natural size so we can place the image at a sensible, visible scale
      // (~40% of canvas width) instead of dead-center at scale 1.
      const probe = new Image();
      probe.onerror = () => status('That file is not a valid image.', 'err');
      probe.onload = () => {
        try {
          const spec = state.spec;
          spec.background.layers = spec.background.layers || [];
          const id = nextLayerId('bg');
          const pw = spec.canvas.portrait, lw = spec.canvas.landscape;
          const ps = +((pw.width * 0.4) / probe.width).toFixed(3);
          const ls = +((lw.width * 0.4) / probe.width).toFixed(3);
          spec.background.layers.push({ id, image: dataURI, fit: 'none', depth: 0,
            portrait: { x: Math.round(pw.width / 2), y: Math.round(pw.height * 0.35), scale: ps },
            landscape: { x: Math.round(lw.width / 2), y: Math.round(lw.height * 0.35), scale: ls } });
          // Jump to the Difficulty scene (bg draws on top of nothing there) and select
          // the new layer so it is unmistakably visible.
          const ss = spec.start_scene;
          if (ss && ss.type === 'difficulty') { state.scene = 'difficulty'; buildTabs(); }
          selectOnly('bg:' + id);
          render(); inspector(); syncJSON();
          status('✓ Added background image "' + id + '" (' + probe.width + '×' + probe.height + '). Drag to place; set Scale/Fit/Depth in the inspector.', 'ok');
        } catch (err) { status('Add background failed: ' + err.message, 'err'); }
      };
      probe.src = dataURI;
    };
    fr.readAsDataURL(f);
    e.target.value = '';
  };
  $('#file-json').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { try { setSpec(JSON.parse(fr.result)); status('Loaded ' + f.name, 'ok'); } catch (err) { status('Bad JSON: ' + err.message, 'err'); } };
    fr.readAsText(f);
  };
  window.addEventListener('resize', () => render());

  // boot
  loadSample().catch(e => status('Failed to load sample: ' + e.message + ' (serve from repo root!)', 'err'));
})();
