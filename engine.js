/*
 * engine.js — Nuqtali Portret dvigateli (three.js + GSAP)
 *
 * Muhim: bu funksiya sovg'a (HTML) fayliga .toString() orqali to'liq ko'chiriladi.
 * Shuning uchun u faqat THREE, gsap va brauzerning o'z API'lariga tayanadi —
 * tashqi o'zgaruvchilar yoki boshqa fayllarga murojaat qilmaydi.
 *
 * Asosiy g'oya:
 *   1) rasm yashirin canvasga chiziladi, har pikselning yorqinligi olinadi;
 *   2) kontrast, chegara, detallar va h.k. qo'llanadi;
 *   3) Floyd–Steinberg usuli bilan har pikselga nechta nuqta tushishi hisoblanadi —
 *      shuning uchun nuqtalar zichligi rasm yorqinligini aniq takrorlaydi;
 *   4) har nuqtaning boshlang'ich va maqsad joyi GPU'ga beriladi,
 *      shader ularni kechikish bilan aralashtirib "yig'ilish" effektini yaratadi.
 *
 * Harakat profillari (motion): har bir yig'ilish / yo'qolish turi uchun
 *   alpha — boshlang'ich holatdagi shaffoflik, size — o'lcham, turb — yo'ldagi to'lqinlanish,
 *   swirl — markaz atrofida aylanish kuchi.
 */
