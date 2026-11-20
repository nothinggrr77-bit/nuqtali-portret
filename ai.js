/*
 * ai.js — sun'iy intellekt yordamchilari (Google MediaPipe)
 *   - fonni olib tashlash: odamni rasmdan ajratib olish (selfie segmenter, ~250 KB)
 *   - 3D chuqurlik: yuzning 478 nuqtasi + gavda shakli (face landmarker, ~3.7 MB)
 *   - qo'l imo-ishoralari: kaft / musht / ko'rsatkich barmoq (gesture recognizer, ~8 MB)
 *
 * Kutubxona va modellar faqat birinchi kerak bo'lganda internetdan yuklanadi,
 * keyin brauzer keshida saqlanadi.
 */
(function () {
  'use strict';

  const VERSION = '0.10.14';
  const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
  const MODELS = {
    segmenter: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    gesture: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task',
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  };

  let visionPromise = null;
  let segPromise = null;
  let gesturePromise = null;
  let facePromise = null;

  // Xato bo'lsa keyingi safar qaytadan urinish uchun keshni tozalaymiz
  const once = (get, set, make) => get() || set(make().catch((e) => { set(null); throw e; }));

  function loadVision() {
    return once(() => visionPromise, (p) => (visionPromise = p), async () => {
      const mod = await import(`${BASE}/vision_bundle.mjs`);
      const fileset = await mod.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      return { mod, fileset };
    });
  }

  function getSegmenter() {
    return once(() => segPromise, (p) => (segPromise = p), async () => {
      const { mod, fileset } = await loadVision();
      return mod.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.segmenter, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    });
  }

  function getGestureRecognizer() {
    return once(() => gesturePromise, (p) => (gesturePromise = p), async () => {
      const { mod, fileset } = await loadVision();
      const make = (delegate) => mod.GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.gesture, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      try {
        return await make('GPU');
      } catch (e) {
        return make('CPU'); // ba'zi kompyuterlarda GPU ishlamaydi
      }
    });
  }

  function getFaceLandmarker() {
    return once(() => facePromise, (p) => (facePromise = p), async () => {
      const { mod, fileset } = await loadVision();
      return mod.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.face, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      });
    });
  }

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /**
   * Rasmdagi odamni ajratadi.
   * Natija: { mask: canvas (alfa = odam), coverage: 0..1, box: {l,r,t,b} ulushlarda yoki null }
   */
  async function segmentPerson(canvas) {
    const seg = await getSegmenter();
    const res = seg.segment(canvas);
    const masks = res.confidenceMasks || [];
    const m = masks[masks.length - 1]; // bitta mask bo'lsa — odam ehtimolligi
    const w = m.width;
    const h = m.height;
    const data = m.getAsFloat32Array();

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    let minX = w, minY = h, maxX = -1, maxY = -1, cover = 0;
    for (let i = 0; i < w * h; i++) {
      const v = smooth(0.3, 0.7, data[i]); // chegarani biroz yumshatamiz
      const j = i * 4;
      img.data[j] = 255;
      img.data[j + 1] = 255;
      img.data[j + 2] = 255;
      img.data[j + 3] = Math.round(v * 255);
      if (v > 0.5) {
        cover++;
        const x = i % w;
        const y = (i / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (res.close) res.close();

    return {
      mask: c,
      coverage: cover / (w * h),
      box: maxX < 0 ? null : { l: minX / w, t: minY / h, r: 1 - (maxX + 1) / w, b: 1 - (maxY + 1) / h },
    };
  }

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const norm = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc * norm;
        acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc * norm;
        acc += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
      }
    }
    return out;
  }

  // Qavariq qobiq (Andrew'ning monotone chain algoritmi)
  function convexHull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const pt of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
      lower.push(pt);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const pt = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
      upper.push(pt);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  /**
   * 3D portret uchun chuqurlik xaritasi (oq — yaqin, qora — uzoq).
   *   1) gavda: odam maskasi kuchli xiralashtiriladi — yostiqsimon do'mboq shakl;
   *   2) yuz: 478 ta yuz nuqtasining chuqurligi yumshoq "dog'lar" bilan to'rga yoyiladi
   *      (burun oldinda, ko'z chuqurchalari orqada);
   *   3) odam topilmasa — yorug' joylar oldinda.
   * Natija: rasm bilan bir xil nisbatdagi kulrang canvas.
   */
  async function estimateDepth(canvas, seg) {
    const W = 256;
    const H = Math.max(8, Math.round((W * canvas.height) / canvas.width));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const n = W * H;
    const mask = new Float32Array(n);

    if (seg && seg.coverage >= 0.01) {
      ctx.drawImage(seg.mask, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3] / 255;
    } else {
      ctx.drawImage(canvas, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < n; i++) mask[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }

    // 1) Gavda hajmi
    let b = mask;
    const r = Math.max(2, Math.round(W * 0.06));
    for (let k = 0; k < 3; k++) b = boxBlur(b, W, H, r);
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) depth[i] = Math.sqrt(b[i]) * (0.3 + 0.7 * mask[i]);

    // 2) Yuz relyefi
    try {
      const fl = await getFaceLandmarker();
      const res = fl.detect(canvas);
      const lm = res.faceLandmarks && res.faceLandmarks[0];
      if (lm && lm.length) {
        let minX = 1, maxX = 0, zSum = 0;
        for (const p of lm) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); zSum += p.z; }
        const fw = Math.max(0.02, maxX - minX);
        const zMean = zSum / lm.length;

        // a) Yuz maydoni: barcha nuqtalarning tashqi konturi (qavariq qobiq) to'liq bo'yaladi
        const pts = lm.map((p) => [p.x * W, p.y * H]);
        const hull = convexHull(pts);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        const hd = ctx.getImageData(0, 0, W, H).data;
        let face = new Float32Array(n);
        for (let i = 0; i < n; i++) face[i] = hd[i * 4 + 3] / 255;
        const fr = Math.max(1, Math.round(fw * W * 0.06));
        face = boxBlur(boxBlur(face, W, H, fr), W, H, fr); // chegara yumshoq bo'lsin

        // b) Relyef: har nuqtaning chuqurligi yumshoq interpolyatsiya qilinadi
        const sigma = Math.max(2, fw * W * 0.07);
        const R = Math.ceil(sigma * 3);
        const num = new Float32Array(n);
        const den = new Float32Array(n);
        for (const p of lm) {
          const gx = p.x * W;
          const gy = p.y * H;
          const zr = Math.max(-0.5, Math.min(0.6, -(p.z - zMean) / fw)); // oldinga chiqqan joy musbat
          const x0 = Math.max(0, Math.floor(gx - R)), x1 = Math.min(W - 1, Math.ceil(gx + R));
          const y0 = Math.max(0, Math.floor(gy - R)), y1 = Math.min(H - 1, Math.ceil(gy + R));
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const dx = x - gx;
              const dy = y - gy;
              const wgt = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
              const i = y * W + x;
              num[i] += wgt * zr;
              den[i] += wgt;
            }
          }
        }
        for (let i = 0; i < n; i++) {
          if (face[i] <= 0.001 || den[i] <= 1e-9) continue;
          depth[i] += face[i] * (0.3 + (num[i] / den[i]) * 1.1);
        }
      }
    } catch (err) {
      console.warn("Yuz relyefini aniqlab bo'lmadi:", err);
    }

    // 3) 0..1 oralig'iga keltirib, kulrang rasmga aylantiramiz
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { if (depth[i] < lo) lo = depth[i]; if (depth[i] > hi) hi = depth[i]; }
    const span = hi - lo || 1;
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < n; i++) {
      const v = Math.round(((depth[i] - lo) / span) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  window.AI = { segmentPerson, estimateDepth, getSegmenter, getGestureRecognizer, getFaceLandmarker };
})();
