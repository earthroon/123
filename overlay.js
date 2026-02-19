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
  const FX_PROX_FAR_PX = 260;

  // 0.35면 “있긴 한데 거의 티 안 남”
  const FX_UI_ATTEN_INTERACTIVE = 0.35;

  const INTERACTIVE_SELECTOR = [
    "a",
    "button",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[role='link']",
    "[contenteditable='true']"
  ].join(",");

  // ----------------------------
  // 0) Hard CSS injection (super가 link/css 살균하는 케이스 대비)
  // ----------------------------
  function ensureInlineStyle() {
    const sid = "fx-overlay-style-inline";
    if (document.getElementById(sid)) return;
    const st = document.createElement("style");
    st.id = sid;
    st.textContent = `
#${ID}{
  position:fixed; inset:0; width:100vw; height:100vh;
  z-index:2147483647; pointer-events:none;
  display:block!important; opacity:1!important; visibility:visible!important;
  mix-blend-mode:normal;
}
@media (prefers-reduced-motion: reduce){ #${ID}{ display:none!important; } }
`;
    document.head.appendChild(st);
  }

  // ----------------------------
  // 1) Canvas singleton
  // ----------------------------
  function ensureCanvas() {
    let c = document.getElementById(ID);
    if (!c) {
      c = document.createElement("canvas");
      c.id = ID;
      document.body.appendChild(c);
    }
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
  // 3) Input state (SSOT)
  // ----------------------------
  const input = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    down: false,
    t: performance.now(),
    // debug counters
    _moves: 0,
    _downs: 0,
    _ups: 0,
    _lastEvt: "",
  };

  function applyMove(nx, ny, evtName="") {
    const now = performance.now();
    const dt = Math.max(1, now - input.t);
    input.vx = (nx - input.x) / dt;
    input.vy = (ny - input.y) / dt;
    input.x = nx;
    input.y = ny;
    input.t = now;
    input._moves++;
    input._lastEvt = evtName;
  }

  // ✅ “window만”이 아니라 “documentElement 캡처”까지 같이 묶는다
  function armInputListeners() {
    const opts = { passive: true, capture: true };

    const move = (e) => {
      const nx = (e && typeof e.clientX === "number") ? e.clientX : input.x;
      const ny = (e && typeof e.clientY === "number") ? e.clientY : input.y;
      applyMove(nx, ny, e?.type || "move");
      requestRectsRefresh();
    };

    const down = (e) => {
      input.down = true;
      input._downs++;
      move(e);
    };

    const up = (e) => {
      input.down = false;
      input._ups++;
      move(e);
    };

    // pointer 계열
    window.addEventListener("pointermove", move, opts);
    window.addEventListener("pointerdown", down, opts);
    window.addEventListener("pointerup", up, opts);

    // mouse 계열 (pointer가 먹혀도 mouse는 살아있는 경우가 많음)
    window.addEventListener("mousemove", move, opts);
    window.addEventListener("mousedown", down, opts);
    window.addEventListener("mouseup", up, opts);

    // ✅ 핵심: Super/Notion이 window까지 못 올리는 케이스 대비
    const de = document.documentElement;
    if (de) {
      de.addEventListener("pointermove", move, opts);
      de.addEventListener("pointerdown", down, opts);
      de.addEventListener("pointerup", up, opts);
      de.addEventListener("mousemove", move, opts);
      de.addEventListener("mousedown", down, opts);
      de.addEventListener("mouseup", up, opts);
    }

    return () => {
      window.removeEventListener("pointermove", move, opts);
      window.removeEventListener("pointerdown", down, opts);
      window.removeEventListener("pointerup", up, opts);
      window.removeEventListener("mousemove", move, opts);
      window.removeEventListener("mousedown", down, opts);
      window.removeEventListener("mouseup", up, opts);
      if (de) {
        de.removeEventListener("pointermove", move, opts);
        de.removeEventListener("pointerdown", down, opts);
        de.removeEventListener("pointerup", up, opts);
        de.removeEventListener("mousemove", move, opts);
        de.removeEventListener("mousedown", down, opts);
        de.removeEventListener("mouseup", up, opts);
      }
    };
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
      console.log("[FX] default zone applied:", root);
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
  // 6) Interactive hover atten
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
      void main() {
        vec2 p = vec2(
          (gl_VertexID == 1) ? 3.0 : -1.0,
          (gl_VertexID == 2) ? 3.0 : -1.0
        );
        vec2 uv = 0.5 * (p + 1.0);
        vUv = vec2(uv.x, 1.0 - uv.y); // top-left origin
        gl_Position = vec4(p, 0.0, 1.0);
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

      vec4 blur9(sampler2D t, vec2 uv, vec2 px) {
        vec4 s = vec4(0.0);
        s += texture(t, uv + px * vec2(-1.0,-1.0)) * 0.06;
        s += texture(t, uv + px * vec2( 0.0,-1.0)) * 0.10;
        s += texture(t, uv + px * vec2( 1.0,-1.0)) * 0.06;
        s += texture(t, uv + px * vec2(-1.0, 0.0)) * 0.10;
        s += texture(t, uv + px * vec2( 0.0, 0.0)) * 0.36;
        s += texture(t, uv + px * vec2( 1.0, 0.0)) * 0.10;
        s += texture(t, uv + px * vec2(-1.0, 1.0)) * 0.06;
        s += texture(t, uv + px * vec2( 0.0, 1.0)) * 0.10;
        s += texture(t, uv + px * vec2( 1.0, 1.0)) * 0.06;
        return s;
      }

      float sdBox(vec2 p, vec2 a, vec2 b) {
        vec2 c = (a + b) * 0.5;
        vec2 e = (b - a) * 0.5;
        vec2 d = abs(p - c) - e;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      }

      float mouseProximity(vec2 mUv) {
        if (uRectCount <= 0) return 1.0; // ✅ fallback
        float dmin = 1e6;
        for (int i=0;i<16;i++){
          if (i>=uRectCount) break;
          vec4 r = uRects[i];
          float d = sdBox(mUv, r.xy, r.zw);
          dmin = min(dmin, max(d,0.0));
        }
        return 1.0 - smoothstep(0.0, uProxFar, dmin);
      }

      float soft(vec2 p, vec2 c, float r, float blur) {
        float d = length(p - c);
        return 1.0 - smoothstep(r, r + blur, d);
      }

      void main() {
        vec2 px = 1.0 / uRes;

        // flow/blur from prev
        vec2 adv = -uVel * 0.6;
        vec4 prev = texture(uPrev, vUv + adv);
        vec4 diff = blur9(uPrev, vUv + adv, px);

        float decay = 0.985;
        vec4 ink = mix(prev, diff, 0.65) * decay;

        // ✅ down이 안 들어와도 move로 쌓이게 기본 deposit을 더 “move-friendly”로 조정
        float press = uDown;
        float speed = clamp(length(uVel) * 120.0, 0.0, 1.0);

        float r = mix(0.018, 0.032, speed) + press * 0.020;
        float a = soft(vUv, uMouse, r, r * 1.8);
        float core = soft(vUv, uMouse, r * 0.45, r * 0.8);

        float depositMove = 0.55 * a + 0.30 * core;        // move만으로도 충분히
        float depositDown = (0.25 * a + 0.40 * core) * press;
        float deposit = depositMove + depositDown;

        // grain
        float grain = 0.02 * sin((vUv.x + vUv.y) * 160.0 + uTime * 3.0);
        deposit *= (1.0 + grain);

        // proximity gate
        float prox = mouseProximity(uMouse);
        deposit *= prox;

        // interactive atten
        deposit *= uUiAtten;

        ink.a = clamp(ink.a + deposit, 0.0, 1.0);
        o = vec4(0.0, 0.0, 0.0, ink.a);
      }`;

      const fsPresent = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 o;

      uniform sampler2D uTex;
      uniform int uRectCount;
      uniform vec4 uRects[16];
      uniform float uFeather;
      uniform float uUiAtten;

      float sdBox(vec2 p, vec2 a, vec2 b) {
        vec2 c = (a + b) * 0.5;
        vec2 e = (b - a) * 0.5;
        vec2 d = abs(p - c) - e;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      }

      float inZones(vec2 uv) {
        if (uRectCount <= 0) return 1.0; // ✅ fallback
        float m = 0.0;
        for (int i=0;i<16;i++){
          if (i>=uRectCount) break;
          vec4 r = uRects[i];
          float d = sdBox(uv, r.xy, r.zw);
          float inside = 1.0 - smoothstep(0.0, uFeather, d);
          m = max(m, inside);
        }
        return m;
      }

      void main() {
        vec4 ink = texture(uTex, vUv);
        float a = pow(clamp(ink.a, 0.0, 1.0), 1.35);

        float zone = inZones(vUv);
        a *= zone;

        float fiber = 0.02 * sin((vUv.x * 900.0) + (vUv.y * 700.0));
        a *= (1.0 + fiber);

        a *= uUiAtten;

        float strength = 0.32;
        o = vec4(0.0, 0.0, 0.0, a * strength);
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
      this.uPresent.uRectCount = gl.getUniformLocation(this.progPresent, "uRectCount");
      this.uPresent.uRects = gl.getUniformLocation(this.progPresent, "uRects[0]");
      this.uPresent.uFeather = gl.getUniformLocation(this.progPresent, "uFeather");
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
        rectData[rc*4+0]=x0; rectData[rc*4+1]=y0; rectData[rc*4+2]=x1; rectData[rc*4+3]=y1;
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

      gl.uniform1i(this.uPresent.uRectCount, rc);
      gl.uniform4fv(this.uPresent.uRects, rectData);
      gl.uniform1f(this.uPresent.uFeather, (14 * dpr) / Math.min(w, h));
      gl.uniform1f(this.uPresent.uUiAtten, uiAtten);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindVertexArray(null);
    }

    destroy() {
      const gl = this.gl;
      if (!gl) return;

      if (this.vao) gl.deleteVertexArray(this.vao);
      this.vao = null;

      for (let i = 0; i < 2; i++) {
        if (this.fbo[i]) gl.deleteFramebuffer(this.fbo[i]);
        if (this.tex[i]) gl.deleteTexture(this.tex[i]);
        this.fbo[i] = null;
        this.tex[i] = null;
      }

      if (this.progUpdate) gl.deleteProgram(this.progUpdate);
      if (this.progPresent) gl.deleteProgram(this.progPresent);
      this.progUpdate = null;
      this.progPresent = null;
    }
  }

  // ----------------------------
  // 8) Boot
  // ----------------------------
  async function boot() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    ensureInlineStyle();

    const canvas = ensureCanvas();
    const size = resizeCanvas(canvas);

    refreshFxZones();
    ensureDefaultZoneIfNone();
    requestRectsRefresh();

    let renderer = null;
    try {
      renderer = new WebGL2Renderer(canvas);
      await renderer.init();
      console.log("[FX] WebGL2 ink enabled (patched input capture + move-friendly deposit)");
    } catch (e) {
      console.warn("[FX] WebGL2 failed. FX disabled:", e?.message || e);
      return;
    }

    // ✅ 입력 리스너 하드 아밍
    const unarm = armInputListeners();

    window.addEventListener("resize", () => {
      const s = resizeCanvas(canvas);
      renderer.resize(s);
      requestRectsRefresh();
    }, { passive: true });

    window.addEventListener("scroll", () => requestRectsRefresh(), { passive: true });

    const mo = new MutationObserver(() => {
      refreshFxZones();
      ensureDefaultZoneIfNone();
      requestRectsRefresh();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    renderer.resize(size);

    let alive = true;
    const tick = () => {
      if (!alive) return;
      if (!document.getElementById(ID)) document.body.appendChild(canvas);

      const s = resizeCanvas(canvas);
      if (s.changed) {
        renderer.resize(s);
        requestRectsRefresh();
      }
      renderer.frame({ ...s, input });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // ✅ status() 기본 내장: input 좌표/이벤트 카운트까지 바로 확인 가능
    window.__FX_OVERLAY__ = {
      stop() {
        alive = false;
        mo.disconnect();
        unarm?.();
        renderer.destroy();
      },
      status() {
        const c = document.getElementById(ID);
        const gl = c?.getContext?.("webgl2");
        const zones = document.querySelectorAll(FX_ZONE_SELECTOR).length;
        return {
          booted: !!c,
          inDOM: !!c && document.body.contains(c),
          hasGL: !!gl,
          zones,
          input: {
            x: input.x, y: input.y,
            down: input.down,
            moves: input._moves,
            downs: input._downs,
            ups: input._ups,
            lastEvt: input._lastEvt,
            vx: +input.vx.toFixed(3),
            vy: +input.vy.toFixed(3),
          },
          canvas: c ? {
            parent: c.parentElement?.tagName || "?",
            display: getComputedStyle(c).display,
            zIndex: getComputedStyle(c).zIndex,
            pe: getComputedStyle(c).pointerEvents,
            size: [c.width, c.height],
          } : null
        };
      }
    };
  }

  // Hard stop previous instance if any
  try { window.__FX_OVERLAY__?.stop?.(); } catch(e) {}

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
})();