function createParticleEngine(canvas, params, opts) {
  'use strict';
  opts = opts || {};

  const CAM_Z = 10;
  const BASE_COUNT = 60000; // nuqta o'lchami shu songa nisbatan avtomatik moslanadi
  const NO_CROP = { l: 0, r: 0, t: 0, b: 0 };

  const DEFAULTS = {
    count: 80000, contrast: 1.25, brightness: 0, threshold: 0.06, gamma: 1.1, detail: 0.6,
    invert: false, crop: 0,
    shape: 'dot', size: 1, twinkle: 0.3, sparkle: 0.3, bloom: 0.6, depth: 0.08,
    colorMode: false, color: '#ffffff', color2: '#ffffff',
    bgStars: true, shooting: true, parallax: true,
    duration: 5, spread: 0.55, startShape: 'stars', order: 'random', leave: 'dust', swirl: 1.2, lines: 0.6,
    relief: 0.35, rotate3d: 'off', gyro: true,
    mouseMode: 'push', mouseForce: 1, mouseRadius: 0.12, ripple: true, beat: 1,
  };
  for (const k in DEFAULTS) if (!(k in params)) params[k] = DEFAULTS[k];

  // Yig'ilish turlari (qayerdan keladi)
  const SHAPES = {
    stars: { alpha: 0.55, size: 1, turb: 0.15, swirl: 1 },
    galaxy: { alpha: 0.6, size: 1, turb: 0.1, swirl: 1 },
    burst: { alpha: 0.9, size: 1, turb: 0.2, swirl: 1 },
    snow: { alpha: 0.85, size: 1.2, turb: 0.9, swirl: 0 },
    sandstorm: { alpha: 0.7, size: 0.8, turb: 1.3, swirl: 0.05 },
    vortex: { alpha: 0.6, size: 1, turb: 0.25, swirl: 3.2 },
    fireworks: { alpha: 1, size: 1.3, turb: 0.35, swirl: 0.1 },
    globe: { alpha: 0.85, size: 1, turb: 0.1, swirl: 1.6 },
  };
  // Yo'qolish turlari (qayerga ketadi)
  const LEAVES = {
    dust: { alpha: 0, size: 0.5, turb: 1.4, swirl: 0.08 },
    vortex: { alpha: 0.2, size: 0.4, turb: 0.3, swirl: 4 },
    gravity: { alpha: 0.35, size: 0.9, turb: 0.2, swirl: 0 },
    explode: { alpha: 0.25, size: 1.3, turb: 0.5, swirl: 0.25 },
    blow: { alpha: 0, size: 0.4, turb: 1.6, swirl: 0.15 },
  };
  const MORPH = { alpha: 1, size: 1, turb: 0.35, swirl: 0.12 };

  const getInsets = opts.getInsets || ((w, h) => ({ top: h * 0.06, bottom: h * 0.06, side: w * 0.05 }));
  const onStateChange = opts.onStateChange || (() => {});
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // ------------------------------------------------------------------
  // Sahna
  // ------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const basePR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(basePR);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.set(0, 0, CAM_Z);
  const group = new THREE.Group(); // rasm shu guruh ichida: masshtab, siljish va 3D aylanish
  scene.add(group);

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uSpread: { value: params.spread },
    uSwirl: { value: params.swirl },
    uSwirlMul: { value: 1 },
    uSize: { value: params.size },
    uImagePx: { value: 600 },
    uCountScale: { value: 1 },
    uTwinkle: { value: params.twinkle },
    uSparkle: { value: params.sparkle },
    uDepth: { value: params.depth },
    uRelief: { value: params.relief },
    uMouse: { value: new THREE.Vector3(99, 99, 0) }, // xy — joy, z — faollik (0..1)
    uMouseRadius: { value: params.mouseRadius },
    uMouseForce: { value: params.mouseForce },
    uMouseSign: { value: 1 },
    uRipple: { value: new THREE.Vector4(0, 0, -100, 0) }, // xy — markaz, z — boshlangan vaqt, w — kuch
    uCamZ: { value: CAM_Z },
    uBeat: { value: 0 },
    uStartAlpha: { value: 0.55 },
    uStartSize: { value: 1 },
    uTurb: { value: 0.15 },
    uShape: { value: 0 },
    uColor: { value: new THREE.Color(params.color) },
    uColor2: { value: new THREE.Color(params.color2) },
    uColorMix: { value: 0 },
  };

  const VERT = /* glsl */ `
    uniform float uTime;
    uniform float uProgress;
    uniform float uSpread;
    uniform float uSwirl;
    uniform float uSwirlMul;
    uniform float uSize;
    uniform float uImagePx;
    uniform float uCountScale;
    uniform float uTwinkle;
    uniform float uSparkle;
    uniform float uDepth;
    uniform float uRelief;
    uniform vec3  uMouse;
    uniform float uMouseRadius;
    uniform float uMouseForce;
    uniform float uMouseSign;
    uniform vec4  uRipple;
    uniform float uCamZ;
    uniform float uBeat;
    uniform float uStartAlpha;
    uniform float uStartSize;
    uniform float uTurb;

    attribute vec3  aStart;
    attribute vec4  aData;   // x: kechikish, y: yorqinlik, z,w: tasodifiy sonlar
    attribute float aDepth;  // AI chuqurlik xaritasidan (-0.5..0.5), bo'lmasa 0

  #ifdef LIVE
    uniform sampler2D uVideo;
    uniform float uMirror;
    uniform float uInvert;
    uniform vec4  uTone;     // kontrast, yorqinlik, chegara, gamma
    attribute vec2 aUv;
  #else
    attribute vec3 aColor;
  #endif

    varying float vAlpha;
    varying vec3  vColor;
    varying float vGrad;
    varying float vSize;
    varying float vBase;
    varying float vFlight;
    varying float vGlint;

    const float PI = 3.14159265;

    float easeInOutCubic(float t) {
      return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
    }

    vec2 rotate2d(vec2 p, float a) {
      float c = cos(a), s = sin(a);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    void main() {
      float delay = aData.x;
      float r1    = aData.z;
      float r2    = aData.w;

      // Har bir nuqtaning o'z vaqti: kechikish + yumshoq tezlanish/sekinlashish
      float local  = clamp((uProgress - delay * uSpread) / max(1.0 - uSpread, 0.001), 0.0, 1.0);
      float e      = easeInOutCubic(local);
      float flight = sin(local * PI);

    #ifdef LIVE
      // Jonli kamera: yorqinlik har kadrda videodan o'qiladi
      vec2 uv = vec2(mix(aUv.x, 1.0 - aUv.x, uMirror), aUv.y);
      vec3 texel = texture2D(uVideo, uv).rgb;
      float l = dot(texel, vec3(0.2126, 0.7152, 0.0722));
      l = mix(l, 1.0 - l, uInvert);
      l = clamp((l - 0.5) * uTone.x + 0.5 + uTone.y, 0.0, 1.0);
      l = l <= uTone.z ? 0.0 : (l - uTone.z) / (1.0 - uTone.z);
      float bright = mix(0.45, pow(l, uTone.w), e);
      vColor = texel;
    #else
      float bright = aData.y;
      vColor = aColor;
    #endif

      vec3 target = vec3(position.xy, (bright - 0.5) * uDepth + aDepth * uRelief);
      vec3 pos = mix(aStart, target, e);

      // Uchish paytida markaz atrofida aylanish va kameraga yaqinlashish
      float rest = 1.0 - e;
      pos.xy = rotate2d(pos.xy, rest * rest * uSwirl * uSwirlMul * (0.5 + r1));
      pos.z += flight * (r2 - 0.35) * 0.8;

      // Yo'ldagi to'lqinlanish (chang, qor, qum bo'roni)
      float tt = uTime * 0.9;
      pos += vec3(
        sin(pos.y * 6.0 + tt + r1 * 6.2831),
        cos(pos.x * 5.0 - tt * 1.2 + r2 * 6.2831),
        sin((pos.x - pos.y) * 4.0 + tt * 0.8 + r1 * 3.0)
      ) * flight * uTurb * 0.07;

      // Musiqa ritmi: nuqtalar biroz "nafas oladi"
      float bt = uBeat * e;
      pos.xy *= 1.0 + bt * 0.03 * (0.4 + r1);
      pos.z  += bt * (r2 - 0.5) * 0.3;

      // Yengil suzish (boshlang'ich holatda kuchliroq)
      float drift = mix(0.012, 0.0015, e);
      pos.x += sin(uTime * 0.55 + r1 * 47.0) * drift;
      pos.y += cos(uTime * 0.45 + r2 * 39.0) * drift;

      // Sichqoncha / barmoq: itarish yoki magnit
      vec2  md    = pos.xy - uMouse.xy;
      float mDist = length(md);
      float mF    = (1.0 - smoothstep(0.0, uMouseRadius, mDist)) * uMouse.z * uMouseForce;
      float push  = mF * uMouseRadius * 0.6;
      if (uMouseSign < 0.0) push = -min(push, mDist * 0.85);
      pos.xy += md / max(mDist, 1e-4) * push;
      pos.z  += mF * 0.06;

      // Bosilganda tarqaladigan to'lqin
      float age = uTime - uRipple.z;
      if (age > 0.0 && age < 4.0) {
        vec2  rd    = pos.xy - uRipple.xy;
        float rDist = length(rd);
        float ring  = exp(-pow((rDist - age * 0.8) * 12.0, 2.0)) * exp(-age * 1.2) * uRipple.w;
        pos.xy += rd / max(rDist, 1e-4) * ring * 0.03;
        pos.z  += ring * 0.15;
      }

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mv;

      // O'lcham: yorqin joylarda, uchayotganda va kameraga yaqinda kattaroq
      float base = uSize * uCountScale * (0.5 + 0.8 * bright) * uImagePx / 420.0;
      base *= 1.0 + flight * 1.2;
      base *= mix(uStartSize, 1.0, e);
      base *= 1.0 + bt * 0.6;
      base *= uCamZ / max(-mv.z, 0.5);

      // Shaffoflik va miltillash
      float alpha = 0.35 + 0.65 * bright;
      float tw = mix(0.75, uTwinkle, e);
      alpha *= 1.0 - tw * (0.5 + 0.5 * sin(uTime * (0.7 + r2 * 2.6) + r1 * 80.0));
      alpha *= mix(uStartAlpha, 1.0, e);
      alpha *= 1.0 + bt * 0.35;

    #ifdef LIVE
      base *= 1.8; // to'r (grid) siyrakroq, shuning uchun nuqtalar kattaroq
      if (bright < 0.02) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vAlpha = 0.0; vGrad = 0.0; vSize = 1.0; vBase = 1.0; vFlight = 0.0; vGlint = 0.0;
        return;
      }
    #endif

      // Yulduz chaqnashi: ba'zi nuqtalar vaqti-vaqti bilan ✦ bo'lib chaqnaydi
      float glint = 0.0;
      if (r2 > 1.0 - 0.035 * uSparkle) {
        float ph = uTime * (0.35 + r1 * 0.5) + r1 * 37.0;
        glint = pow(max(0.0, sin(ph)), 60.0) * (0.4 + 0.6 * bright);
      }

      // 1 pikseldan kichik nuqtalar yo'qolib qolmasligi uchun
      if (base < 1.0) { alpha *= base; base = 1.0; }
      base = min(base, 64.0);
      gl_PointSize = min(base * (1.0 + glint * 7.0), 96.0);

      vAlpha  = alpha;
      vGrad   = clamp(position.y + 0.5, 0.0, 1.0);
      vSize   = gl_PointSize;
      vBase   = base;
      vFlight = flight;
      vGlint  = glint;
    }
  `;

  const FRAG = /* glsl */ `
    uniform vec3  uColor;
    uniform vec3  uColor2;
    uniform float uColorMix;
    uniform float uShape;
    varying float vAlpha;
    varying vec3  vColor;
    varying float vGrad;
    varying float vSize;
    varying float vBase;
    varying float vFlight;
    varying float vGlint;

    // Yurak shakli (Inigo Quilez formulasi)
    float sdHeart(vec2 p) {
      p.x = abs(p.x);
      if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355339;
      vec2 a = p - vec2(0.0, 1.0);
      vec2 b = p - 0.5 * max(p.x + p.y, 0.0);
      return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
    }

    // Piksel aniqligidagi shakl: nuqta qancha katta bo'lsa shuncha ko'p yorug'lik beradi,
    // shuning uchun oddiy ekran, Retina va 4K rasmda yorqinlik bir xil chiqadi.
    float shapeMask(vec2 p) {
      float px = vBase;
      if (uShape < 0.5) return clamp(0.5 * px - length(p) * px + 0.5, 0.0, 1.0);
      if (uShape < 1.5) {
        vec2 q = abs(p) * 2.0;
        float n = 0.32 / sqrt(1.0 + 0.32 * 0.32);
        float d = min(q.x + q.y / 0.32 - 1.0, q.x / 0.32 + q.y - 1.0) * n * 0.5;
        return clamp(0.5 - d * px, 0.0, 1.0);
      }
      vec2 h = vec2(p.x, -p.y) * 1.25 + vec2(0.0, 0.55);
      return clamp(0.5 - sdHeart(h) / 1.25 * px, 0.0, 1.0);
    }

    void main() {
      vec2 c = gl_PointCoord - 0.5;
      vec2 p = c * (vSize / vBase); // asosiy shakl birliklarida (-0.5..0.5)
      float a = shapeMask(p);
      // Oddiy nuqtalar uchayotganda yumshoq yulduz nuriga aylanadi
      float glow = 1.0 - smoothstep(0.06, 0.5, length(p));
      if (uShape < 0.5) a = mix(a, glow, vFlight);
      // ✦ chaqnash nurlari
      if (vGlint > 0.001) {
        vec2 g = abs(c) * 2.0;
        float rays = max(exp(-g.y * 26.0) * (1.0 - g.x), exp(-g.x * 26.0) * (1.0 - g.y));
        float halo = exp(-dot(g, g) * 14.0);
        a = max(a, (rays + halo * 0.5) * vGlint);
      }
      if (a < 0.003) discard;
      vec3 tint = mix(uColor2, uColor, vGrad); // yuqori va pastki rang orasida gradient
      gl_FragColor = vec4(mix(tint, vColor, uColorMix), a * vAlpha);
    }
  `;

  function makeMaterial(live, extra) {
    return new THREE.ShaderMaterial({
      uniforms: Object.assign({}, uniforms, extra || {}),
      defines: live ? { LIVE: '' } : {},
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  }
  const material = makeMaterial(false);

  // ------------------------------------------------------------------
  // Fon yulduzlari va uchar yulduzlar
  // ------------------------------------------------------------------
  const starUniforms = { uTime: uniforms.uTime, uPixelRatio: { value: basePR } };
  const bgStars = (() => {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 70;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 45;
      pos[i * 3 + 2] = -20 - Math.random() * 60;
      rnd[i * 2] = Math.pow(Math.random(), 3);
      rnd[i * 2 + 1] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 2));
    const m = new THREE.ShaderMaterial({
      uniforms: starUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute vec2 aRand;
        varying float vA;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (0.8 + aRand.x * 2.2) * uPixelRatio;
          vA = (0.12 + aRand.x * 0.5) * (0.55 + 0.45 * sin(uTime * (0.4 + aRand.y * 1.5) + aRand.y * 90.0));
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(1.0), (1.0 - smoothstep(0.1, 0.5, d)) * vA);
        }
      `,
    });
    const s = new THREE.Points(g, m);
    s.frustumCulled = false;
    s.renderOrder = -1;
    scene.add(s);
    return s;
  })();

  const shooting = (() => {
    const N = 3;
    const pos = new Float32Array(N * 6);
    const alpha = new Float32Array(N * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aAlpha; varying float vA; void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(vec3(1.0), vA); }',
    });
    const lines = new THREE.LineSegments(g, m);
    lines.frustumCulled = false;
    lines.renderOrder = -1;
    scene.add(lines);
    const streaks = Array.from({ length: N }, () => ({ on: false, t: 0, dur: 1, x: 0, y: 0, dx: 0, dy: 0 }));
    return {
      update(dt) {
        lines.visible = params.shooting && params.bgStars;
        streaks.forEach((s, i) => {
          if (!s.on) {
            if (!lines.visible || Math.random() > dt / 9) { alpha[i * 2] = alpha[i * 2 + 1] = 0; return; }
            s.on = true;
            s.t = 0;
            s.dur = 0.7 + Math.random() * 0.7;
            s.x = (Math.random() * 2 - 1) * 45;
            s.y = 12 + Math.random() * 22;
            const a = -2.5 - Math.random() * 0.5; // pastga-chapga qiyalab
            s.dx = Math.cos(a) * 55;
            s.dy = Math.sin(a) * 55;
          }
          s.t += dt;
          const k = s.t / s.dur;
          if (k >= 1) { s.on = false; alpha[i * 2] = alpha[i * 2 + 1] = 0; return; }
          const hx = s.x + s.dx * s.t;
          const hy = s.y + s.dy * s.t;
          const len = 0.14 * Math.sin(Math.PI * k);
          pos.set([hx, hy, -45, hx - s.dx * len, hy - s.dy * len, -45], i * 6);
          alpha[i * 2] = 0.9 * Math.sin(Math.PI * k);
          alpha[i * 2 + 1] = 0;
        });
        g.attributes.position.needsUpdate = true;
        g.attributes.aAlpha.needsUpdate = true;
      },
    };
  })();

  // ------------------------------------------------------------------
  // Yulduz turkumlari: asosiy yulduzlar orasidagi chiziqlar
  // ------------------------------------------------------------------
  const lineUniforms = {
    uAlpha: { value: 0 },
    uDepth: uniforms.uDepth,
    uRelief: uniforms.uRelief,
    uColor: uniforms.uColor,
    uColor2: uniforms.uColor2,
  };
  const lineMat = new THREE.ShaderMaterial({
    uniforms: lineUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uDepth;
      uniform float uRelief;
      attribute float aB;
      attribute float aD;
      varying float vG;
      void main() {
        vG = clamp(position.y + 0.5, 0.0, 1.0);
        vec3 p = vec3(position.xy, (aB - 0.5) * uDepth + aD * uRelief);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      uniform vec3 uColor;
      uniform vec3 uColor2;
      varying float vG;
      void main() { gl_FragColor = vec4(mix(uColor2, uColor, vG), uAlpha); }
    `,
  });
  const constLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  constLines.frustumCulled = false;
  constLines.visible = false;
  group.add(constLines);

  function buildLines(f, anchors) {
    const A = anchors.length;
    const pairs = new Set();
    const cell = 1 / 10;
    for (let a = 0; a < A; a++) {
      const ia = anchors[a];
      const ax = f.targets[ia * 3];
      const ay = f.targets[ia * 3 + 1];
      const near = [];
      for (let b = 0; b < A; b++) {
        if (a === b) continue;
        const ib = anchors[b];
        const d = Math.hypot(f.targets[ib * 3] - ax, f.targets[ib * 3 + 1] - ay);
        if (d < cell * 2.4) near.push([d, b]);
      }
      near.sort((x, y) => x[0] - y[0]);
      near.slice(0, 2).forEach(([, b]) => pairs.add(a < b ? a + ',' + b : b + ',' + a));
    }
    const n = pairs.size;
    const pos = new Float32Array(n * 6);
    const ab = new Float32Array(n * 2);
    const ad = new Float32Array(n * 2);
    let k = 0;
    pairs.forEach((key) => {
      key.split(',').map(Number).forEach((ai) => {
        const i = anchors[ai];
        pos[k * 3] = f.targets[i * 3];
        pos[k * 3 + 1] = f.targets[i * 3 + 1];
        ab[k] = 1;
        ad[k] = f.depth[i];
        k++;
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aB', new THREE.BufferAttribute(ab, 1));
    g.setAttribute('aD', new THREE.BufferAttribute(ad, 1));
    constLines.geometry.dispose();
    constLines.geometry = g;
  }

  // ------------------------------------------------------------------
  // Yorug'lik nuri (bloom): sahna 3 bosqichda kichraytirilib xiralashtiriladi va qo'shiladi
  // ------------------------------------------------------------------
  const post = (() => {
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    quadScene.add(quad);
    const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const mat = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
    const down = mat(`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec4 s = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)) + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0))
               + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)) + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0));
        gl_FragColor = s * 0.25;
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    const blur = mat(`
      uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tSrc, vUv) * 0.2270270;
        c += (texture2D(tSrc, vUv + uDir * 1.3846154) + texture2D(tSrc, vUv - uDir * 1.3846154)) * 0.3162162;
        c += (texture2D(tSrc, vUv + uDir * 3.2307692) + texture2D(tSrc, vUv - uDir * 3.2307692)) * 0.0702703;
        gl_FragColor = c;
      }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    const comp = mat(`
      uniform sampler2D tScene; uniform sampler2D tB1; uniform sampler2D tB2; uniform sampler2D tB3;
      uniform float uStrength; varying vec2 vUv;
      void main() {
        vec3 b = texture2D(tB1, vUv).rgb * 0.25 + texture2D(tB2, vUv).rgb * 0.35 + texture2D(tB3, vUv).rgb * 0.45;
        gl_FragColor = vec4(texture2D(tScene, vUv).rgb + b * uStrength, 1.0);
      }`, { tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, uStrength: { value: 0 } });

    const rt = (w, h) => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    const build = (w, h) => ({
      w, h,
      main: rt(w, h),
      levels: [2, 4, 8].map((d) => ({ a: rt(w / d, h / d), b: rt(w / d, h / d) })),
    });
    const dispose = (c) => { if (!c) return; c.main.dispose(); c.levels.forEach((l) => { l.a.dispose(); l.b.dispose(); }); };
    let screenChain = null;

    function pass(m, target) {
      quad.material = m;
      renderer.setRenderTarget(target);
      renderer.render(quadScene, quadCam);
    }

    function run(chain, target) {
      renderer.setRenderTarget(chain.main);
      renderer.render(scene, camera);
      let src = chain.main;
      for (const lvl of chain.levels) {
        down.uniforms.tSrc.value = src.texture;
        down.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
        pass(down, lvl.a);
        blur.uniforms.tSrc.value = lvl.a.texture;
        blur.uniforms.uDir.value.set(1 / lvl.a.width, 0);
        pass(blur, lvl.b);
        blur.uniforms.tSrc.value = lvl.b.texture;
        blur.uniforms.uDir.value.set(0, 1 / lvl.b.height);
        pass(blur, lvl.a);
        src = lvl.a;
      }
      comp.uniforms.tScene.value = chain.main.texture;
      comp.uniforms.tB1.value = chain.levels[0].a.texture;
      comp.uniforms.tB2.value = chain.levels[1].a.texture;
      comp.uniforms.tB3.value = chain.levels[2].a.texture;
      comp.uniforms.uStrength.value = params.bloom;
      pass(comp, target);
      renderer.setRenderTarget(null);
    }

    const size = new THREE.Vector2();
    return {
      // Ekranga chizish
      render() {
        if (params.bloom < 0.01) {
          renderer.setRenderTarget(null);
          renderer.render(scene, camera);
          return;
        }
        renderer.getDrawingBufferSize(size);
        if (!screenChain || screenChain.w !== size.x || screenChain.h !== size.y) {
          dispose(screenChain);
          screenChain = build(size.x, size.y);
        }
        run(screenChain, null);
      },
      // Berilgan render target'ga chizish (4K rasm uchun)
      renderTo(target) {
        if (params.bloom < 0.01) {
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
          return;
        }
        const chain = build(target.width, target.height);
        run(chain, target);
        dispose(chain);
      },
    };
  })();

  // ------------------------------------------------------------------
  // Holat
  // ------------------------------------------------------------------
  let points = null;   // rasm nuqtalari
  let field = null;    // { count, targets, bright, colors, depth, edge, r1, r2, aspect }
  let source = null;   // { canvas, crop, depth? }
  let live = null;     // jonli kamera rejimi
  let output = null;   // { w, h } — video yozishda qat'iy o'lcham
  let imageAspect = 1;
  let fitScale = 1;
  let viewH = 1;
  let tween = null;
  let assembled = true;
  let extPointer = null;
  let tilt = null;      // telefon giroskopi
  let curOrder = 'random';
  const fitState = { scale: 1, y: 0 };
  const frameHooks = [];

  const countEff = () => params.count * (params.shape === 'dot' ? 1 : 0.2);

  // ------------------------------------------------------------------
  // O'lcham va joylashuv
  // ------------------------------------------------------------------
  function viewSize() {
    const h = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return { w: h * camera.aspect, h };
  }

  function applyFit() {
    fitScale = fitState.scale;
    group.scale.setScalar(fitScale);
    group.position.y = fitState.y;
    uniforms.uImagePx.value = (fitScale / viewH) * renderer.domElement.height;
  }

  // Rasm atrofdagi panellarga tegmasdan eng katta holda joylashadi
  function layout(animate) {
    let w, h;
    if (output) {
      w = output.w;
      h = output.h;
      renderer.setPixelRatio(1);
    } else {
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      renderer.setPixelRatio(basePR);
    }
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    starUniforms.uPixelRatio.value = renderer.getPixelRatio();

    const v = viewSize();
    viewH = v.h;
    const ins = getInsets(w, h, !!output);
    const pxToWorld = v.h / h;
    const availH = Math.max(h * 0.2, h - ins.top - ins.bottom) * pxToWorld;
    const availW = Math.max(w * 0.2, w - ins.side * 2) * pxToWorld;
    const scale = Math.min(availH, availW / imageAspect);
    const y = ((ins.bottom - ins.top) / 2) * pxToWorld;

    gsap.killTweensOf(fitState);
    if (animate) {
      gsap.to(fitState, { scale, y, duration: 0.6, ease: 'power2.out', onUpdate: applyFit });
    } else {
      fitState.scale = scale;
      fitState.y = y;
      applyFit();
    }
  }

  window.addEventListener('resize', () => { if (!output) layout(false); });

  // ------------------------------------------------------------------
  // Rasmni tahlil qilish
  // ------------------------------------------------------------------
  const workCanvas = document.createElement('canvas');
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  const depthCanvas = document.createElement('canvas');
  const depthCtx = depthCanvas.getContext('2d', { willReadFrequently: true });

  function cropRect(c, cr) {
    return {
      sx: c.width * cr.l,
      sy: c.height * cr.t,
      sw: Math.max(1, c.width * (1 - cr.l - cr.r)),
      sh: Math.max(1, c.height * (1 - cr.t - cr.b)),
    };
  }

  // Nuqtalar soniga qarab tahlil o'lchami: taxminan har 2.5 pikselga bitta nuqta
  function readPixels(src) {
    const cr = src.crop || NO_CROP;
    const r = cropRect(src.canvas, cr);
    const targetPixels = Math.min(1200000, Math.max(150000, countEff() * 2.5));
    const s = Math.sqrt(targetPixels / (r.sw * r.sh));
    const w = Math.max(8, Math.round(r.sw * s));
    const h = Math.max(8, Math.round(r.sh * s));
    workCanvas.width = w;
    workCanvas.height = h;
    workCtx.imageSmoothingQuality = 'high';
    workCtx.clearRect(0, 0, w, h);
    workCtx.drawImage(src.canvas, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    const out = { w, h, data: workCtx.getImageData(0, 0, w, h).data, depth: null };
    if (src.depth) {
      const d = cropRect(src.depth, cr);
      depthCanvas.width = w;
      depthCanvas.height = h;
      depthCtx.drawImage(src.depth, d.sx, d.sy, d.sw, d.sh, 0, 0, w, h);
      out.depth = depthCtx.getImageData(0, 0, w, h).data;
    }
    return out;
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

  // Har piksel uchun 0..1 oralig'idagi "nuqta zichligi"
  function toneMap(px) {
    const { w, h, data } = px;
    const n = w * h;
    const g = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let l = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
      if (params.invert) l = 1 - l;
      g[i] = l * (data[j + 3] / 255); // shaffof joylar qora hisoblanadi
    }
    if (params.detail > 0) {
      const b = boxBlur(g, w, h, Math.max(1, Math.round(Math.min(w, h) / 160)));
      const k = params.detail * 1.5;
      for (let i = 0; i < n; i++) g[i] += k * (g[i] - b[i]);
    }
    const c = params.contrast;
    const br = params.brightness;
    const th = Math.min(params.threshold, 0.95);
    const gm = params.gamma;
    const cx = Math.round(w * params.crop);
    const cy = Math.round(h * params.crop);
    const val = new Float32Array(n);
    for (let y = cy; y < h - cy; y++) {
      for (let x = cx; x < w - cx; x++) {
        const i = y * w + x;
        let v = (g[i] - 0.5) * c + 0.5 + br;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        v = v <= th ? 0 : (v - th) / (1 - th);
        val[i] = Math.pow(v, gm);
      }
    }
    return { w, h, val, x0: cx, y0: cy, cw: w - 2 * cx, ch: h - 2 * cy };
  }

  // Floyd–Steinberg: har piksel uchun nuqtalar soni (xatolik qo'shnilarga taqsimlanadi)
  function sampleParticles(px, tm) {
    const { w, h, val, x0, y0, cw, ch } = tm;
    const n = w * h;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += val[i];
    if (sum < 1e-6 || cw < 2 || ch < 2) return null;

    const scale = countEff() / sum;
    const err = new Float32Array(n);
    const counts = new Uint16Array(n);
    let total = 0;
    for (let y = 0; y < h; y++) {
      const ltr = (y & 1) === 0; // ilonsimon yurish — naqshlar kamroq bo'ladi
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = y * w + x;
        if (val[i] <= 0) continue; // qora joyga nuqta tushmaydi
        const e = val[i] * scale + err[i];
        let c = Math.floor(e + 0.5 + (Math.random() - 0.5) * 0.3);
        if (c < 0) c = 0;
        if (c > 65535) c = 65535;
        counts[i] = c;
        total += c;
        const q = e - c;
        const dx = ltr ? 1 : -1;
        const xn = x + dx;
        const xp = x - dx;
        if (xn >= 0 && xn < w) err[i + dx] += (q * 7) / 16;
        if (y + 1 < h) {
          const below = i + w;
          if (xp >= 0 && xp < w) err[below - dx] += (q * 3) / 16;
          err[below] += (q * 5) / 16;
          if (xn >= 0 && xn < w) err[below + dx] += q / 16;
        }
      }
    }
    if (total === 0) return null;

    // Tartibni aralashtiramiz — keyingi animatsiyalar uchun nuqtalar tasodifiy bo'lsin
    const order = new Uint32Array(total);
    for (let i = 0; i < total; i++) order[i] = i;
    for (let i = total - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }

    const targets = new Float32Array(total * 3);
    const bright = new Float32Array(total);
    const colors = new Float32Array(total * 3);
    const depth = new Float32Array(total);
    const edge = new Float32Array(total);
    const cxm = x0 + cw / 2;
    const cym = y0 + ch / 2;
    const data = px.data;
    const dd = px.depth;
    let maxEdge = 1e-6;
    let p = 0;
    for (let i = 0; i < n; i++) {
      const c = counts[i];
      if (!c) continue;
      const x = i % w;
      const y = (i / w) | 0;
      // Kontur kuchi (qalamda chizish va yulduz turkumlari uchun)
      const gx = val[Math.min(i + 1, n - 1)] - val[Math.max(i - 1, 0)];
      const gy = val[Math.min(i + w, n - 1)] - val[Math.max(i - w, 0)];
      const ed = Math.sqrt(gx * gx + gy * gy);
      if (ed > maxEdge) maxEdge = ed;
      const dv = dd ? dd[i * 4] / 255 - 0.5 : 0;
      for (let k = 0; k < c; k++) {
        const s = order[p++];
        targets[s * 3] = (x + Math.random() - cxm) / ch;
        targets[s * 3 + 1] = -(y + Math.random() - cym) / ch;
        bright[s] = Math.min(1, val[i]);
        colors[s * 3] = data[i * 4] / 255;
        colors[s * 3 + 1] = data[i * 4 + 1] / 255;
        colors[s * 3 + 2] = data[i * 4 + 2] / 255;
        depth[s] = dv;
        edge[s] = ed;
      }
    }
    const inv = 2 / maxEdge;
    for (let i = 0; i < total; i++) edge[i] = Math.min(1, edge[i] * inv);
    return withRandoms({ count: total, targets, bright, colors, depth, edge, aspect: cw / ch });
  }

  function withRandoms(f) {
    f.r1 = new Float32Array(f.count);
    f.r2 = new Float32Array(f.count);
    for (let i = 0; i < f.count; i++) { f.r1[i] = Math.random(); f.r2[i] = Math.random(); }
    return f;
  }

  // ------------------------------------------------------------------
  // Boshlang'ich joylar (yig'ilish turlari)
  // ------------------------------------------------------------------
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const FIREWORK_COUNT = 7;

  function computeStarts(f, shape) {
    const N = f.count;
    const starts = new Float32Array(N * 3);
    const v = viewSize();
    const s = fitScale;
    const oy = group.position.y;
    const diag = Math.hypot(v.w, v.h);
    const centers = [];
    for (let k = 0; k < FIREWORK_COUNT; k++) {
      centers.push([(Math.random() * 2 - 1) * v.w * 0.38, (Math.random() * 0.75 - 0.25) * v.h * 0.8, -2 + Math.random() * 2]);
    }

    for (let i = 0; i < N; i++) {
      let x;
      let y;
      let z;
      const ty = f.targets[i * 3 + 1] * s + oy; // maqsadning dunyo koordinatasidagi balandligi
      switch (shape) {
        case 'burst': {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.03 * s;
          x = Math.cos(a) * r;
          y = Math.sin(a) * r + oy;
          z = gauss() * 0.05 * s;
          break;
        }
        case 'galaxy': {
          const R = Math.max(v.w, v.h) * 0.62;
          const t = Math.pow(Math.random(), 0.75);
          const r = t * R;
          const a = (i % 3) * ((Math.PI * 2) / 3) + t * 5 + gauss() * 0.35 * (1.1 - t);
          const dx = Math.cos(a) * r + gauss() * 0.03 * R;
          const dz = Math.sin(a) * r;
          const thick = gauss() * 0.05 * R * (1 - t * 0.7);
          const tilt0 = 0.5;
          const gy = thick * Math.cos(tilt0) - dz * Math.sin(tilt0);
          const rot = -0.35;
          x = dx * Math.cos(rot) - gy * Math.sin(rot);
          y = dx * Math.sin(rot) + gy * Math.cos(rot);
          z = thick * Math.sin(tilt0) + dz * Math.cos(tilt0) - 4;
          break;
        }
        case 'snow': {
          // Qor: ekran tepasidan sekin tushadi
          x = (Math.random() * 2 - 1) * v.w * 0.6;
          y = v.h * 0.55 + Math.random() * v.h * 0.9;
          z = -3 + Math.random() * 4;
          break;
        }
        case 'sandstorm': {
          // Qum bo'roni: chap tomondan shamol olib keladi
          x = -v.w * 0.65 - Math.random() * v.w * 0.8;
          y = ty + gauss() * v.h * 0.15;
          z = gauss() * 1.5;
          break;
        }
        case 'vortex': {
          // Girdob: katta halqadan spiral bo'lib keladi
          const a = Math.random() * Math.PI * 2;
          const r = diag * (0.55 + Math.random() * 0.25);
          x = Math.cos(a) * r;
          y = Math.sin(a) * r * 0.8;
          z = -4 + gauss() * 1.5;
          break;
        }
        case 'fireworks': {
          // Salyut: bir necha nuqtada to'plangan uchqunlar portlab rasmga aylanadi
          const c = centers[i % FIREWORK_COUNT];
          const a = Math.random() * Math.PI * 2;
          const b = Math.acos(Math.random() * 2 - 1);
          const r = Math.random() * 0.12;
          x = c[0] + Math.sin(b) * Math.cos(a) * r;
          y = c[1] + Math.sin(b) * Math.sin(a) * r;
          z = c[2] + Math.cos(b) * r;
          break;
        }
        case 'globe': {
          // Globus: shar sirtidagi nuqtalar aylanib yoyiladi
          const a = Math.random() * Math.PI * 2;
          const b = Math.acos(Math.random() * 2 - 1);
          const R = v.h * 0.32;
          x = Math.sin(b) * Math.cos(a) * R;
          y = Math.cos(b) * R + oy;
          z = Math.sin(b) * Math.sin(a) * R - 1.5;
          break;
        }
        default: {
          // Yulduzli osmon: butun ekran bo'ylab, turli chuqurlikda
          z = -14 + Math.random() * 17;
          const k = (CAM_Z - z) / CAM_Z;
          x = (Math.random() * 2 - 1) * v.w * 0.6 * k;
          y = (Math.random() * 2 - 1) * v.h * 0.6 * k;
        }
      }
      starts[i * 3] = x / s;
      starts[i * 3 + 1] = (y - oy) / s;
      starts[i * 3 + 2] = Math.min(z, CAM_Z - 2.5) / s;
    }
    return starts;
  }

  // Yo'qolish turlari uchun "ketish" joylari (lokal birliklarda)
  function computeLeave(f, style) {
    const N = f.count;
    const starts = new Float32Array(N * 3);
    const v = viewSize();
    const s = fitScale;
    const bottom = (-v.h / 2 - group.position.y) / s;
    const zMax = (CAM_Z - 2.5) / s;
    for (let i = 0; i < N; i++) {
      const tx = f.targets[i * 3];
      const ty = f.targets[i * 3 + 1];
      let x;
      let y;
      let z;
      switch (style) {
        case 'vortex': {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.02;
          x = Math.cos(a) * r;
          y = Math.sin(a) * r;
          z = -0.8 - Math.random() * 0.6;
          break;
        }
        case 'gravity': {
          x = tx + gauss() * 0.04;
          y = bottom + Math.random() * 0.06;
          z = gauss() * 0.1;
          break;
        }
        case 'explode': {
          const k = 2.5 + Math.random() * 2;
          const a = Math.random() * Math.PI * 2;
          x = tx * k + Math.cos(a) * 0.3;
          y = ty * k + Math.sin(a) * 0.3;
          z = gauss() * 1.2;
          break;
        }
        case 'blow': {
          // Puflanganda: pastki markazdan uzoqlashib, orqaga uchib ketadi
          const dx = tx;
          const dy = ty + 0.6;
          const d = Math.hypot(dx, dy) || 1;
          const k = 0.6 + Math.random() * 1.0;
          x = tx + (dx / d) * k;
          y = ty + (dy / d) * k + 0.3;
          z = -1.5 - Math.random() * 2;
          break;
        }
        default: {
          // Chang: rasm o'ngga va yuqoriga kul bo'lib uchib ketadi
          x = tx + 0.5 + Math.random() * 1.4;
          y = ty + 0.1 + Math.random() * 0.7;
          z = gauss() * 0.4;
        }
      }
      starts[i * 3] = x;
      starts[i * 3 + 1] = y;
      starts[i * 3 + 2] = Math.min(z, zMax);
    }
    return starts;
  }

  // Oldingi rasm nuqtalaridan yangisiga silliq o'tish (o'lcham farqi ham hisobga olinadi)
  function morphStarts(f, prev, ratio) {
    const starts = new Float32Array(f.count * 3);
    for (let i = 0; i < f.count; i++) {
      const j = i % prev.count;
      starts[i * 3] = prev.targets[j * 3] * ratio;
      starts[i * 3 + 1] = prev.targets[j * 3 + 1] * ratio;
      starts[i * 3 + 2] = ((prev.bright[j] - 0.5) * params.depth + prev.depth[j] * params.relief) * ratio;
    }
    return starts;
  }

  // ------------------------------------------------------------------
  // Kechikishlar (yig'ilish tartibi)
  // ------------------------------------------------------------------
  // data (aData massivi) ichiga kechikish, yorqinlik va tasodifiy sonlarni yozadi.
  // "constellation" tartibida asosiy yulduzlar ro'yxatini qaytaradi.
  function applyOrder(f, data, order, shape) {
    const { count, targets, bright, aspect } = f;
    const maxR = Math.hypot(aspect / 2, 0.5);
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      const tx = targets[i * 3];
      const ty = targets[i * 3 + 1];
      let d;
      if (shape === 'fireworks') d = ((i % FIREWORK_COUNT) / FIREWORK_COUNT) * 0.85 + r * 0.12;
      else if (shape === 'sandstorm') d = (tx / aspect + 0.5) * 0.8 + r * 0.2;
      else {
        switch (order) {
          case 'center': d = (Math.hypot(tx, ty) / maxR) * 0.85 + r * 0.15; break;
          case 'top': d = (0.5 - ty) * 0.85 + r * 0.15; break;
          case 'bright': d = (1 - bright[i]) * 0.8 + r * 0.2; break;
          case 'sketch': d = (1 - f.edge[i]) * 0.85 + r * 0.15; break;
          case 'constellation': d = 0.3 + r * 0.7; break;
          case 'leave-dust': d = 1 - clamp01(tx / aspect + 0.5) * 0.85 - r * 0.15; break;
          case 'leave-vortex': d = 1 - (Math.hypot(tx, ty) / maxR) * 0.85 - r * 0.15; break;
          case 'leave-gravity': d = (0.5 - ty) * 0.85 + r * 0.15; break; // pastki qator birinchi tushadi
          case 'leave-blow': d = 1 - (Math.hypot(tx, ty + 0.6) / 1.4) * 0.8 - r * 0.2; break;
          case 'leave-explode': d = r * 0.4; break;
          default: d = r;
        }
      }
      data[i * 4] = clamp01(d);
      data[i * 4 + 1] = bright[i];
      data[i * 4 + 2] = f.r1[i];
      data[i * 4 + 3] = f.r2[i];
    }
    curOrder = order;
    if (order !== 'constellation') return null;

    // Asosiy yulduzlar: rasm to'rining har katagidan eng yorqin / eng aniq nuqta
    const cy = 10;
    const cx = Math.max(3, Math.round(cy * aspect));
    const best = new Int32Array(cx * cy).fill(-1);
    const score = new Float32Array(cx * cy);
    for (let i = 0; i < count; i++) {
      if (bright[i] < 0.25) continue;
      const gx = Math.min(cx - 1, Math.max(0, Math.floor((targets[i * 3] / aspect + 0.5) * cx)));
      const gy = Math.min(cy - 1, Math.max(0, Math.floor((targets[i * 3 + 1] + 0.5) * cy)));
      const c = gy * cx + gx;
      const sc = bright[i] + f.edge[i] * 0.5 + Math.random() * 0.2;
      if (sc > score[c]) { score[c] = sc; best[c] = i; }
    }
    const anchors = [];
    best.forEach((i) => {
      if (i < 0) return;
      anchors.push(i);
      data[i * 4] = 0;                               // birinchi bo'lib keladi
      data[i * 4 + 1] = Math.max(bright[i], 0.85);   // yorqinroq
      data[i * 4 + 3] = 0.9995;                      // ko'proq chaqnaydi
    });
    return anchors;
  }

  function makeData(f) {
    return new Float32Array(f.count * 4);
  }

  function setGeometry(f, starts, data) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(f.targets, 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(f.colors, 3));
    g.setAttribute('aDepth', new THREE.BufferAttribute(f.depth, 1));
    if (points) {
      points.geometry.dispose();
      points.geometry = g;
    } else {
      points = new THREE.Points(g, material);
      points.frustumCulled = false;
      group.add(points);
    }
  }

  function activeParts() {
    if (live) return { obj: live.points, f: live.field, live: true };
    if (points && field) return { obj: points, f: field, live: false };
    return null;
  }

  // Tartibni qo'llab, kerak bo'lsa yulduz turkumi chiziqlarini quradi
  function writeOrder(a, order, shape) {
    const attr = a.obj.geometry.getAttribute('aData');
    const anchors = applyOrder(a.f, attr.array, a.live ? 'random' : order, shape);
    attr.needsUpdate = true;
    if (anchors && anchors.length > 1) {
      buildLines(a.f, anchors);
      constLines.visible = true;
    } else {
      constLines.visible = false;
    }
  }

  function writeStarts(a, starts) {
    const attr = a.obj.geometry.getAttribute('aStart');
    attr.array.set(starts);
    attr.needsUpdate = true;
  }

  function setMotion(m) {
    uniforms.uStartAlpha.value = m.alpha;
    uniforms.uStartSize.value = m.size;
    uniforms.uTurb.value = m.turb;
    uniforms.uSwirlMul.value = m.swirl;
  }

  const refreshStarts = () => {
    const a = activeParts();
    if (!a) return;
    writeStarts(a, computeStarts(a.f, params.startShape));
    setMotion(SHAPES[params.startShape] || SHAPES.stars);
  };

  const refreshDelays = () => {
    const a = activeParts();
    if (a) writeOrder(a, params.order, params.startShape);
  };

  // ------------------------------------------------------------------
  // Animatsiya (GSAP)
  // ------------------------------------------------------------------
  function play(o) {
    o = o || {};
    const from = o.from != null ? o.from : uniforms.uProgress.value;
    const to = o.to != null ? o.to : 1;
    if (tween) tween.kill();
    uniforms.uSpread.value = o.spread != null ? o.spread : params.spread;
    if (o.motion) setMotion(o.motion);
    uniforms.uProgress.value = from;
    assembled = to === 1;
    onStateChange(assembled);
    tween = gsap.to(uniforms.uProgress, {
      value: to,
      duration: o.duration != null ? o.duration : params.duration,
      ease: 'none',
    });
    return tween;
  }

  // Tanlangan yig'ilish turi bilan boshidan
  function replay(shape) {
    const a = activeParts();
    if (!a) return;
    const sh = shape || params.startShape;
    writeStarts(a, computeStarts(a.f, sh));
    writeOrder(a, params.order, sh);
    play({ from: 0, motion: SHAPES[sh] || SHAPES.stars });
  }

  // Yo'qolish: tanlangan uslub bilan (davomiyligini qaytaradi)
  function leave(style) {
    style = style || params.leave;
    const a = activeParts();
    const dur = style === 'blow' ? 2.4 : params.duration * (style === 'dust' ? 0.9 : 0.7);
    if (!a || style === 'reverse' || !LEAVES[style] || uniforms.uProgress.value < 0.999) {
      play({ to: 0, duration: params.duration * 0.7 });
      return params.duration * 0.7;
    }
    writeStarts(a, computeLeave(a.f, style));
    writeOrder(a, 'leave-' + style, null);
    play({ to: 0, duration: dur, spread: 0.6, motion: LEAVES[style] });
    return dur;
  }

  const scatter = () => leave(params.leave);
  const assemble = () => play({ to: 1 }); // tarqalgan joydan ortga yig'iladi
  const toggle = () => (assembled ? scatter() : assemble());

  // mode: 'assemble' — tanlangan turdan to'liq yig'ilish, 'morph' — eski rasmdan oqib o'tish
  function setSource(src, mode, o) {
    o = o || {};
    stopLiveInternal();
    const px = readPixels(src);
    const f = sampleParticles(px, toneMap(px));
    if (!f) return false;
    source = src;
    const prev = field;
    const canMorph = mode === 'morph' && prev && points && uniforms.uProgress.value > 0.999;
    const prevFit = fitScale;

    field = f;
    imageAspect = f.aspect;
    layout(false);
    uniforms.uCountScale.value = Math.sqrt(BASE_COUNT / countEff());

    const shape = o.shape || params.startShape;
    const starts = canMorph ? morphStarts(f, prev, prevFit / fitScale) : computeStarts(f, shape);
    const data = makeData(f);
    setGeometry(f, starts, data);
    writeOrder({ obj: points, f, live: false }, params.order, canMorph ? null : shape);

    if (canMorph) {
      play({
        from: 0,
        duration: o.duration || 1.6,
        spread: o.spread != null ? o.spread : 0.35,
        motion: Object.assign({}, MORPH, { swirl: o.swirlMul != null ? o.swirlMul : MORPH.swirl }),
      });
    } else {
      play({ from: 0, duration: o.duration || params.duration, motion: SHAPES[shape] || SHAPES.stars });
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Ketma-ket sahnalar (sovg'a rejimi)
  //   sahna: { source, hold, assemble?, morph?, waitBlow? }
  //   waitBlow — sahnadan keyin puflashni (yoki bosishni) kutadi, keyin nuqtalar puflab yuboriladi
  // ------------------------------------------------------------------
  let seq = null;
  const SEQ_DEFAULTS = { transition: 'morph', loop: true, morphDuration: 2.8, autoBlow: false, onScene: null, onEnd: null, onWait: null };
  const BLOW_TIME = 2.4 + 0.4;

  const holdOf = (sc) => (sc.hold != null ? sc.hold : 3);

  function transitionTime(sc, o) {
    if (o.transition === 'scatter' && !sc.morph) {
      return params.duration * (params.leave === 'dust' ? 0.9 : 0.7) + params.duration * 0.8;
    }
    return sc.morph || o.morphDuration;
  }

  function sequenceDuration(scenes, o) {
    o = Object.assign({}, SEQ_DEFAULTS, o);
    if (!scenes.length) return 0;
    let total = (scenes[0].assemble || params.duration) + holdOf(scenes[0]);
    for (let i = 1; i < scenes.length; i++) {
      const prevBlow = scenes[i - 1].waitBlow;
      total += prevBlow ? BLOW_TIME + (scenes[i].assemble || params.duration) : transitionTime(scenes[i], o);
      total += holdOf(scenes[i]);
    }
    if (scenes[scenes.length - 1].waitBlow) total += BLOW_TIME;
    return total;
  }

  function stopSequence() {
    if (!seq) return;
    seq.stopped = true;
    seq.timers.forEach((t) => t.kill());
    seq = null;
  }

  function playSequence(scenes, o) {
    stopSequence();
    o = Object.assign({}, SEQ_DEFAULTS, o);
    const state = { i: -1, timers: [], stopped: false, waiting: null };
    seq = state;
    const later = (sec, fn) => state.timers.push(gsap.delayedCall(sec, () => { if (!state.stopped) fn(); }));

    const blowThen = () => {
      const d = leave('blow');
      later(d + 0.4, () => advance(true));
    };

    function advance(afterBlow) {
      const next = state.i + 1;
      if (next >= scenes.length && (!o.loop || scenes.length === 0)) {
        if (seq === state) seq = null;
        if (o.onEnd) o.onEnd();
        return;
      }
      const idx = next % scenes.length;
      const first = state.i < 0;
      state.i = idx;
      const sc = scenes[idx];
      let dur;
      if (first || afterBlow) {
        dur = sc.assemble || params.duration;
        setSource(sc.source, 'assemble', { duration: dur, shape: afterBlow ? 'fireworks' : undefined });
      } else if (o.transition === 'scatter' && !sc.morph) {
        const out = leave(params.leave);
        const back = params.duration * 0.8;
        later(out, () => setSource(sc.source, 'assemble', { duration: back }));
        dur = out + back;
      } else {
        dur = sc.morph || o.morphDuration;
        setSource(sc.source, 'morph', { duration: dur, spread: 0.45, swirlMul: sc.morph ? 0.25 : 0.5 });
      }
      if (o.onScene) o.onScene(idx);
      later(dur + holdOf(sc), () => {
        if (!sc.waitBlow) { advance(false); return; }
        if (o.autoBlow) { blowThen(); return; }
        state.waiting = () => { state.waiting = null; blowThen(); };
        if (o.onWait) o.onWait(idx);
      });
    }

    advance(false);
    return state;
  }

  // ------------------------------------------------------------------
  // Jonli kamera rejimi: nuqtalar to'ri video teksturadan yorqinlik oladi
  // ------------------------------------------------------------------
  function stopLiveInternal() {
    if (!live) return;
    group.remove(live.points);
    live.points.geometry.dispose();
    live.mat.dispose();
    live.tex.dispose();
    live = null;
    extPointer = null;
    if (points) points.visible = true;
    if (field) {
      imageAspect = field.aspect;
      uniforms.uCountScale.value = Math.sqrt(BASE_COUNT / countEff());
    }
    layout(false);
  }

  function startLive(video, o) {
    o = o || {};
    stopSequence();
    stopLiveInternal();
    const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
    const n = Math.min(countEff(), 90000);
    const rows = Math.max(20, Math.round(Math.sqrt(n / aspect)));
    const cols = Math.max(20, Math.round(rows * aspect));
    const N = rows * cols;
    const targets = new Float32Array(N * 3);
    const uvs = new Float32Array(N * 2);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, k++) {
        const u = (c + 0.5 + (Math.random() - 0.5) * 0.9) / cols;
        const v = (r + 0.5 + (Math.random() - 0.5) * 0.9) / rows;
        targets[k * 3] = (u - 0.5) * aspect;
        targets[k * 3 + 1] = v - 0.5;
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;
      }
    }
    const lf = withRandoms({
      count: N, targets, aspect,
      bright: new Float32Array(N), depth: new Float32Array(N), edge: new Float32Array(N), colors: new Float32Array(N * 3),
    });
    imageAspect = aspect;
    layout(false);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(targets, 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(computeStarts(lf, params.startShape), 3));
    g.setAttribute('aData', new THREE.BufferAttribute(makeData(lf), 4));
    g.setAttribute('aDepth', new THREE.BufferAttribute(lf.depth, 1));
    g.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const extra = {
      uVideo: { value: tex },
      uMirror: { value: o.mirror === false ? 0 : 1 },
      uInvert: { value: 0 },
      uTone: { value: new THREE.Vector4(1, 0, 0, 1) },
    };
    const mat = makeMaterial(true, extra);
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    group.add(p);
    if (points) points.visible = false;
    constLines.visible = false;
    live = { points: p, mat, tex, extra, field: lf };
    writeOrder(activeParts(), 'random', params.startShape);
    uniforms.uCountScale.value = Math.sqrt(BASE_COUNT / N);
    play({ from: 0, motion: SHAPES[params.startShape] || SHAPES.stars });
  }

  function stopLive() {
    const was = !!live;
    stopLiveInternal();
    if (was && points) replay();
  }

  // ------------------------------------------------------------------
  // Musiqa: past chastotalar (bas) kuchiga qarab ritm
  // ------------------------------------------------------------------
  let audioCtx = null;
  let analyser = null;
  let freq = null;
  let audioEl = null;
  let streamDest = null;
  let beat = 0;
  let beatFloor = 0;

  function attachAudio(el) {
    if (audioEl === el) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    const src = audioCtx.createMediaElementSource(el);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    freq = new Uint8Array(analyser.frequencyBinCount);
    streamDest = audioCtx.createMediaStreamDestination();
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    src.connect(streamDest);
    audioEl = el;
  }

  function updateBeat() {
    if (analyser && audioEl && !audioEl.paused) {
      analyser.getByteFrequencyData(freq);
      let s = 0;
      for (let i = 1; i <= 6; i++) s += freq[i];
      const lvl = s / (6 * 255);
      beatFloor += (lvl - beatFloor) * 0.02;
      const v = clamp01((lvl - beatFloor * 0.92) * 5);
      beat += (v - beat) * (v > beat ? 0.6 : 0.12);
    } else {
      beat *= 0.9;
    }
    uniforms.uBeat.value = beat * params.beat;
  }

  // Mikrofonga puflashni aniqlash (sham o'chirish uchun)
  function createBlowDetector(onBlow) {
    let ctx = null;
    let stream = null;
    let raf = 0;
    let stopped = false;
    return {
      level: 0,
      async start() {
        // AudioContext tugma bosilgan paytning o'zida yaratiladi, aks holda brauzer uni to'xtatib qo'yadi
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        const resumed = ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : null;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (resumed) await resumed;
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.3;
        ctx.createMediaStreamSource(stream).connect(an);
        const data = new Uint8Array(an.frequencyBinCount);
        let floor = 0.05;    // xonadagi shovqin darajasi (asta-sekin moslashadi)
        let above = 0;       // baland ovoz qancha davom etdi (ms)
        let cooldown = 0;    // ketma-ket ishga tushmasligi uchun
        let last = performance.now();
        const self = this;
        const loop = () => {
          if (stopped) return;
          raf = requestAnimationFrame(loop);
          const now = performance.now();
          const dt = now - last;
          last = now;
          an.getByteFrequencyData(data);
          let s = 0;
          for (let i = 1; i <= 40; i++) s += data[i]; // ~50–1900 Hz: puflash shovqini shu yerda kuchli
          const lvl = s / (40 * 255);
          self.level = lvl;
          if (lvl < floor + 0.15) floor += (lvl - floor) * 0.02;
          if (cooldown > 0) cooldown -= dt;
          if (lvl > Math.max(0.35, floor + 0.25)) above += dt;
          else above = Math.max(0, above - dt * 2);
          if (above > 250 && cooldown <= 0) {
            above = 0;
            cooldown = 1500;
            if (onBlow) onBlow();
          }
        };
        loop();
      },
      stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (ctx) ctx.close().catch(() => {});
      },
    };
  }

  // ------------------------------------------------------------------
  // Sichqoncha / barmoq / telefon giroskopi
  // ------------------------------------------------------------------
  const pointer = { ndc: new THREE.Vector2(), active: false };
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const planeNormal = new THREE.Vector3();
  const tmpLocal = new THREE.Vector3();

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  // Ekrandagi nuqtani rasm tekisligidagi (lokal) koordinataga aylantirish — 3D aylanishni ham hisobga oladi
  function pointerToLocal(out) {
    raycaster.setFromCamera(pointer.ndc, camera);
    planeNormal.set(0, 0, 1).applyQuaternion(group.quaternion);
    plane.setFromNormalAndCoplanarPoint(planeNormal, group.position);
    if (!raycaster.ray.intersectPlane(plane, out)) return out.set(99, 99, 0);
    group.updateMatrixWorld();
    return group.worldToLocal(out);
  }

  canvas.addEventListener('pointermove', (e) => { setPointer(e); pointer.active = true; });
  canvas.addEventListener('pointerleave', () => { pointer.active = false; });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointer.active = false; });
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    pointer.active = true;
    if (!params.ripple) return;
    pointerToLocal(tmpLocal);
    uniforms.uRipple.value.set(tmpLocal.x, tmpLocal.y, uniforms.uTime.value, 1);
  });

  window.addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    tilt = tilt || new THREE.Vector2();
    tilt.set(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 50) / 25)));
  });

  // iPhone'da giroskop uchun ruxsat tugma bosilganda so'raladi
  function requestMotionPermission() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') return D.requestPermission().catch(() => 'denied');
    return Promise.resolve('granted');
  }

  // ------------------------------------------------------------------
  // Yuqori sifatli rasm (masalan, 4K)
  // ------------------------------------------------------------------
  function snapshot(longSide) {
    longSide = longSide || 3840;
    const cw = renderer.domElement.width / renderer.getPixelRatio();
    const ch = renderer.domElement.height / renderer.getPixelRatio();
    const maxSize = Math.min(renderer.capabilities.maxTextureSize || 4096, 8192);
    const s = Math.min(longSide / Math.max(cw, ch), maxSize / Math.max(cw, ch));
    const W = Math.round(cw * s);
    const H = Math.round(ch * s);
    const k = H / renderer.domElement.height;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    const prevImagePx = uniforms.uImagePx.value;
    const prevStarPR = starUniforms.uPixelRatio.value;
    uniforms.uImagePx.value = prevImagePx * k;
    starUniforms.uPixelRatio.value = prevStarPR * k;
    post.renderTo(rt);
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    rt.dispose();
    uniforms.uImagePx.value = prevImagePx;
    starUniforms.uPixelRatio.value = prevStarPR;

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return new Promise((res) => out.toBlob(res, 'image/png'));
  }

  // ------------------------------------------------------------------
  // Yordamchi funksiyalar
  // ------------------------------------------------------------------
  function toCanvas(img, maxSide) {
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    const s = Math.min(1, (maxSide || 1600) / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * s));
    c.height = Math.max(1, Math.round(ih * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // Rasm chetidagi bir xil rangli ramkani topadi (ramka qatorida yorqinlik deyarli o'zgarmaydi)
  function detectTrim(src) {
    const s = Math.min(1, 400 / Math.max(src.width, src.height));
    const w = Math.max(4, Math.round(src.width * s));
    const h = Math.max(4, Math.round(src.height * s));
    workCanvas.width = w;
    workCanvas.height = h;
    workCtx.clearRect(0, 0, w, h);
    workCtx.drawImage(src, 0, 0, w, h);
    const d = workCtx.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    for (let i = 0, j = 0; i < L.length; i++, j += 4) {
      L[i] = ((0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255) * (d[j + 3] / 255);
    }
    const line = (start, step, len) => {
      let m = 0;
      let q = 0;
      for (let k = 0; k < len; k++) { const v = L[start + k * step]; m += v; q += v * v; }
      m /= len;
      return { m, s: Math.sqrt(Math.max(0, q / len - m * m)) };
    };
    const scan = (get, size) => {
      const first = get(0);
      if (first.s > 0.06) return 0;
      let n = 0;
      while (n < size * 0.15) {
        const l = get(n);
        if (l.s > 0.06 || Math.abs(l.m - first.m) > 0.06) break;
        n++;
      }
      return n ? n / size + 0.004 : 0;
    };
    return {
      l: scan((k) => line(k, w, h), w),
      r: scan((k) => line(w - 1 - k, w, h), w),
      t: scan((k) => line(k * w, 1, w), h),
      b: scan((k) => line((h - 1 - k) * w, 1, w), h),
    };
  }

  // Matnni qora fonda oq harflar bilan chizadi (uzun qatorlar avtomatik bo'linadi)
  function makeTextCanvas(text) {
    const W = 1800;
    const pad = 90;
    const maxW = W - pad * 2;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = (s) => `800 ${s}px system-ui, "Segoe UI", Arial, sans-serif`;
    const lines = String(text).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) lines.push(' ');

    const wrapLine = (line) => {
      const words = line.split(/\s+/);
      const out = [];
      let cur = '';
      for (const word of words) {
        const test = cur ? cur + ' ' + word : word;
        if (cur && ctx.measureText(test).width > maxW) { out.push(cur); cur = word; }
        else cur = test;
      }
      if (cur) out.push(cur);
      return out;
    };

    let size = 260;
    let wrapped;
    for (;;) {
      ctx.font = font(size);
      wrapped = lines.flatMap(wrapLine);
      const widest = Math.max(...wrapped.map((l) => ctx.measureText(l).width));
      if ((wrapped.length * size * 1.15 <= 1100 && widest <= maxW) || size <= 48) break;
      size -= 16;
    }
    const lh = size * 1.15;
    c.width = W;
    c.height = Math.round(wrapped.length * lh + pad * 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = font(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapped.forEach((l, i) => ctx.fillText(l, W / 2, pad + lh * (i + 0.5)));
    return c;
  }

  // ------------------------------------------------------------------
  // Asosiy sikl
  // ------------------------------------------------------------------
  const clock = new THREE.Clock();
  const camTarget = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const SHAPE_IDS = { dot: 0, star: 1, heart: 2 };
  let lastC1 = '';
  let lastC2 = '';

  function syncUniforms() {
    uniforms.uSize.value = params.size;
    uniforms.uTwinkle.value = params.twinkle;
    uniforms.uSparkle.value = params.sparkle;
    uniforms.uDepth.value = params.depth;
    uniforms.uRelief.value = params.relief;
    uniforms.uSwirl.value = params.swirl;
    uniforms.uMouseForce.value = params.mouseForce;
    uniforms.uMouseRadius.value = params.mouseRadius;
    uniforms.uMouseSign.value = params.mouseMode === 'pull' ? -1 : 1;
    uniforms.uShape.value = SHAPE_IDS[params.shape] || 0;
    uniforms.uColorMix.value = params.colorMode ? 1 : 0;
    if (params.color !== lastC1) { uniforms.uColor.value.set(params.color); lastC1 = params.color; }
    if (params.color2 !== lastC2) { uniforms.uColor2.value.set(params.color2); lastC2 = params.color2; }
    if (live) {
      live.extra.uTone.value.set(params.contrast, params.brightness, Math.min(params.threshold, 0.95), params.gamma);
      live.extra.uInvert.value = params.invert ? 1 : 0;
    }
    bgStars.visible = params.bgStars;

    // Yulduz turkumi chiziqlari: asosiy yulduzlar yetib kelganda paydo bo'ladi, keyin xiralashadi
    if (constLines.visible) {
      const p = uniforms.uProgress.value;
      const arrive = 1 - uniforms.uSpread.value;
      const rise = THREE.MathUtils.smoothstep(p, arrive * 0.6, arrive);
      const settle = THREE.MathUtils.smoothstep(p, arrive, 1);
      lineUniforms.uAlpha.value = rise * (0.9 - 0.6 * settle) * params.lines * (curOrder === 'constellation' ? 1 : 0);
    }
  }

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;
    syncUniforms();
    updateBeat();
    shooting.update(dt);

    // Kirish: sichqoncha, bo'lmasa telefon giroskopi
    let input = null;
    if (!output) {
      if (pointer.active) input = pointer.ndc;
      else if (params.gyro && tilt) input = tilt;
    }

    // 3D parallaks: kamera biroz suriladi
    if (params.parallax && input) camTarget.set(input.x * 0.6, input.y * 0.4, CAM_Z);
    else camTarget.set(0, 0, CAM_Z);
    camera.position.lerp(camTarget, 0.04);
    camera.lookAt(origin);
    camera.updateMatrixWorld();

    // 3D aylanish
    let ry = 0;
    let rx = 0;
    if (params.rotate3d === 'follow') {
      if (input) { ry = input.x * 0.55; rx = -input.y * 0.28; }
      else { ry = Math.sin(t * 0.4) * 0.12; }
    } else if (params.rotate3d === 'sway') {
      ry = Math.sin(t * 0.45) * 0.45;
      rx = Math.sin(t * 0.31) * 0.1;
    }
    group.rotation.y += (ry - group.rotation.y) * 0.06;
    group.rotation.x += (rx - group.rotation.x) * 0.06;

    // Sichqoncha yoki qo'l joyini yumshoq kuzatish
    const m = uniforms.uMouse.value;
    let active = false;
    if (extPointer) {
      tmpLocal.set(extPointer.x, extPointer.y, 0);
      active = true;
    } else if (pointer.active) {
      pointerToLocal(tmpLocal);
      active = true;
    }
    if (active) {
      if (m.z < 0.01) { m.x = tmpLocal.x; m.y = tmpLocal.y; }
      m.x += (tmpLocal.x - m.x) * 0.25;
      m.y += (tmpLocal.y - m.y) * 0.25;
    }
    m.z += ((active ? 1 : 0) - m.z) * 0.08;

    bgStars.rotation.z = t * 0.004;
    for (let i = 0; i < frameHooks.length; i++) frameHooks[i](dt, t);
    post.render();
  });

  layout(false);

  return {
    params,
    uniforms,
    defaults: Object.assign({}, DEFAULTS),
    setSource,
    resample: (mode) => (source ? setSource(source, mode || 'morph') : false),
    play,
    replay: () => replay(),
    scatter,
    leave,
    assemble,
    toggle,
    setProgress(p) { if (tween) tween.kill(); uniforms.uProgress.value = p; },
    isAssembled: () => assembled,
    refreshStarts,
    refreshDelays,
    layout,
    setOutputSize(w, h) { output = { w, h }; layout(false); },
    clearOutputSize() { output = null; layout(false); },
    snapshot,
    attachAudio,
    resumeAudio: () => (audioCtx && audioCtx.state === 'suspended' ? audioCtx.resume() : Promise.resolve()),
    getAudioStream: () => (streamDest ? streamDest.stream : null),
    playSequence,
    stopSequence,
    sequenceDuration,
    isPlayingSequence: () => !!seq,
    isWaiting: () => !!(seq && seq.waiting),
    continueSequence() { if (seq && seq.waiting) seq.waiting(); },
    startLive,
    stopLive,
    isLive: () => !!live,
    setExternalPointer(p) { extPointer = p; },
    requestMotionPermission,
    onFrame(fn) { frameHooks.push(fn); },
    utils: { toCanvas, detectTrim, makeTextCanvas, createBlowDetector },
  };
}
