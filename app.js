/*
 * app.js — Nuqtali Portret interfeysi
 *   - rasm yuklash, fonni olib tashlash (AI)
 *   - sovg'a rejimi: matn + rasmlar ketma-ketligi + musiqa
 *   - eksport: 4K PNG, video (ekran / 9:16 / 1:1 / 16:9), bitta HTML fayl
 *   - kamera rejimi va qo'l imo-ishoralari
 *   - tugmalarni yashirish, sozlamalarni eslab qolish, avtomatik tezlik nazorati
 */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Sozlamalar
  // ------------------------------------------------------------------
  const STORE_KEY = 'nuqtali-portret:v2';
  const APP_DEFAULTS = {
    autoTrim: true,
    removeBg: true,
    focusPerson: true,
    bgDim: 0,
    style: 'classic',
    videoFormat: 'screen',
    autoHide: false,
    giftTransition: 'morph',
    giftLoop: true,
    portrait3d: false,
  };

  const STYLES = {
    classic: { color: '#ffffff', color2: '#ffffff', colorMode: false },
    gold: { color: '#fff1c9', color2: '#ffb648', colorMode: false },
    neon: { color: '#38e8ff', color2: '#ff3dd8', colorMode: false },
    cosmic: { color: '#a9ccff', color2: '#9b6bff', colorMode: false },
    pink: { color: '#ffe3f1', color2: '#ff6fae', colorMode: false },
    emerald: { color: '#dcfff2', color2: '#2fe39a', colorMode: false },
    original: { colorMode: true },
  };

  const FORMATS = {
    screen: null,
    reels: { w: 1080, h: 1920 },
    square: { w: 1080, h: 1080 },
    wide: { w: 1920, h: 1080 },
  };

  const NO_CROP = { l: 0, r: 0, t: 0, b: 0 };
  const EMPTY_MSG = "Rasmda nuqta qolmadi — «Chegara»ni pasaytiring yoki «Yorqinlik»ni oshiring";

  const params = {};
  try { Object.assign(params, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* bo'sh */ }
  for (const k in APP_DEFAULTS) if (!(k in params)) params[k] = APP_DEFAULTS[k];

  function saveParams() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch (e) { /* xotira yopiq */ }
  }

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const canvas = $('scene');
  const hintEl = $('hint');
  const loaderEl = $('loader');
  const loaderText = $('loaderText');
  const toastEl = $('toast');
  const music = $('music');
  const camVideo = $('camVideo');

  let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 3000);
  }

  function showLoader(text) {
    loaderText.textContent = text || 'Rasm tahlil qilinmoqda…';
    loaderEl.classList.add('show');
  }
  const hideLoader = () => loaderEl.classList.remove('show');
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function download(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    download(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  // ------------------------------------------------------------------
  // Dvigatel
  // ------------------------------------------------------------------
  let panelOpen = window.innerWidth >= 700; // o'ngdagi sozlamalar paneli
  let giftOpen = false;                     // chapdagi sovg'a paneli

  // Rasm atrofidagi bo'sh joy: panellarga tegmasligi uchun
  function getInsets(w, h, framed) {
    if (framed) return { top: h * 0.07, bottom: h * 0.07, side: w * 0.06 };
    if (body.classList.contains('ui-hidden')) return { top: h * 0.08, bottom: h * 0.08, side: w * 0.06 };
    const desktop = w >= 900;
    let side = 16;
    if (desktop && panelOpen) side = 290;
    if (desktop && giftOpen) side = Math.max(side, 372);
    return { top: 60, bottom: w < 640 ? 96 : 104, side };
  }

  let engine;
  try {
    engine = createParticleEngine(canvas, params, {
      getInsets,
      onStateChange: (assembled) => { $('btnScatter').title = assembled ? 'Tarqatish (Probel)' : "Yig'ish (Probel)"; },
    });
  } catch (err) {
    document.body.insertAdjacentHTML('beforeend',
      '<p style="position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:24px;text-align:center">' +
      "Brauzeringiz WebGL'ni qo'llamaydi. Chrome, Edge yoki Firefox'ning yangi versiyasida oching.</p>");
    throw err;
  }
  const ENGINE_KEYS = Object.keys(engine.defaults);
  const ALL_DEFAULTS = Object.assign({}, engine.defaults, APP_DEFAULTS);

  // ------------------------------------------------------------------
  // Sahnalar (rasm yoki matn)
  // ------------------------------------------------------------------
  let current = null;       // ekrandagi sahna
  const giftScenes = [];    // sovg'a ketma-ketligi
  let sceneId = 0;
  let segWarned = false;
  let segReady = false; // AI modeli bir marta yuklangandan keyin true

  function makeThumb(c) {
    const t = document.createElement('canvas');
    const s = 96 / Math.max(c.width, c.height);
    t.width = Math.max(1, Math.round(c.width * s));
    t.height = Math.max(1, Math.round(c.height * s));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.8);
  }

  function makeImageScene(img, name) {
    const raw = engine.utils.toCanvas(img, 1600);
    return {
      id: ++sceneId, type: 'image', name: name || 'Rasm', raw,
      trim: engine.utils.detectTrim(raw), seg: null, segFailed: false, hold: 3, thumb: makeThumb(raw),
    };
  }

  function makeTextScene(text) {
    const raw = engine.utils.makeTextCanvas(text);
    return {
      id: ++sceneId, type: 'text', name: text, text, raw,
      trim: engine.utils.detectTrim(raw), hold: 3, thumb: makeThumb(raw),
    };
  }

  const isImage = (sc) => sc && sc.type === 'image';
  // Odam maskasi: fonni olib tashlash va 3D portret uchun kerak
  const needsSeg = (sc) => isImage(sc) && (params.removeBg || params.portrait3d) && !sc.seg && !sc.segFailed;
  const needsDepth = (sc) => isImage(sc) && params.portrait3d && !sc.depth && !sc.depthFailed;
  const needsPrep = (sc) => needsSeg(sc) || needsDepth(sc);

  function prepMessage(sc) {
    const first = segReady ? '' : ' (birinchi marta AI modeli yuklanadi, biroz kuting)';
    if (needsDepth(sc)) return '3D chuqurlik hisoblanmoqda…' + first;
    if (needsSeg(sc)) return 'Fon olib tashlanmoqda…' + first;
    return 'Rasm tahlil qilinmoqda…';
  }

  // AI natijalarini (odam maskasi, chuqurlik) bir marta hisoblab, sahnada saqlaydi
  async function prepareScene(sc) {
    if (needsSeg(sc)) {
      try {
        sc.seg = await window.AI.segmentPerson(sc.raw);
        segReady = true;
        if (sc.seg.coverage < 0.01 && params.removeBg) toast('Rasmda odam topilmadi — fon saqlab qolindi');
      } catch (err) {
        console.warn("Fonni olib tashlab bo'lmadi:", err);
        sc.segFailed = true;
        if (!segWarned) {
          segWarned = true;
          toast("AI uchun internet kerak (model yuklanmadi). Rasm oddiy holda ko'rsatildi.", 5000);
        }
      }
    }
    if (needsDepth(sc)) {
      try {
        sc.depth = await window.AI.estimateDepth(sc.raw, sc.seg);
      } catch (err) {
        console.warn("Chuqurlikni hisoblab bo'lmadi:", err);
        sc.depthFailed = true;
        toast("3D chuqurlikni hisoblab bo'lmadi (internet kerak)");
      }
    }
  }

  // Odam + xiralashtirilgan fon (bgDim) + qora orqa fon
  function composite(sc) {
    const key = params.bgDim.toFixed(3);
    if (sc.comp && sc.compKey === key) return sc.comp;
    const raw = sc.raw;
    const c = sc.comp || document.createElement('canvas');
    c.width = raw.width;
    c.height = raw.height;
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(sc.seg.mask, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(raw, 0, 0);
    if (params.bgDim > 0) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.globalAlpha = params.bgDim;
      ctx.drawImage(raw, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
    sc.comp = c;
    sc.compKey = key;
    return c;
  }

  function expandBox(b, m) {
    return { l: Math.max(0, b.l - m), r: Math.max(0, b.r - m), t: Math.max(0, b.t - m), b: Math.max(0, b.b - m) };
  }

  // Dvigatelga beriladigan manba: { canvas, crop }
  function getSceneSource(sc) {
    let canvasSrc = sc.raw;
    let crop = params.autoTrim ? sc.trim : NO_CROP;
    if (sc.type === 'image' && params.removeBg && sc.seg && sc.seg.coverage >= 0.01) {
      canvasSrc = composite(sc);
      if (params.focusPerson && sc.seg.box) crop = expandBox(sc.seg.box, 0.05);
    }
    const src = { canvas: canvasSrc, crop };
    if (isImage(sc) && params.portrait3d && sc.depth) src.depth = sc.depth; // rasm bilan bir xil kadr
    return src;
  }

  async function showScene(sc, mode) {
    stopGift();
    stopCamera();
    current = sc;
    showLoader(prepMessage(sc));
    await nextFrame();
    await prepareScene(sc);
    hideLoader();
    if (current !== sc) return;
    if (!engine.setSource(getSceneSource(sc), mode || 'assemble')) toast(EMPTY_MSG);
    renderScenes();
  }

  // Sozlama o'zgarganda ekrandagi sahnani qayta hisoblash
  let refreshTimer = 0;
  let refreshToken = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshCurrent, 200);
  }

  async function refreshCurrent() {
    if (!current || engine.isPlayingSequence() || engine.isLive()) return;
    const token = ++refreshToken;
    const sc = current;
    if (needsPrep(sc)) showLoader(prepMessage(sc));
    await prepareScene(sc);
    hideLoader();
    if (token !== refreshToken || current !== sc) return;
    if (!engine.setSource(getSceneSource(sc), 'morph')) toast(EMPTY_MSG);
  }

  // ------------------------------------------------------------------
  // Rasm yuklash
  // ------------------------------------------------------------------
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Rasmni ochib bo'lmadi"));
      img.src = url;
    });
  }

  async function imageSceneFromFile(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Iltimos, rasm faylini tanlang (JPG, PNG, WEBP…)');
    const url = URL.createObjectURL(file);
    try {
      return makeImageScene(await loadImage(url), file.name.replace(/\.[^.]+$/, ''));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function openFile(file) {
    if (!file) return;
    try {
      const sc = await imageSceneFromFile(file);
      hintEl.classList.add('hidden');
      showScene(sc);
    } catch (err) {
      toast(err.message);
    }
  }

  async function openURL(url, name) {
    try {
      const sc = makeImageScene(await loadImage(url), name || 'Rasm');
      hintEl.classList.add('hidden');
      await showScene(sc);
      return sc;
    } catch (err) {
      toast(err.message);
      return null;
    }
  }

  $('fileInput').addEventListener('change', (e) => {
    openFile(e.target.files[0]);
    e.target.value = '';
  });

  // Sudrab tashlash: sovg'a paneli ochiq bo'lsa — sahna sifatida qo'shiladi
  let dragDepth = 0;
  const overlayEl = $('dropOverlay');
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlayEl.classList.add('show');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlayEl.classList.remove('show');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlayEl.classList.remove('show');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (giftOpen) addGiftFiles(files);
    else openFile(files[0]);
  });

  window.addEventListener('paste', (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const item = items.find((it) => it.type.startsWith('image/'));
    if (item) openFile(item.getAsFile());
  });

  // ------------------------------------------------------------------
  // Sovg'a rejimi
  // ------------------------------------------------------------------
  const sceneList = $('sceneList');
  let gifting = false;

  function renderScenes() {
    sceneList.innerHTML = '';
    $('sceneEmpty').hidden = giftScenes.length > 0;
    giftScenes.forEach((sc, i) => {
      const li = document.createElement('li');
      li.className = 'scene' + (sc === current ? ' current' : '');
      li.dataset.index = String(i);
      li.innerHTML =
        '<img alt="" title="Ko\'rish">' +
        '<div class="scene-info"><span class="scene-name"></span>' +
        '<label class="scene-hold"><input type="number" min="1" max="30" step="0.5"> s turadi</label></div>' +
        '<div class="scene-actions">' +
        '<button class="icon-btn blow" data-act="blow" title="Shu sahnadan keyin puflashni kutish">🎂</button>' +
        '<button class="icon-btn" data-act="up" title="Yuqoriga">↑</button>' +
        '<button class="icon-btn" data-act="down" title="Pastga">↓</button>' +
        '<button class="icon-btn" data-act="del" title="O\'chirish">✕</button></div>';
      li.querySelector('img').src = sc.thumb;
      li.querySelector('.scene-name').textContent = sc.type === 'text' ? `“${sc.text.replace(/\n/g, ' ')}”` : sc.name;
      li.querySelector('input').value = sc.hold;
      li.querySelector('.blow').classList.toggle('on', !!sc.waitBlow);
      sceneList.appendChild(li);
    });
  }

  sceneList.addEventListener('click', (e) => {
    const li = e.target.closest('.scene');
    if (!li) return;
    const i = Number(li.dataset.index);
    const sc = giftScenes[i];
    const act = e.target.dataset.act;
    if (act === 'up' && i > 0) [giftScenes[i - 1], giftScenes[i]] = [giftScenes[i], giftScenes[i - 1]];
    else if (act === 'down' && i < giftScenes.length - 1) [giftScenes[i + 1], giftScenes[i]] = [giftScenes[i], giftScenes[i + 1]];
    else if (act === 'del') giftScenes.splice(i, 1);
    else if (act === 'blow') sc.waitBlow = !sc.waitBlow;
    else if (e.target.tagName === 'IMG') { showScene(sc, 'morph'); return; }
    else return;
    renderScenes();
  });

  sceneList.addEventListener('change', (e) => {
    const li = e.target.closest('.scene');
    if (!li || e.target.tagName !== 'INPUT') return;
    const v = Math.min(30, Math.max(1, Number(e.target.value) || 3));
    giftScenes[Number(li.dataset.index)].hold = v;
    e.target.value = v;
  });

  async function addGiftFiles(files) {
    const imgs = files.filter((f) => f && f.type.startsWith('image/'));
    if (!imgs.length) { toast('Rasm fayllarini tanlang'); return; }
    for (const f of imgs) {
      try { giftScenes.push(await imageSceneFromFile(f)); } catch (err) { toast(err.message); }
    }
    renderScenes();
    toast(`${imgs.length} ta rasm qo'shildi`);
  }

  function addGiftText() {
    const ta = $('textInput');
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const sc = makeTextScene(text);
    giftScenes.push(sc);
    ta.value = '';
    renderScenes();
    showScene(sc, 'morph');
  }

  $('addText').addEventListener('click', addGiftText);
  $('textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addGiftText(); }
  });
  $('addImage').addEventListener('click', () => $('giftFiles').click());
  $('giftFiles').addEventListener('change', (e) => {
    addGiftFiles(Array.from(e.target.files || []));
    e.target.value = '';
  });
  $('addCurrent').addEventListener('click', () => {
    if (!current) return;
    if (giftScenes.includes(current)) { toast("Bu sahna allaqachon qo'shilgan"); return; }
    giftScenes.push(current);
    renderScenes();
  });

  // Teskari sanash: raqamlar tez almashadi
  function countdownScenes() {
    return ['3', '2', '1'].map((n) => Object.assign(makeTextScene(n), { hold: 0.35, morph: 0.9, assemble: 2.2 }));
  }

  $('addCountdown').addEventListener('click', () => {
    giftScenes.push(...countdownScenes());
    renderScenes();
  });

  // Tug'ilgan kun: 3·2·1 → tabrik (puflashni kutadi) → salyutdan rasm
  $('addBirthday').addEventListener('click', () => {
    const photo = giftScenes.find(isImage) || (isImage(current) ? current : null);
    giftScenes.length = 0;
    giftScenes.push(...countdownScenes());
    const wish = makeTextScene("Tug'ilgan kuning\nbilan!");
    wish.waitBlow = true;
    giftScenes.push(wish);
    if (photo) {
      photo.hold = 5;
      giftScenes.push(photo);
    }
    params.giftTransition = 'morph';
    params.giftLoop = false;
    transitionSel.value = 'morph';
    loopChk.checked = false;
    saveParams();
    renderScenes();
    toast(photo
      ? "Shablon tayyor. Xohlasangiz musiqa qo'shib, «Boshlash»ni bosing."
      : "Shablon tayyor. Oxiriga «+ Rasm» bilan surat qo'shing.", 5000);
  });

  function setGiftOpen(open) {
    giftOpen = open;
    $('giftPanel').hidden = !open;
    $('btnGift').classList.toggle('active', open);
    engine.layout(true);
    if (open) {
      renderScenes();
      hintEl.classList.add('hidden');
    }
  }
  $('giftClose').addEventListener('click', () => setGiftOpen(false));

  const transitionSel = $('transition');
  const loopChk = $('loop');
  const beatRange = $('beatRange');
  transitionSel.value = params.giftTransition;
  loopChk.checked = params.giftLoop;
  beatRange.value = params.beat;
  transitionSel.addEventListener('change', () => { params.giftTransition = transitionSel.value; saveParams(); });
  loopChk.addEventListener('change', () => { params.giftLoop = loopChk.checked; saveParams(); });
  beatRange.addEventListener('input', () => { params.beat = Number(beatRange.value); saveParams(); });

  const giftList = () => (giftScenes.length ? giftScenes : current ? [current] : []);

  // Sahnalarni tayyorlab, dvigatel uchun ro'yxat qaytaradi
  async function prepareGift() {
    const list = giftList();
    if (!list.length) { toast("Avval sahna qo'shing"); return null; }
    if (list.some(needsPrep)) showLoader('Sahnalar tayyorlanmoqda…');
    for (const sc of list) await prepareScene(sc);
    hideLoader();
    return {
      list,
      scenes: list.map((sc) => ({
        source: getSceneSource(sc), hold: sc.hold, assemble: sc.assemble, morph: sc.morph, waitBlow: !!sc.waitBlow,
      })),
    };
  }

  // --- Puflash (mikrofon) ---
  const blowHint = $('blowHint');
  let blower = null;

  function showBlowHint(on) { blowHint.hidden = !on; }

  function continueAfterBlow() {
    if (!engine.isWaiting()) return;
    showBlowHint(false);
    engine.continueSequence();
  }

  function startBlowListening() {
    if (blower || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    blower = engine.utils.createBlowDetector(continueAfterBlow);
    blower.start().catch(() => {
      blower = null;
      toast("Mikrofonga ruxsat berilmadi — davom etish uchun ekranga bosing", 5000);
    });
  }

  function stopBlowListening() {
    if (blower) blower.stop();
    blower = null;
    showBlowHint(false);
  }

  // autoBlow — video yozishda puflashni kutmasdan avtomatik davom etadi
  function runGift(prep, { loop, autoBlow = false }) {
    stopCamera();
    gifting = true;
    $('giftPlay').textContent = "■ To'xtatish";
    $('giftLabel').textContent = "To'xtatish";
    if (musicFile) {
      engine.resumeAudio();
      music.currentTime = 0;
      music.play().catch(() => {});
    }
    if (!autoBlow && prep.scenes.some((s) => s.waitBlow)) startBlowListening();
    const opts = { transition: params.giftTransition, loop, autoBlow };
    engine.playSequence(prep.scenes, Object.assign({}, opts, {
      onScene: (i) => { current = prep.list[i]; showBlowHint(false); renderScenes(); },
      onWait: () => showBlowHint(true),
      onEnd: () => { if (!recording) stopGift(); },
    }));
    return engine.sequenceDuration(prep.scenes, opts);
  }

  async function playGift() {
    if (gifting) { stopGift(); return; }
    const prep = await prepareGift();
    if (!prep) return;
    if (giftOpen) setGiftOpen(false);
    setUiHidden(true, { silent: true });
    runGift(prep, { loop: params.giftLoop });
    toast("To'xtatish: Esc · tugmalarni ko'rsatish: ekranga ikki marta bosing");
  }

  function stopGift() {
    if (!gifting) return;
    gifting = false;
    engine.stopSequence();
    stopBlowListening();
    music.pause();
    $('giftPlay').textContent = '▶ Boshlash';
    $('giftLabel').textContent = "Sovg'a";
    setUiHidden(false, { silent: true });
  }

  $('btnGift').addEventListener('click', () => {
    if (gifting) stopGift();
    else setGiftOpen(!giftOpen);
  });
  $('giftPlay').addEventListener('click', playGift);
  $('giftRecord').addEventListener('click', () => recordVideo({ gift: true }));
  $('giftExport').addEventListener('click', exportGift);

  // ------------------------------------------------------------------
  // Musiqa
  // ------------------------------------------------------------------
  let musicFile = null;
  let musicURL = null;

  $('pickMusic').addEventListener('click', () => $('musicInput').click());
  $('musicInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { toast('Audio fayl tanlang (MP3, M4A, OGG…)'); return; }
    if (musicURL) URL.revokeObjectURL(musicURL);
    musicFile = file;
    musicURL = URL.createObjectURL(file);
    music.src = musicURL;
    engine.attachAudio(music);
    $('musicName').textContent = file.name;
    $('removeMusic').hidden = false;
  });
  $('removeMusic').addEventListener('click', () => {
    music.pause();
    music.removeAttribute('src');
    music.load();
    if (musicURL) URL.revokeObjectURL(musicURL);
    musicFile = null;
    musicURL = null;
    $('musicName').textContent = 'tanlanmagan';
    $('removeMusic').hidden = true;
  });

  // ------------------------------------------------------------------
  // Video yozish (musiqa bilan, kerakli formatda)
  // ------------------------------------------------------------------
  let recording = false;
  let recorder = null;
  let recStopTimer = 0;
  let recClock = 0;

  function applyFrame(fmt) {
    const s = Math.min((window.innerWidth - 48) / fmt.w, (window.innerHeight - 48) / fmt.h);
    canvas.style.width = Math.round(fmt.w * s) + 'px';
    canvas.style.height = Math.round(fmt.h * s) + 'px';
    body.classList.add('framing');
    engine.setOutputSize(fmt.w, fmt.h);
    engine.refreshStarts(); // yulduzlar yangi kadrni to'ldirsin
  }

  function clearFrame() {
    if (!body.classList.contains('framing')) return;
    body.classList.remove('framing');
    canvas.style.width = '';
    canvas.style.height = '';
    engine.clearOutputSize();
    engine.refreshStarts();
  }

  function pickMime(withAudio) {
    const list = withAudio
      ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return list.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function recordVideo({ gift = false } = {}) {
    if (recording) { stopRecording(); return; }
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
      toast("Brauzeringiz video yozishni qo'llamaydi (Chrome yoki Edge'da oching)");
      return;
    }
    let prep = null;
    if (gift) {
      prep = await prepareGift();
      if (!prep) return;
      if (giftOpen) setGiftOpen(false);
    }
    if (engine.isLive()) stopCamera();

    const fmt = FORMATS[params.videoFormat];
    if (fmt) applyFrame(fmt);

    const stream = canvas.captureStream(60);
    const withAudio = !!musicFile;
    if (withAudio) {
      await engine.resumeAudio();
      const as = engine.getAudioStream();
      if (as) as.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const mime = pickMime(withAudio);
    const chunks = [];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 16e6 } : undefined);
    recorder = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm';
      downloadBlob(new Blob(chunks, { type }), 'nuqtali-portret.' + (type.includes('mp4') ? 'mp4' : 'webm'));
      stream.getTracks().forEach((t) => { if (t.kind === 'video') t.stop(); });
      toast('Video saqlandi');
    };

    recording = true;
    body.classList.add('recording');
    $('btnVideo').classList.add('recording');
    $('recChip').hidden = false;
    rec.start(250);

    let seconds;
    if (gift) {
      seconds = runGift(prep, { loop: false, autoBlow: true }) + 1;
    } else {
      if (withAudio) { music.currentTime = 0; music.play().catch(() => {}); }
      engine.replay();
      seconds = params.duration + 2.5;
    }

    const t0 = performance.now();
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000);
      $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    recClock = setInterval(tick, 250);
    recStopTimer = setTimeout(stopRecording, seconds * 1000);
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    clearTimeout(recStopTimer);
    clearInterval(recClock);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    stopGift();
    music.pause();
    body.classList.remove('recording');
    $('btnVideo').classList.remove('recording');
    $('recChip').hidden = true;
    clearFrame();
  }

  $('btnVideo').addEventListener('click', () => recordVideo());
  $('recStop').addEventListener('click', stopRecording);

  // ------------------------------------------------------------------
  // 4K rasm
  // ------------------------------------------------------------------
  async function savePNG() {
    showLoader('4K rasm tayyorlanmoqda…');
    await nextFrame();
    try {
      const blob = await engine.snapshot(3840);
      downloadBlob(blob, 'nuqtali-portret-4k.png');
    } catch (err) {
      console.error(err);
      toast("Rasmni saqlab bo'lmadi");
    }
    hideLoader();
  }
  $('btnPng').addEventListener('click', savePNG);

  // ------------------------------------------------------------------
  // Sovg'a fayli: bitta HTML — Telegram orqali yuborsa bo'ladi
  // ------------------------------------------------------------------
  // Kesilgan qismni alohida rasmga aylantiradi
  function cropToDataURL(c, cr, maxSide, type) {
    const sx = c.width * cr.l;
    const sy = c.height * cr.t;
    const sw = c.width * (1 - cr.l - cr.r);
    const sh = c.height * (1 - cr.t - cr.b);
    const s = Math.min(1, maxSide / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * s));
    out.height = Math.max(1, Math.round(sh * s));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL(type, 0.9);
  }

  function bakeScene(sc) {
    const src = getSceneSource(sc);
    const baked = {
      img: cropToDataURL(src.canvas, src.crop, 1200, sc.type === 'text' ? 'image/png' : 'image/jpeg'),
      hold: sc.hold,
    };
    if (src.depth) baked.depth = cropToDataURL(src.depth, src.crop, 256, 'image/png');
    if (sc.assemble) baked.assemble = sc.assemble;
    if (sc.morph) baked.morph = sc.morph;
    if (sc.waitBlow) baked.waitBlow = true;
    return baked;
  }

  const readAsDataURL = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  // Sayt serverda ochilgan bo'lsa kutubxonalar faylga joylanadi (internetsiz ishlaydi),
  // aks holda sovg'a fayli ularni CDN'dan yuklaydi.
  const tryFetchText = (url) => fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

  function buildViewerHTML(cfg, threeSrc, gsapSrc) {
    const lib = (src, cdn) => (src ? `<script>${safeScript(src)}</script>` : `<script src="${cdn}"></script>`);
    const data = JSON.stringify(cfg).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sizga sovg'a</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; color: #f4f4f5;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  #start { position: fixed; inset: 0; display: grid; place-items: center; z-index: 2; transition: opacity .6s; }
  #start.hide { opacity: 0; pointer-events: none; }
  .box { text-align: center; padding: 24px; }
  .gift { font-size: 56px; animation: bob 2.4s ease-in-out infinite; }
  @keyframes bob { 50% { transform: translateY(-8px); } }
  p { margin: 12px 0 24px; font-size: 18px; color: rgba(255,255,255,.75); }
  button { height: 48px; padding: 0 28px; border: 0; border-radius: 999px; background: #fff; color: #000;
    font: 600 16px/1 inherit; cursor: pointer; }
  #err { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; }
  #blow { position: fixed; left: 50%; bottom: 9vh; transform: translateX(-50%); display: none; flex-direction: column;
    align-items: center; gap: 4px; padding: 14px 26px; border-radius: 18px; background: rgba(14,14,18,.9);
    border: 1px solid rgba(255,255,255,.1); font-size: 18px; font-weight: 600; pointer-events: none; z-index: 3; }
  #blow.show { display: flex; }
  #blow b { font-size: 34px; }
  #blow small { color: rgba(255,255,255,.55); font-size: 12px; font-weight: 400; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="start"><div class="box"><div class="gift">🎁</div><p>Sizga kichik sovg'a bor</p><button id="go">Ochish</button></div></div>
