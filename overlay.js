(() => {
  const ID = "fx-overlay-canvas";
  const DPR_CAP = 2;

  // ===== FX Zone Config (SSOT) =====
  const FX_ZONE_SELECTOR = "[data-fx-zone]";
  const FX_MAX_RECTS = 16;            // shader uRects[16]와 일치
  const FX_MIN_RECT_W = 18;
  const FX_MIN_RECT_H = 10;
  const FX_MAX_TEXT_NODES = 240;      // 성능 안전장치
  const FX_RECTS_REFRESH_MS = 120;    // DOM/스크롤 갱신 디바운스

  // 근접도(옵션1): 마우스가 텍스트 라인에서 이 거리 이상 멀면 주입 0에 수렴
  // 단위는 "화면의 짧은 변 기준 UV". (대략 px 체감)
  const FX_PROX_FAR_PX = 260;

  // 옵션2: 인터랙티브 요소 위에서는 잉크 강도를 줄인다
  const FX_UI_ATTEN_INTERACTIVE = 0.35;

  const INTERACTIVE_SELECTOR = [
    "a","button","input","textarea","select",
    "[role='button']","[role='link']","[contenteditable='true']"
  ].join(",");

  // ----------------------------
  // 1) Canvas singleton (+ inline style fallback)
  // ----------------------------
  function ensureCanvas() {
    let c = document.getElementById(ID);
    if (!c) {
      c = document.createElement("canvas");
      c.id = ID;
      document.body.appendChild(c);
    }
    // CSS가 안 먹는 상황 대비 (Super/Notion이 가끔 style 우선권 꼬임)
    c.style.position = "fixed";
    c.style.inset = "0";
    c.style.width = "100vw";
    c.style.height = "100vh";
    c.style.zIndex = "999999";
    c.style.pointerEvents = "none";
    c.style.display = "block";
    return c;
  }

  // ----------------------------
  // 2) Size / DPR
  // ----------------------------
  function resizeCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
      return { w, h, dpr, changed: true };
    }
    return { w, h, dpr, changed: false };
  }

  // ----------------------------
  // 3) Input state (중요: 초기값 center로)
  // ----------------------------
  const input = {
    x: Math.max(0, Math.floor(window.innerWidth * 0.5)),
    y: Math.max(0, Math.floor(window.innerHeight * 0.5)),
    vx: 0, vy: 0,
    down: false,
    t: performance.now(),
    lastMoveAt: performance.now(),
  };

  function onPointerMove(e) {
    const now = performance.now();
    const dt = Math.max(1, now - input.t);
    const nx = e.clientX;
    const ny = e.clientY;
    input.vx = (nx - input.x) / dt;
    input.vy = (ny - input.y) / dt;
    input.x = nx;
    input.y = ny;
    input.t = now;
    input.lastMoveAt = now;
  }
  function onPointerDown() { input.down = true; }
  function onPointerUp() { input.down = false; }

  // 이벤트 바인딩을 window 뿐 아니라 document / top에도 (가능하면) 걸어버림
  const __boundTargets = new Set();
  function bindPointerEvents(target, label) {
    if (!target || __boundTargets.has(target)) return;
    __boundTargets.add(target);

    const opts = { passive: true, capture: true };
    try {
      target.addEventListener("pointermove", onPointerMove, opts);
      target.addEventListener("pointerdown", onPointerDown, opts);
      target.addEventListener("pointerup", onPointerUp, opts);
      target.addEventListener("pointercancel", onPointerUp, opts);
      console.log("[FX] bound pointer events:", label);
    } catch (e) {
      console.warn("[FX] bind failed:", label, e?.message || e);
    }
  }

  // ----------------------------
  // 4) Renderer interface
  // ----------------------------
  class Renderer {
    async init(_) {}
    resize(_) {}
    frame(_) {}
    destroy() {}
  }

  // ----------------------------
  // 5) FX Zones -> Text line rects
  // ----------------------------
  let fxZones = [];
  let rectCache = []; // [{x,y,w,h}] in CSS px (viewport space)
  let lastRectRefreshAt = 0;
  let pendingRefresh = false;

  function refreshFxZones() {
    fxZones = Array.from(document.querySelectorAll(FX_ZONE_SELECTOR));
  }

  function ensureDefaultZoneIfNone() {
    if (fxZones.length > 0) return;

    const root =
      document.querySelector(".super-content") ||
      document.querySelector(".notion-page-content") ||
      document.querySelector("main") ||
      document.body;

    if (root) {
      root.setAttribute("data-fx-zone", "");
      fxZones = [root];
      console.log("[FX] default zone applied:", root.tagName);
    } else {
      console.warn("[FX] no root found for default zone");
    }
  }

  function isElementVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) return false;
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    if (r.right < 0 || r.left > window.innerWidth) return false;
    return true;
  }

  function collectTextLineRectsFromZone(zoneEl, outRects) {
    const walker = document.createTreeWalker(zoneEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName?.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const range = document.createRange();
    let visited = 0;

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      visited++;
      if (visited > FX_MAX_TEXT_NODES) break;

      const pe = textNode.parentElement;
      if (!pe) continue;

      const pr = pe.getBoundingClientRect();
      if (pr.bottom < 0 || pr.top > window.innerHeight) continue;
      if (pr.right < 0 || pr.left > window.innerWidth) continue;

      range.selectNodeContents(textNode);
      const rects = range.getClientRects();

      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width < FX_MIN_RECT_W || r.height < FX_MIN_RECT_H) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        if (r.right < 0 || r.left > window.innerWidth) continue;

        outRects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        if (outRects.length >= FX_MAX_RECTS) return;
      }
      if (outRects.length >= FX_MAX_RECTS) return;
    }
  }

  function recomputeTextRectsNow() {
    const rects = [];
    for (const z of fxZones) {
      if (!isElementVisible(z)) continue;
      collectTextLineRectsFromZone(z, rects);
      if (rects.length >= FX_MAX_RECTS) break;
    }
    rectCache = rects;
    lastRectRefreshAt = performance.now();
  }

  function requestRectsRefresh() {
    const now = performance.now();
    if (now - lastRectRefreshAt < FX_RECTS_REFRESH_MS) {
      if (pendingRefresh) return;
      pendingRefresh = true;
      requestAnimationFrame(() => {
        pendingRefresh = false;
        recomputeTextRectsNow();
      });
      return;
    }
    recomputeTextRectsNow();
  }

  function getCachedTextRectsPx() {
    return rectCache;
  }

  // ----------------------------
  // 6) Interactive hover atten (옵션2)
  // ----------------------------
  function computeUiAtten() {
    const el = document.elementFromPoint(input.x, input.y);
    if (!el) return 1.0;
    const hit = el.closest?.(INTERACTIVE_SELECTOR);
    return hit ? FX_UI_ATTEN_INTERACTIVE : 1.0;
  }

  // ----------------------------
  // 7) WebGL2 Ink renderer
  // ----------------------------
  class WebGL2Renderer extends Renderer {
    constructor(canvas) {
      super();
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
      if (!this.gl) throw new Error("WebGL2 not available");

      this.start = performance.now();
      this.progUpdate = null;
      this.progPresent = null;
      this.uUpdate = {};
      this.uPresent = {};
      this.fbo = [null, null];
      this.tex = [null, null];
      this.cur = 0;
      this.vao = null;
      this.W = 0;
      this.H = 0;
      this._lastSample = null;
    }

    _compile(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || "shader compile error";
        gl.deleteShader(sh);
        throw new Error(log);
      }
      return sh;
    }

    _link(vsSrc, fsSrc) {
      const gl = this.gl;
      const vs = this._compile(gl.VERTEX_SHADER, vsSrc);
      const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p) || "program link error";
        gl.deleteProgram(p);
        throw new Error(log);
      }
      return p;
    }

    _createTex(w, h) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return t;
    }

    _createFboForTex(tex) {
      const gl = this.gl;
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) throw new Error("FBO incomplete");
      return f;
    }

    _ensurePingPong(w, h) {
      const gl = this.gl;
      if (this.W === w && this.H === h && this.tex[0] && this.tex[1]) return;

      for (let i = 0; i < 2; i++) {
        if (this.fbo[i]) gl.deleteFramebuffer(this.fbo[i]);
        if (this.tex[i]) gl.deleteTexture(this.tex[i]);
        this.fbo[i] = null;
        this.tex[i] = null;
      }

      this.W = w;
      this.H = h;
      this.tex[0] = this._createTex(w, h);
      this.tex[1] = this._createTex(w, h);
      this.fbo[0] = this._createFboForTex(this.tex[0]);
      this.fbo[1] = this._createFboForTex(this.tex[1]);

      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[i]);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur = 0;
    }

    async init() {
      const gl = this.gl;

      const vs = `#version 300 es
      precision highp float;
      out vec2 vUv;
      void main(){
        vec2 p = vec2(
          (gl_VertexID == 1) ? 3.0 : -1.0,
          (gl_VertexID == 2) ? 3.0 : -1.0
        );
        vec2 uv = 0.5 * (p + 1.0);
        vUv = vec2(uv.x, 1.0 - uv.y);
        gl_Position = vec4(p,0.0,1.0);
      }`;

      const fsUpdate = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 o;

      uniform sampler2D uPrev;
      uniform vec2 uRes;
      uniform vec2 uMouse;
      uniform vec2 uVel;
      uniform float uDown;
      uniform float uTime;

      uniform int uRectCount;
      uniform vec4 uRects[16];
      uniform float uFeather;
      uniform float uProxFar;
      uniform float uUiAtten;

      vec4 blur9(sampler2D t, vec2 uv, vec2 px){
        vec4 s=vec4(0.0);
        s+=texture(t, uv+px*vec2(-1,-1))*0.06;
        s+=texture(t, uv+px*vec2( 0,-1))*0.10;
        s+=texture(t, uv+px*vec2( 1,-1))*0.06;
        s+=texture(t, uv+px*vec2(-1, 0))*0.10;
        s+=texture(t, uv+px*vec2( 0, 0))*0.36;
        s+=texture(t, uv+px*vec2( 1, 0))*0.10;
        s+=texture(t, uv+px*vec2(-1, 1))*0.06;
        s+=texture(t, uv+px*vec2( 0, 1))*0.10;
        s+=texture(t, uv+px*vec2( 1, 1))*0.06;
        return s;
      }

      float sdBox(vec2 p, vec2 a, vec2 b){
        vec2 c=(a+b)*0.5;
        vec2 e=(b-a)*0.5;
        vec2 d=abs(p-c)-e;
        return length(max(d,0.0))+min(max(d.x,d.y),0.0);
      }

      float mouseProximity(vec2 mUv){
        float dmin=1e6;
        for(int i=0;i<16;i++){
          if(i>=uRectCount) break;
          vec4 r=uRects[i];
          float d=sdBox(mUv, r.xy, r.zw);
          dmin=min(dmin, max(d,0.0));
        }
        return 1.0 - smoothstep(0.0, uProxFar, dmin);
      }

      float soft(vec2 p, vec2 c, float r, float blur){
        float d=length(p-c);
        return 1.0 - smoothstep(r, r+blur, d);
      }

      void main(){
        vec2 px=1.0/uRes;

        vec2 adv=-uVel*0.6;
        vec4 prev=texture(uPrev, vUv+adv);
        vec4 diff=blur9(uPrev, vUv+adv, px);

        float decay=0.985;
        vec4 ink=mix(prev, diff, 0.65)*decay;

        float press=uDown;
        float speed=clamp(length(uVel)*120.0, 0.0, 1.0);

        float r=mix(0.018, 0.032, speed) + press*0.020;
        float a=soft(vUv, uMouse, r, r*1.8);
        float core=soft(vUv, uMouse, r*0.45, r*0.8);

        float deposit=(0.35+0.65*press)*a + (0.20+0.60*press)*core;

        float grain=0.02*sin((vUv.x+vUv.y)*160.0 + uTime*3.0);
        deposit *= (1.0+grain);

        float prox = (uRectCount>0) ? mouseProximity(uMouse) : 1.0;
        deposit *= prox;

        deposit *= uUiAtten;

        ink.a = clamp(ink.a + deposit, 0.0, 1.0);
        o = vec4(0.0, 0.0, 0.0, ink.a);
      }`;

      const fsPresent = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 o;

      uniform sampler2D uTex;
      uniform float uUiAtten;

      void main(){
        vec4 ink=texture(uTex, vUv);
        float a=pow(clamp(ink.a,0.0,1.0), 1.35);

        float fiber=0.02*sin((vUv.x*900.0)+(vUv.y*700.0));
        a *= (1.0+fiber);

        a *= uUiAtten;

        float strength=0.32;
        o = vec4(0.0,0.0,0.0, a*strength);
      }`;

      this.progUpdate = this._link(vs, fsUpdate);
      this.progPresent = this._link(vs, fsPresent);

      gl.useProgram(this.progUpdate);
      this.uUpdate.uPrev = gl.getUniformLocation(this.progUpdate, "uPrev");
      this.uUpdate.uRes = gl.getUniformLocation(this.progUpdate, "uRes");
      this.uUpdate.uMouse = gl.getUniformLocation(this.progUpdate, "uMouse");
      this.uUpdate.uVel = gl.getUniformLocation(this.progUpdate, "uVel");
      this.uUpdate.uDown = gl.getUniformLocation(this.progUpdate, "uDown");
      this.uUpdate.uTime = gl.getUniformLocation(this.progUpdate, "uTime");
      this.uUpdate.uRectCount = gl.getUniformLocation(this.progUpdate, "uRectCount");
      this.uUpdate.uRects = gl.getUniformLocation(this.progUpdate, "uRects[0]");
      this.uUpdate.uFeather = gl.getUniformLocation(this.progUpdate, "uFeather");
      this.uUpdate.uProxFar = gl.getUniformLocation(this.progUpdate, "uProxFar");
      this.uUpdate.uUiAtten = gl.getUniformLocation(this.progUpdate, "uUiAtten");

      gl.useProgram(this.progPresent);
      this.uPresent.uTex = gl.getUniformLocation(this.progPresent, "uTex");
      this.uPresent.uUiAtten = gl.getUniformLocation(this.progPresent, "uUiAtten");

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindVertexArray(null);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    resize({ w, h }) {
      this._ensurePingPong(w, h);
      this.gl.viewport(0, 0, w, h);
    }

    frame({ w, h, dpr, input }) {
      const gl = this.gl;
      this._ensurePingPong(w, h);

      const rectsPx = getCachedTextRectsPx();
      const rectData = new Float32Array(FX_MAX_RECTS * 4);
      let rc = 0;

      for (const r of rectsPx) {
        const x0 = (r.x * dpr) / w;
        const y0 = (r.y * dpr) / h;
        const x1 = ((r.x + r.w) * dpr) / w;
        const y1 = ((r.y + r.h) * dpr) / h;
        rectData[rc * 4 + 0] = x0;
        rectData[rc * 4 + 1] = y0;
        rectData[rc * 4 + 2] = x1;
        rectData[rc * 4 + 3] = y1;
        rc++;
        if (rc >= FX_MAX_RECTS) break;
      }

      const t = (performance.now() - this.start) / 1000;
      const mx = (input.x * dpr) / w;
      const my = (input.y * dpr) / h;
      const velx = (input.vx * dpr) / w;
      const vely = (input.vy * dpr) / h;
      const uiAtten = computeUiAtten();
      const proxFarUv = (FX_PROX_FAR_PX * dpr) / Math.min(w, h);

      const prevIdx = this.cur;
      const nextIdx = 1 - this.cur;

      gl.bindVertexArray(this.vao);

      // UPDATE
      gl.useProgram(this.progUpdate);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[nextIdx]);
      gl.viewport(0, 0, w, h);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[prevIdx]);
      gl.uniform1i(this.uUpdate.uPrev, 0);

      gl.uniform2f(this.uUpdate.uRes, w, h);
      gl.uniform2f(this.uUpdate.uMouse, mx, my);
      gl.uniform2f(this.uUpdate.uVel, velx, vely);
      gl.uniform1f(this.uUpdate.uDown, input.down ? 1 : 0);
      gl.uniform1f(this.uUpdate.uTime, t);

      gl.uniform1i(this.uUpdate.uRectCount, rc);
      gl.uniform4fv(this.uUpdate.uRects, rectData);
      gl.uniform1f(this.uUpdate.uFeather, (14 * dpr) / Math.min(w, h));

      gl.uniform1f(this.uUpdate.uProxFar, proxFarUv);
      gl.uniform1f(this.uUpdate.uUiAtten, uiAtten);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = nextIdx;

      // PRESENT
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);

      gl.useProgram(this.progPresent);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.uniform1i(this.uPresent.uTex, 0);
      gl.uniform1f(this.uPresent.uUiAtten, uiAtten);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    sampleCenterRGBA() {
      const gl = this.gl;
      const px = new Uint8Array(4);
      const x = Math.floor(this.W * 0.5);
      const y = Math.floor(this.H * 0.5);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      this._lastSample = { R: px[0], G: px[1], B: px[2], A: px[3], at: performance.now() };
      return this._lastSample;
    }
  }

  // ----------------------------
  // 8) Boot
  // ----------------------------
  let __booted = false;
  let __renderer = null;
  let __canvas = null;

  async function boot() {
    if (__booted) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    __canvas = ensureCanvas();
    const size = resizeCanvas(__canvas);

    refreshFxZones();
    ensureDefaultZoneIfNone();
    requestRectsRefresh();

    // 핵심: 이벤트를 여러 컨텍스트에 걸어버림
    bindPointerEvents(window, "window");
    bindPointerEvents(document, "document");
    try { bindPointerEvents(window.top, "window.top"); } catch(_) {}

    try {
      __renderer = new WebGL2Renderer(__canvas);
      await __renderer.init();
      __renderer.resize(size);
      __booted = true;
      console.log("[FX] WebGL2 ink enabled (inkfix6)");
    } catch (e) {
      console.warn("[FX] WebGL2 failed. FX disabled:", e?.message || e);
      return;
    }

    window.addEventListener("resize", () => {
      const s = resizeCanvas(__canvas);
      __renderer.resize(s);
      requestRectsRefresh();
    }, { passive: true });

    window.addEventListener("scroll", () => requestRectsRefresh(), { passive: true });

    const mo = new MutationObserver(() => {
      refreshFxZones();
      ensureDefaultZoneIfNone();
      requestRectsRefresh();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    let alive = true;
    const tick = () => {
      if (!alive) return;

      // detach protection
      if (!document.getElementById(ID)) document.body.appendChild(__canvas);

      // “이벤트 안 들어오면” 감지: input이 얼어붙으면 top/doc 바인딩 재시도
      if (performance.now() - input.lastMoveAt > 1200) {
        bindPointerEvents(window, "window(rebind)");
        bindPointerEvents(document, "document(rebind)");
        try { bindPointerEvents(window.top, "window.top(rebind)"); } catch(_) {}
      }

      const s = resizeCanvas(__canvas);
      if (s.changed) {
        __renderer.resize(s);
        requestRectsRefresh();
      }
      __renderer.frame({ ...s, input });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // 전역 API (선배가 원한 status 포함)
    window.__FX_OVERLAY__ = {
      stop() {
        alive = false;
        mo.disconnect();
      },
      status() {
        return {
          booted: __booted,
          hasCanvas: !!document.getElementById(ID),
          zones: document.querySelectorAll(FX_ZONE_SELECTOR).length,
          rects: rectCache.length,
          input: { x: input.x, y: input.y, down: input.down, lastMoveAgoMs: Math.round(performance.now() - input.lastMoveAt) },
        };
      },
      sample() {
        if (!__renderer) return null;
        return __renderer.sampleCenterRGBA();
      }
    };
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
})();
