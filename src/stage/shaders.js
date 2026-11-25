// ステージ用のシェーダー: ライトの光線・LEDの壁・LEDの床・レーザー
import * as THREE from 'three';

const NOISE = /* glsl */ `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float hash1(float n){ return fract(sin(n)*43758.5453123); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

// ---------- 光線(ムービングライトのビーム) ----------
export function makeBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 1 },
      uLength: { value: 20 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vWorld;
      uniform float uLength;
      void main(){
        vAlong = clamp(-position.y / uLength, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vWorld;
      uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
      ${NOISE}
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(f, 2.6);
        float fade = pow(1.0 - vAlong, 1.4) * smoothstep(0.0, 0.04, vAlong);
        float dust = 0.78 + 0.22 * sin(vWorld.y * 2.3 + vWorld.x * 1.7 + uTime * 0.6) * sin(vWorld.z * 1.9 - uTime * 0.4);
        float a = core * fade * dust * uIntensity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------- レーザー ----------
export function makeLaserMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; varying vec3 vColor; varying vec2 vUv;
      #include <common>
      void main(){
        vUv = uv;
        vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying vec2 vUv; uniform float uIntensity;
      void main(){
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float a = pow(across, 3.0) * (1.0 - vUv.y * 0.7) * uIntensity;
        gl_FragColor = vec4(vColor * a * 3.0, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------- LEDの大型スクリーン ----------
export function makeLEDWallMaterial({ res = new THREE.Vector2(256, 112), aspect = 16 / 7 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uBeat: { value: 0 }, uEnergy: { value: 0 },
      uC1: { value: new THREE.Color('#ff3fa0') }, uC2: { value: new THREE.Color('#3fd0ff') }, uC3: { value: new THREE.Color('#ffd23f') },
      uFeed: { value: null }, uFeedMix: { value: 0 }, uFeedFull: { value: 0 },
      uModeA: { value: 0 }, uModeB: { value: 1 }, uMix: { value: 0 },
      uLevels: { value: new THREE.Vector4() },
      uRes: { value: res }, uAspect: { value: aspect },
      uBright: { value: 1 }, uFlash: { value: 0 },
      uText: { value: null }, uTextMix: { value: 0 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uBeat, uEnergy, uFeedMix, uFeedFull, uModeA, uModeB, uMix, uAspect, uBright, uFlash, uTextMix;
      uniform vec3 uC1, uC2, uC3; uniform sampler2D uFeed; uniform sampler2D uText; uniform vec4 uLevels; uniform vec2 uRes;
      ${NOISE}
      vec3 pal(float t){ t = fract(t); return t < 0.333 ? mix(uC1, uC2, t*3.0) : t < 0.666 ? mix(uC2, uC3, (t-0.333)*3.0) : mix(uC3, uC1, (t-0.666)*3.0); }
      vec3 modeColor(float m, vec2 uv){
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        float beat = uBeat; float fb = fract(beat);
        float kick = exp(-fb * 5.0);
        if (m < 0.5) { // 波のグラデーション
          float w = sin(p.x * 3.0 + uTime * 0.7) * 0.5 + sin(p.y * 4.0 - uTime * 0.5 + p.x) * 0.5;
          float bands = smoothstep(0.2, 0.0, abs(fract(p.y * 2.5 + w * 0.4 - uTime * 0.12) - 0.5) - 0.18);
          return pal(w * 0.3 + uTime * 0.05) * (0.25 + 0.75 * bands) * (0.6 + 0.4 * kick);
        } else if (m < 1.5) { // トンネル
          float r = length(p); float a = atan(p.y, p.x + 1e-5);
          float z = 0.35 / max(r, 0.02) + beat * 0.5;
          float rings = smoothstep(0.42, 0.5, abs(fract(z) - 0.5) * 1.0 + 0.0);
          float spokes = smoothstep(0.75, 1.0, sin(a * 8.0 + uTime * 1.5 + z * 0.5));
          vec3 c = pal(z * 0.15) * (1.0 - rings * 0.85) + uC3 * spokes * 0.3;
          return c * smoothstep(0.0, 0.25, r) * (0.7 + 0.6 * kick);
        } else if (m < 2.5) { // イコライザー
          float bars = 48.0;
          float id = floor(uv.x * bars);
          float hgt = 0.15 + 0.75 * (0.5 + 0.5 * sin(id * 1.7 + uTime * 3.0 + hash1(id) * 6.0)) * (0.35 + uLevels.x * 0.4 + uLevels.y * 0.5);
          hgt *= 0.55 + 0.45 * abs(sin(id * 0.37 + beat * 1.57));
          float on = step(abs(uv.y - 0.5) * 2.0, hgt);
          float gap = step(0.15, fract(uv.x * bars));
          float seg2 = step(0.25, fract(uv.y * 28.0));
          return pal(id / bars + uTime * 0.03) * on * gap * seg2 * (0.6 + 0.6 * kick);
        } else if (m < 3.5) { // 万華鏡
          float r = length(p); float a = atan(p.y, p.x + 1e-5);
          float k = 6.0; a = mod(a, 6.2831 / k); a = abs(a - 3.1415 / k);
          vec2 q = vec2(cos(a), sin(a)) * r;
          q += vec2(uTime * 0.1, beat * 0.08);
          float n = fbm(q * 3.0);
          float lines = smoothstep(0.03, 0.0, abs(fract(n * 4.0 + beat * 0.25) - 0.5) - 0.42);
          return pal(n + r * 0.4 + uTime * 0.04) * (0.3 + 1.2 * lines) * (0.6 + 0.5 * kick);
        } else { // 星空・ハートの雨
          vec2 g = uv * vec2(uAspect * 14.0, 14.0); vec2 id = floor(g); vec2 f = fract(g) - 0.5;
          float h = hash(id);
          float tw = pow(0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 30.0), 6.0);
          float star = smoothstep(0.2, 0.0, length(f)) * step(0.7, h) * tw;
          vec3 base = mix(uC1 * 0.08, uC2 * 0.16, uv.y);
          return base + pal(h) * star * 1.5;
        }
      }
      void main(){
        vec2 grid = vUv * uRes;
        vec2 cellUv = (floor(grid) + 0.5) / uRes;
        vec2 l = fract(grid) - 0.5;
        float dotm = smoothstep(0.5, 0.28, length(l));
        vec3 col;
        if (uMix >= 0.999) col = modeColor(uModeB, cellUv);
        else if (uMix <= 0.001) col = modeColor(uModeA, cellUv);
        else col = mix(modeColor(uModeA, cellUv), modeColor(uModeB, cellUv), uMix);
        // ライブカメラ映像
        vec2 fr = vec2(0.5, 0.5);
        float fw = mix(0.5, 1.0, uFeedFull);
        vec2 fUv = (cellUv - 0.5) * vec2(uAspect / (16.0/9.0), 1.0) / mix(0.86, 1.0, uFeedFull) + 0.5;
        fUv.x = (cellUv.x - 0.5) / fw * 1.0 + 0.5;
        fUv.y = (cellUv.y - 0.5) * (uAspect / (16.0 / 9.0)) / fw + 0.5;
        float inside = step(0.0, fUv.x) * step(fUv.x, 1.0) * step(0.0, fUv.y) * step(fUv.y, 1.0);
        vec3 feed = texture2D(uFeed, clamp(fUv, 0.0, 1.0)).rgb;
        feed = pow(max(feed, vec3(0.0)), vec3(0.9)) * 0.85;
        float edge = inside * (1.0 - smoothstep(0.0, 0.01, min(min(fUv.x, 1.0 - fUv.x), min(fUv.y, 1.0 - fUv.y))));
        col = mix(col, feed, uFeedMix * inside);
        col += uC3 * edge * uFeedMix * 2.0;
        // 文字(曲名など)
        vec4 tx = texture2D(uText, cellUv);
        col = mix(col, tx.rgb * 2.0, tx.a * uTextMix);
        col += vec3(uFlash);
        // 走査線のゆらぎ
        col *= 0.92 + 0.08 * sin(vUv.y * 900.0 + uTime * 20.0);
        gl_FragColor = vec4(col * dotm * uBright * 0.95 + col * 0.04, 1.0);
      }`,
    toneMapped: true,
  });
}

