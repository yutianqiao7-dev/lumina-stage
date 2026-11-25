// 画面の仕上げ: ブルーム(光のにじみ)・色収差・ビネット・フィルムグレイン
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = any(isnan(c.rgb)) || any(isinf(c.rgb)) || !(c.r == c.r && c.g == c.g && c.b == c.b);
      gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(clamp(c.rgb, vec3(0.0), vec3(80.0)), c.a);
    }`,
};

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAberration: { value: 0.0015 }, uVignette: { value: 0.9 }, uGrain: { value: 0.04 }, uFade: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uAberration, uVignette, uGrain, uFade; varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uAberration * (1.0 + r2 * 4.0);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c *= mix(1.0, smoothstep(0.85, 0.2, r2 * 1.6), uVignette);
      c += (rand(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      c = mix(c, vec3(0.0), uFade);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // 計算できない値(NaN)や極端に明るい値を取り除く(ブルームで画面全体が黒くなるのを防ぐ)
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.enabled = true;
  }
  setCamera(camera) { this.renderPass.camera = camera; }
  setSize(w, h) {
    this.composer.setSize(w, h);
    // 中・低はブルームを半分の解像度で(見た目はほぼ同じで軽い)
    const k = this.quality === 'high' ? 1 : 0.5;
    this.bloom.setSize(Math.round(w * k), Math.round(h * k));
  }
  setQuality(q) {
    this.quality = q;
    this.enabled = q !== 'low';
    const samples = q === 'high' ? 4 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
  }
  setPixelRatio(pr) { this.composer.setPixelRatio(pr); }
  render(dt, { kick = 0, energy = 0, fade = 0 } = {}) {
    if (!this.enabled) { this.renderer.setRenderTarget(null); this.renderer.render(this.renderPass.scene, this.renderPass.camera); return; }
    const f = this.finish.uniforms;
    f.uTime.value += dt;
    f.uAberration.value = 0.0012 + kick * 0.004 * (energy / 3);
    f.uFade.value = fade;
    this.bloom.strength = 0.6 + 0.25 * (energy / 3) + kick * 0.25 * (energy / 3);
    this.composer.render(dt);
  }
}