<div id="blow"><b>🎂</b><span>Shamni puflang!</span><small>yoki ekranga bosing</small></div>
${lib(threeSrc, 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js')}
${lib(gsapSrc, 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js')}
<script>
${createParticleEngine.toString()}
</script>
<script>
(async function () {
  const GIFT = ${data};
  if (!window.THREE || !window.gsap) {
    document.body.innerHTML = '<div id="err">Sovg\\'ani ochish uchun internet kerak. Internetga ulanib, qayta oching.</div>';
    return;
  }
  const canvas = document.getElementById('c');
  const engine = createParticleEngine(canvas, GIFT.params, {
    getInsets: (w, h) => ({ top: h * 0.08, bottom: h * 0.08, side: w * 0.06 }),
  });
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const scenes = [];
  for (const s of GIFT.scenes) {
    const source = { canvas: engine.utils.toCanvas(await load(s.img), 1600), crop: { l: 0, r: 0, t: 0, b: 0 } };
    if (s.depth) source.depth = engine.utils.toCanvas(await load(s.depth), 512);
    scenes.push({ source, hold: s.hold, assemble: s.assemble, morph: s.morph, waitBlow: !!s.waitBlow });
  }
  let audio = null;
  if (GIFT.music) { audio = new Audio(GIFT.music); audio.loop = true; engine.attachAudio(audio); }

  // Puflash: mikrofon yoki ekranga bosish
  const hint = document.getElementById('blow');
  const next = () => { if (engine.isWaiting()) { hint.classList.remove('show'); engine.continueSequence(); } };
  canvas.addEventListener('pointerdown', next);

  document.getElementById('go').addEventListener('click', () => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    engine.requestMotionPermission();
    document.getElementById('start').classList.add('hide');
    if (audio) engine.resumeAudio().then(() => audio.play()).catch(() => {});
    if (scenes.some((s) => s.waitBlow) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      engine.utils.createBlowDetector(next).start().catch(() => {});
    }
    engine.playSequence(scenes, {
      transition: GIFT.transition,
      loop: GIFT.loop,
      onWait: () => hint.classList.add('show'),
      onScene: () => hint.classList.remove('show'),
    });
  });
})();
</script>
</body>
</html>`;
  }

  async function makeGiftHTML(list) {
    for (const sc of list) await prepareScene(sc);
    const engineParams = {};
    ENGINE_KEYS.forEach((k) => { engineParams[k] = params[k]; });
    const cfg = {
      params: engineParams,
      scenes: list.map(bakeScene),
      transition: params.giftTransition,
      loop: params.giftLoop,
      music: musicFile ? await readAsDataURL(musicFile) : null,
    };
    const [threeSrc, gsapSrc] = await Promise.all([tryFetchText('libs/three.min.js'), tryFetchText('libs/gsap.min.js')]);
    return { html: buildViewerHTML(cfg, threeSrc, gsapSrc), offline: !!(threeSrc && gsapSrc) };
  }

  async function exportGift() {
    const list = giftList();
    if (!list.length) { toast("Avval sahna qo'shing"); return; }
    showLoader("Sovg'a fayli tayyorlanmoqda…");
    try {
      const { html, offline } = await makeGiftHTML(list);
      downloadBlob(new Blob([html], { type: 'text/html' }), 'sovga.html');
      const mb = (html.length / 1048576).toFixed(1);
      toast(offline
        ? `sovga.html saqlandi (${mb} MB). Uni Telegram orqali yuborishingiz mumkin.`
        : `sovga.html saqlandi (${mb} MB). Uni ochish uchun internet kerak bo'ladi.`, 6000);
    } catch (err) {
      console.error(err);
      toast("Sovg'a faylini yaratib bo'lmadi");
    }
    hideLoader();
  }

  // ------------------------------------------------------------------
  // Kamera rejimi + qo'l imo-ishoralari
  // ------------------------------------------------------------------
  let cam = null;
  let camStarting = false;
  let hands = null;
  let handsLoading = false;
  const camStatus = $('camStatus');

  async function startCamera() {
    if (cam || camStarting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Bu brauzerda kamera ishlamaydi");
      return;
    }
    stopGift();
    camStarting = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      camStarting = false;
      toast('Kameraga ruxsat berilmadi');
      return;
    }
    camVideo.srcObject = stream;
    try { await camVideo.play(); } catch (e) { /* quyida tekshiriladi */ }
    if (camVideo.readyState < 2) {
      // Birinchi kadrni ko'pi bilan 5 soniya kutamiz
      await new Promise((r) => {
        camVideo.addEventListener('loadeddata', r, { once: true });
        setTimeout(r, 5000);
      });
    }
    camStarting = false;
    if (!camVideo.videoWidth) {
      stream.getTracks().forEach((t) => t.stop());
      camVideo.srcObject = null;
      toast('Kameradan tasvir kelmadi. Boshqa dastur kamerani band qilmaganini tekshiring.');
      return;
    }
    cam = { stream };
    engine.startLive(camVideo, { mirror: true });
    $('camBar').hidden = false;
    $('btnCamera').classList.add('active');
    hintEl.classList.add('hidden');
    camStatus.textContent = '';
  }

  function stopCamera() {
    if (!cam) return;
    stopHands();
    engine.stopLive();
    cam.stream.getTracks().forEach((t) => t.stop());
    camVideo.srcObject = null;
    cam = null;
    $('camBar').hidden = true;
    $('btnCamera').classList.remove('active');
  }

  function takeShot() {
    if (!cam) return;
    const c = document.createElement('canvas');
    c.width = camVideo.videoWidth;
    c.height = camVideo.videoHeight;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1); // oynadagidek
    ctx.drawImage(camVideo, 0, 0);
    stopCamera();
    showScene(makeImageScene(c, 'Kamera surati'));
  }

  async function toggleHands() {
    if (hands) { stopHands(); return; }
    if (handsLoading || !cam) return;
    handsLoading = true;
    camStatus.textContent = "Qo'l modeli yuklanmoqda (~8 MB)…";
    try {
      const rec = await window.AI.getGestureRecognizer();
      if (cam) {
        hands = { rec, lastTs: 0, gesture: null, since: 0, cooldown: 0 };
        $('camHands').classList.add('active');
        camStatus.textContent = "✋ kaft — tarqatish · ✊ musht — yig'ish · ☝ barmoq — surish";
      } else {
        camStatus.textContent = '';
      }
    } catch (err) {
      console.warn(err);
      camStatus.textContent = '';
      toast("Qo'l modelini yuklab bo'lmadi (internet kerak)");
    }
    handsLoading = false;
  }

  function stopHands() {
    hands = null;
    engine.setExternalPointer(null);
    $('camHands').classList.remove('active');
    camStatus.textContent = '';
  }

  engine.onFrame(() => {
    if (!hands || !cam || camVideo.readyState < 2) return;
    const now = performance.now();
    if (now - hands.lastTs < 33) return; // ~30 marta/soniya yetarli
    hands.lastTs = now;
    let res;
    try { res = hands.rec.recognizeForVideo(camVideo, now); } catch (e) { return; }
    const lm = res.landmarks && res.landmarks[0];
    if (!lm) { engine.setExternalPointer(null); hands.gesture = null; return; }
    const tip = lm[8]; // ko'rsatkich barmoq uchi
    const aspect = camVideo.videoWidth / camVideo.videoHeight;
    engine.setExternalPointer({ x: (0.5 - tip.x) * aspect, y: 0.5 - tip.y });

    const g = res.gestures && res.gestures[0] && res.gestures[0][0];
    const name = g && g.score > 0.6 ? g.categoryName : null;
    if (name !== hands.gesture) { hands.gesture = name; hands.since = now; return; }
    if (!name || now - hands.since < 350 || now < hands.cooldown) return;
    if (name === 'Open_Palm' && engine.isAssembled()) { engine.scatter(); hands.cooldown = now + 1500; }
    else if (name === 'Closed_Fist' && !engine.isAssembled()) { engine.assemble(); hands.cooldown = now + 1500; }
  });

  $('btnCamera').addEventListener('click', () => (cam ? stopCamera() : startCamera()));
  $('camShot').addEventListener('click', takeShot);
  $('camHands').addEventListener('click', toggleHands);
  $('camClose').addEventListener('click', stopCamera);

  // ------------------------------------------------------------------
  // Tugmalarni yashirish
  // ------------------------------------------------------------------
  function setUiHidden(on, { silent = false } = {}) {
    if (body.classList.contains('ui-hidden') === on) return;
    body.classList.toggle('ui-hidden', on);
    engine.layout(true);
    if (on && !silent) toast('Qaytarish: H tugmasi yoki ekranga ikki marta bosing');
  }
  const toggleUi = () => setUiHidden(!body.classList.contains('ui-hidden'));

  $('btnHide').addEventListener('click', () => setUiHidden(true));

  // Ikki marta bosish (sichqoncha ham, barmoq ham)
  let lastTap = 0;
  let lastX = 0;
  let lastY = 0;
  let motionAsked = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!motionAsked) { motionAsked = true; engine.requestMotionPermission(); } // iPhone giroskopi uchun
    if (engine.isWaiting()) { continueAfterBlow(); return; }                     // puflash o'rniga bosish
    const now = performance.now();
    if (now - lastTap < 320 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 40) {
      toggleUi();
      lastTap = 0;
    } else {
      lastTap = now;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  // Harakatsizlikda avtomatik yashirish va kursorni berkitish
  let idleTimer = 0;
  let overUI = false;
  function poke(e) {
    if (e && e.target && e.target.closest) overUI = !!e.target.closest('.lil-gui, .dock, .panel, .cam-bar, .rec-chip');
    body.classList.remove('ui-idle', 'cursor-hidden');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (params.autoHide && !overUI) body.classList.add('ui-idle');
      if ((params.autoHide || body.classList.contains('ui-hidden')) && !overUI) body.classList.add('cursor-hidden');
    }, 3000);
  }
  window.addEventListener('pointermove', poke);
  window.addEventListener('pointerdown', poke);
  window.addEventListener('keydown', poke);

  // To'liq ekran
  const canFullscreen = !!document.documentElement.requestFullscreen;
  $('btnFullscreen').hidden = !canFullscreen;
  function toggleFullscreen() {
    if (!canFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  $('btnFullscreen').addEventListener('click', toggleFullscreen);

  // ------------------------------------------------------------------
  // Pastki panel tugmalari va klaviatura
  // ------------------------------------------------------------------
  $('btnUpload').addEventListener('click', () => $('fileInput').click());
  $('btnReplay').addEventListener('click', () => engine.replay());
  $('btnScatter').addEventListener('click', () => engine.toggle());

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, .lil-gui')) return;
    if (e.code === 'Space') { e.preventDefault(); engine.toggle(); }
    else if (e.key === 'r' || e.key === 'R') engine.replay();
    else if (e.key === 'h' || e.key === 'H') toggleUi();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'Escape') {
      if (recording) stopRecording();
      else if (gifting) stopGift();
      else if (cam) stopCamera();
      else if (giftOpen) setGiftOpen(false);
      else if (body.classList.contains('ui-hidden')) setUiHidden(false);
    }
  });

  // ------------------------------------------------------------------
  // Sozlamalar paneli (lil-gui)
  // ------------------------------------------------------------------
  const gui = new lil.GUI({ title: 'Sozlamalar' });

  function applyStyle(name) {
    const st = STYLES[name];
    if (!st) return;
    Object.assign(params, st);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  const fImg = gui.addFolder('Rasm');
  fImg.add(params, 'count', 5000, 200000, 1000).name('Nuqtalar soni').onFinishChange(scheduleRefresh);
  fImg.add(params, 'contrast', 0.5, 3, 0.01).name('Kontrast').onChange(scheduleRefresh);
  fImg.add(params, 'brightness', -0.5, 0.5, 0.01).name('Yorqinlik').onChange(scheduleRefresh);
  fImg.add(params, 'threshold', 0, 0.8, 0.01).name("Chegara (fonni o'chirish)").onChange(scheduleRefresh);
  fImg.add(params, 'gamma', 0.4, 3, 0.01).name('Gamma').onChange(scheduleRefresh);
  fImg.add(params, 'detail', 0, 2, 0.01).name('Detallar').onChange(scheduleRefresh);
  fImg.add(params, 'autoTrim').name('Ramkani avto-kesish').onChange(scheduleRefresh);
  fImg.add(params, 'crop', 0, 0.25, 0.005).name('Chetini kesish').onChange(scheduleRefresh);
  fImg.add(params, 'invert').name('Inversiya').onChange(scheduleRefresh);

  const fAI = gui.addFolder("Sun'iy intellekt");
  fAI.add(params, 'removeBg').name('Fonni olib tashlash').onChange(scheduleRefresh);
  fAI.add(params, 'focusPerson').name('Odamga yaqinlashtirish').onChange(scheduleRefresh);
  fAI.add(params, 'bgDim', 0, 1, 0.01).name("Fondan qoldirish").onChange(scheduleRefresh);

  const fLook = gui.addFolder("Ko'rinish");
  fLook.add(params, 'style', {
    'Klassik oq': 'classic', 'Oltin': 'gold', 'Neon': 'neon', 'Kosmik': 'cosmic',
    'Pushti': 'pink', 'Zumrad': 'emerald', 'Asl ranglar': 'original',
  }).name('Rang uslubi').onChange(applyStyle);
  fLook.add(params, 'shape', { 'Nuqta ●': 'dot', 'Yulduzcha ✦': 'star', 'Yurakcha ❤': 'heart' })
    .name('Nuqta shakli').onChange(scheduleRefresh);
  fLook.add(params, 'size', 0.2, 4, 0.01).name("Nuqta o'lchami");
  fLook.add(params, 'twinkle', 0, 1, 0.01).name('Miltillash');
  fLook.add(params, 'sparkle', 0, 1, 0.01).name('Yulduz chaqnashi ✦');
  fLook.add(params, 'bloom', 0, 2, 0.01).name("Yorug'lik nuri");
  fLook.add(params, 'colorMode').name('Asl ranglar');
  fLook.addColor(params, 'color').name('Yuqori rang');
  fLook.addColor(params, 'color2').name('Pastki rang');
  fLook.add(params, 'bgStars').name('Fon yulduzlari');
  fLook.add(params, 'shooting').name('Uchar yulduzlar');

  const fAnim = gui.addFolder('Animatsiya');
  fAnim.add(params, 'duration', 1, 15, 0.1).name('Davomiylik (s)');
  fAnim.add(params, 'spread', 0, 0.9, 0.01).name('Ketma-ketlik');
  fAnim.add(params, 'startShape', {
    'Yulduzli osmon': 'stars', 'Galaktika': 'galaxy', 'Markazdan portlash': 'burst', 'Qor': 'snow',
    "Qum bo'roni": 'sandstorm', 'Girdob': 'vortex', 'Salyut': 'fireworks', 'Globus': 'globe',
  }).name('Boshlanish shakli').onChange(() => engine.replay());
  fAnim.add(params, 'order', {
    'Tasodifiy': 'random', 'Markazdan chetga': 'center', 'Yuqoridan pastga': 'top', 'Yorqin joylar avval': 'bright',
    'Qalamda chizish': 'sketch', 'Yulduz turkumlari': 'constellation',
  }).name("Yig'ilish tartibi").onChange(() => engine.replay());
  fAnim.add(params, 'leave', {
    "Chang bo'lib uchish": 'dust', "Qora tuynukka so'rilish": 'vortex', 'Oqib tushish': 'gravity',
    'Portlash': 'explode', 'Yulduzlarga qaytish': 'reverse',
  }).name('Tarqalish turi');
  fAnim.add(params, 'swirl', 0, 4, 0.01).name('Aylanish');
  fAnim.add(params, 'lines', 0, 1, 0.01).name('Turkum chiziqlari');

  const f3d = gui.addFolder('3D');
  const ctl3d = {};
  f3d.add(params, 'portrait3d').name('3D portret (AI)').onChange((on) => {
    params.rotate3d = on ? (params.rotate3d === 'off' ? 'follow' : params.rotate3d) : 'off';
    ctl3d.rotate.updateDisplay();
    if (on && !isImage(current)) toast('3D portret rasmlarda ishlaydi — rasm yuklang');
    scheduleRefresh();
  });
  f3d.add(params, 'relief', 0, 1, 0.01).name('Relyef kuchi');
  ctl3d.rotate = f3d.add(params, 'rotate3d', {
    "O'chiq": 'off', 'Sichqoncha / telefon': 'follow', 'Avtomatik tebranish': 'sway',
  }).name('Aylanish');
  f3d.add(params, 'depth', 0, 0.5, 0.005).name('Yorqinlikdan hajm');
  f3d.add(params, 'parallax').name('3D parallaks');
  f3d.add(params, 'gyro').name('Telefon giroskopi');

  const fMouse = gui.addFolder('Sichqoncha');
  fMouse.add(params, 'mouseMode', { 'Itarish': 'push', 'Magnit (tortish)': 'pull' }).name('Rejim');
  fMouse.add(params, 'mouseForce', 0, 3, 0.01).name('Kuch');
  fMouse.add(params, 'mouseRadius', 0.02, 0.4, 0.005).name('Radius');
  fMouse.add(params, 'ripple').name("Bosganda to'lqin");

  const fExport = gui.addFolder('Eksport');
  fExport.add(params, 'videoFormat', {
    "Ekran o'lchamida": 'screen', 'Reels / TikTok (9:16)': 'reels', 'Kvadrat (1:1)': 'square', 'YouTube (16:9)': 'wide',
  }).name('Video formati');

  const fUi = gui.addFolder('Interfeys');
  fUi.add(params, 'autoHide').name('Avtomatik yashirish');

  gui.add({
    reset() {
      Object.assign(params, ALL_DEFAULTS);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      beatRange.value = params.beat;
      transitionSel.value = params.giftTransition;
      loopChk.checked = params.giftLoop;
      saveParams();
      engine.refreshStarts();
      refreshCurrent();
    },
  }, 'reset').name('Standart sozlamalar');

  [fAI, f3d, fMouse, fExport, fUi].forEach((f) => f.close());
  if (!panelOpen) gui.close();
  gui.onOpenClose((g) => {
    if (g !== gui) return;
    panelOpen = !gui._closed;
    engine.layout(true);
  });
  gui.onFinishChange(saveParams);

  // ------------------------------------------------------------------
  // Avtomatik tezlik nazorati: kompyuter sekin bo'lsa nuqtalar kamaytiriladi
  // ------------------------------------------------------------------
  let fpsTime = 0;
  let fpsFrames = 0;
  let autoReduced = false;
  const bootTime = performance.now();
  engine.onFrame((dt) => {
    if (autoReduced || recording || engine.isLive() || document.hidden) return;
    if (performance.now() - bootTime < 4000) return;
    fpsTime += dt;
    fpsFrames++;
    if (fpsTime < 3) return;
    const fps = fpsFrames / fpsTime;
    fpsTime = 0;
    fpsFrames = 0;
    if (fps < 28 && params.count > 30000) {
      autoReduced = true;
      params.count = Math.max(30000, Math.round((params.count * 0.6) / 5000) * 5000);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      saveParams();
      scheduleRefresh();
      toast(`Tezlik uchun nuqtalar soni ${params.count.toLocaleString('uz')} taga kamaytirildi`, 4500);
    }
  });

  // ------------------------------------------------------------------
  // Konsoldan boshqarish (masalan: portrait.engine.setProgress(0.5))
  // ------------------------------------------------------------------
  window.portrait = {
    engine,
    params,
    openURL,
    showText: (text) => showScene(makeTextScene(text), 'morph'),
    addGiftText: (text) => { giftScenes.push(makeTextScene(text)); renderScenes(); },
    addGiftURL: async (url, name) => {
      const sc = makeImageScene(await loadImage(url), name);
      giftScenes.push(sc);
      renderScenes();
      return sc;
    },
    giftScenes,
    playGift,
    stopGift,
    savePNG,
    exportGift,
    makeGiftHTML: () => makeGiftHTML(giftList()).then((r) => r.html),
    currentScene: () => current,
    setUiHidden,
    openGift: () => setGiftOpen(true),
  };

  // ------------------------------------------------------------------
  // Ishga tushirish
  // ------------------------------------------------------------------
  const srcParam = new URLSearchParams(location.search).get('src');
  if (srcParam) openURL(srcParam);
  else showScene(makeTextScene('SALOM'));
})();