// ---------- LEDの床 ----------
export function makeLEDFloorMaterial({ size = new THREE.Vector2(14, 9) } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uBeat: { value: 0 }, uEnergy: { value: 0 },
      uC1: { value: new THREE.Color('#ff3fa0') }, uC2: { value: new THREE.Color('#3fd0ff') }, uC3: { value: new THREE.Color('#ffd23f') },
      uDancer: { value: new THREE.Vector2() }, uSize: { value: size }, uPattern: { value: 0 }, uBright: { value: 1 },
    },
    vertexShader: /* glsl */ `varying vec2 vP; uniform vec2 uSize; void main(){ vP = (uv - 0.5) * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      uniform float uTime, uBeat, uEnergy, uPattern, uBright; uniform vec3 uC1, uC2, uC3; uniform vec2 uDancer, uSize;
      ${NOISE}
      void main(){
        float tile = 0.6;
        vec2 g = vP / tile; vec2 id = floor(g); vec2 f = fract(g);
        vec2 c = (id + 0.5) * tile;
        float inner = smoothstep(0.0, 0.06, f.x) * smoothstep(1.0, 0.94, f.x) * smoothstep(0.0, 0.06, f.y) * smoothstep(1.0, 0.94, f.y);
        float fb = fract(uBeat);
        float d = distance(c, uDancer);
        float rq = (d - fb * 7.0) * 1.1; float ripple = exp(-rq * rq) * (1.0 - fb);
        float checker = step(0.5, mod(id.x + id.y + floor(uBeat), 2.0)) * exp(-fb * 3.0);
        float spark = step(0.93, hash(id + floor(uBeat * 2.0))) * (1.0 - fract(uBeat * 2.0));
        float sq = (c.x - (fract(uBeat / 4.0) - 0.5) * uSize.x * 1.2) * 0.9; float scan = exp(-sq * sq);
        float ring = smoothstep(1.6, 1.2, d) * smoothstep(0.7, 1.0, d) * (0.4 + 0.6 * exp(-fb * 4.0));
        float m = uPattern;
        float v = 0.0;
        if (m < 0.5) v = ripple * 0.9 + ring * 0.4;
        else if (m < 1.5) v = checker * 0.7 + ripple * 0.4;
        else if (m < 2.5) v = scan * 0.8 + spark;
        else v = spark * 1.2 + ripple * 0.6 + ring * 0.3;
        vec3 col = mix(uC1, uC2, 0.5 + 0.5 * sin(c.x * 0.4 + uTime * 0.5));
        col = mix(col, uC3, spark);
        float base = 0.03 + 0.02 * hash(id);
        vec3 outc = (col * v * (0.16 + uEnergy * 0.2) + col * base * 0.6) * inner * uBright;
        // 中央の円(立ち位置)
        float center = smoothstep(0.03, 0.0, abs(length(vP - uDancer) - 1.35));
        outc += uC3 * center * 0.8;
        gl_FragColor = vec4(outc, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ---------- ステージの縁などのLEDライン ----------
export function makeChaseMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBeat: { value: 0 }, uEnergy: { value: 0 }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uLen: { value: 14 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime, uBeat, uEnergy, uLen; uniform vec3 uC1, uC2;
      void main(){
        float x = vUv.x * uLen;
        float px = fract(x * 4.0);
        float dotm = smoothstep(0.5, 0.2, abs(px - 0.5));
        float chase = 0.5 + 0.5 * sin(x * 1.2 - uBeat * 3.1416);
        float k = exp(-fract(uBeat) * 4.0);
        vec3 col = mix(uC1, uC2, chase) * (0.4 + 0.8 * chase * (0.4 + uEnergy * 0.3) + 0.6 * k * uEnergy * 0.33);
        gl_FragColor = vec4(col * dotm * 2.2, 1.0);
      }`,
  });
}

// ---------- 床のスモーク・空気中のちり ----------
export function makeSoftSpriteTexture(size = 128, kind = 'dot') {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (kind === 'dot') {
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
  } else if (kind === 'smoke') {
    const img = g.createImageData(size, size);
    const rnd = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      let n = 0, amp = 0.5, fr = 4;
      for (let o = 0; o < 5; o++) { n += amp * noise(nx * fr, ny * fr); amp *= 0.5; fr *= 2; }
      const dx = nx - 0.5, dy = ny - 0.5;
      const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(fall, 1.5) * Math.max(0, n - 0.25) * 1.8;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
