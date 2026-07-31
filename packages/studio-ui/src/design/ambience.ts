/**
 * The stage ambience.
 *
 * The area around a composition used to be flat black, which made every dark first frame
 * indistinguishable from a broken one. This replaces it with a slow, domain-warped aurora that
 * is always alive — so "the studio is working" is legible before a single pixel of the
 * composition arrives.
 *
 * It is also a status display. Energy, hue and progress are driven by real Studio state:
 *
 *   idle       calm, cool, barely moving
 *   playing    warmer and faster, drifting with the playhead
 *   rendering  amber, pulsing, with a progress sweep across the field
 *   error      desaturated and pushed red
 *
 * Cost control matters more than the effect: it renders at a fraction of device resolution,
 * throttles to a target frame interval that depends on how energetic it currently is, and stops
 * completely when the tab is hidden, the element scrolls out of view, or motion is turned off.
 */

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float uTime;
uniform vec2  uResolution;
/** 0 = resting, 1 = fully energized. Drives amplitude, speed and saturation. */
uniform float uEnergy;
/** Palette rotation in turns. Playback walks this with the playhead. */
uniform float uHue;
/** 0–1 render progress; negative disables the sweep. */
uniform float uProgress;
/** 0 = normal, 1 = fault state. */
uniform float uFault;

// -- value noise + fbm ------------------------------------------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // quintic interpolant — smoother derivatives than smoothstep, no banding in the gradients
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amplitude *= 0.5;
  }
  return value;
}

// The Studio's own tokens: panel blue for the base, amber accent and violet for the ribbons.
const vec3 BASE_LOW  = vec3(0.031, 0.036, 0.051);
const vec3 BASE_HIGH = vec3(0.094, 0.090, 0.165);
const vec3 AMBER     = vec3(0.941, 0.706, 0.373);
const vec3 VIOLET    = vec3(0.616, 0.565, 1.000);
const vec3 TEAL      = vec3(0.400, 0.812, 0.855);

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float speed = 0.014 + uEnergy * 0.055;
  float t = uTime * speed;

  // Domain warping: sample the field through two offset copies of itself. This is what turns
  // plain fbm into something that reads as flowing rather than static cloud.
  vec2 q = vec2(fbm(p * 1.7 + vec2(0.0, t)), fbm(p * 1.7 + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(
    fbm(p * 2.1 + 3.4 * q + vec2(1.7, 9.2) + t * 0.7),
    fbm(p * 2.1 + 3.4 * q + vec2(8.3, 2.8) - t * 0.5)
  );
  float field = fbm(p * 2.4 + 3.1 * r);

  // Two ribbons cut out of the same warped field at different thresholds. Thresholding rather
  // than shading the field directly is what makes the aurora read as distinct bands of light
  // instead of an evenly grey cloud — the earlier version was mathematically correct and
  // visually invisible, because a mid-grey fbm times a small lift is just black.
  float ribbonA = pow(smoothstep(0.36, 0.80, field), 1.5);
  float ribbonB = pow(smoothstep(0.52, 0.98, fbm(p * 2.9 - 2.0 * q + vec2(4.1, 0.0) + t * 1.3)), 2.0);

  vec3 color = mix(BASE_LOW, BASE_HIGH, smoothstep(0.15, 0.9, field));

  // uHue rotates which pigment leads. Playback walks it, so a playing composition drifts through
  // the palette instead of sitting on one colour.
  float turn = fract(uHue);
  vec3 leadA = mix(VIOLET, TEAL, smoothstep(0.0, 0.5, turn));
  vec3 leadB = mix(AMBER, VIOLET, smoothstep(0.35, 1.0, turn));

  color += leadA * ribbonA * (0.30 + uEnergy * 0.42);
  color += leadB * ribbonB * (0.16 + uEnergy * 0.34);

  // A soft pool of light behind where the composition frame sits, so the frame reads as resting
  // on a surface rather than floating in a void.
  float pool = 1.0 - smoothstep(0.0, 0.9, length(p * vec2(0.72, 1.15)));
  color += mix(BASE_HIGH, leadB, 0.5) * pool * (0.30 + uEnergy * 0.34);

  // Render progress sweeps a band of light left to right across the whole field.
  if (uProgress >= 0.0) {
    float band = 1.0 - smoothstep(0.0, 0.13, abs(uv.x - uProgress));
    color += vec3(0.941, 0.706, 0.373) * band * 0.16;
    // Everything the sweep has already passed stays gently warmer.
    color += vec3(0.941, 0.706, 0.373) * step(uv.x, uProgress) * 0.028;
  }

  // Fault: pull the whole field toward a desaturated red rather than flashing an alarm colour.
  if (uFault > 0.0) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, mix(vec3(luma), vec3(0.55, 0.16, 0.16) * (0.4 + luma), 0.62), uFault);
  }

  // Vignette keeps the eye on the composition.
  color *= 1.0 - 0.42 * smoothstep(0.42, 1.15, length(p));

  // Per-frame grain. Without it the gradients band visibly on wide dark panels.
  float grain = hash(uv * uResolution + fract(uTime) * 137.0) - 0.5;
  color += grain * 0.016;

  fragColor = vec4(max(color, vec3(0.0)), 1.0);
}`;

export type AmbienceState = {
  /** 0–1. How lively the field is. */
  energy: number;
  /** Palette rotation in turns; wraps freely. */
  hue: number;
  /** 0–1 render progress, or null for no sweep. */
  progress: number | null;
  /** 0–1 fault blend. */
  fault: number;
};

const RESTING: AmbienceState = { energy: 0, hue: 0, progress: null, fault: 0 };

/** Device pixels are expensive and this is a blurred field; half resolution is invisible here. */
const RESOLUTION_SCALE = 0.5;
const MAX_DIMENSION = 900;

export class StageAmbience {
  readonly #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext | null = null;
  #program: WebGLProgram | null = null;
  #uniforms: Record<string, WebGLUniformLocation | null> = {};
  #frame = 0;
  #startedAt = 0;
  #lastDrawAt = 0;
  #running = false;
  #visible = true;
  #hasDrawn = false;
  #target: AmbienceState = { ...RESTING };
  #current: AmbienceState = { ...RESTING };
  #observer: IntersectionObserver | null = null;
  #onVisibilityChange: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  /** @returns whether a GPU context was obtained; callers fall back to CSS when false. */
  start(): boolean {
    if (this.#gl) return true;
    const gl = this.#canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      // The field is redrawn every frame it is visible; preserving it costs bandwidth for nothing.
      preserveDrawingBuffer: false,
    });
    if (!gl) return false;

    const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) return false;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);
    this.#gl = gl;
    this.#program = program;
    for (const name of ["uTime", "uResolution", "uEnergy", "uHue", "uProgress", "uFault"]) {
      this.#uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.#startedAt = performance.now();
    this.#observeVisibility();
    this.#running = true;
    // Paint one frame synchronously. Hidden and background tabs pause rAF entirely, and a
    // *static but correct* field is still infinitely better than the black void this replaces —
    // so the stage is never empty, even on a tab the user has not looked at yet.
    this.#draw(this.#startedAt);
    this.#frame = requestAnimationFrame(this.#tick);
    return true;
  }

  /** Ease toward a new state. Nothing here ever snaps. */
  setState(state: Partial<AmbienceState>): void {
    this.#target = { ...this.#target, ...state };
    if (!this.#running || this.#frame) return;
    // A resting field is throttled hard, so a state change needs an explicit nudge to be seen.
    if (this.#canAnimate()) this.#frame = requestAnimationFrame(this.#tick);
    // With no animation loop available, keep the still frame truthful about the new state.
    else this.#draw(performance.now());
  }

  stop(): void {
    this.#running = false;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  dispose(): void {
    this.stop();
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.#onVisibilityChange && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    }
    this.#onVisibilityChange = null;
    const gl = this.#gl;
    if (gl && this.#program) gl.deleteProgram(this.#program);
    // Free the GPU context eagerly; a studio can mount and unmount many stages in a session.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.#gl = null;
    this.#program = null;
  }

  /** Whether it is worth scheduling frames: on screen, and in a tab the user is looking at. */
  #canAnimate(): boolean {
    if (!this.#visible) return false;
    return typeof document === "undefined" || !document.hidden;
  }

  #observeVisibility(): void {
    if (typeof document !== "undefined") {
      // `#visible` tracks intersection only. Folding document.hidden into it used to latch the
      // field off permanently: once hidden set it false, returning to the tab could not set it
      // back, because the intersection never changed and so the observer never fired again.
      this.#onVisibilityChange = () => {
        if (this.#running && !this.#frame && this.#canAnimate()) this.#frame = requestAnimationFrame(this.#tick);
      };
      document.addEventListener("visibilitychange", this.#onVisibilityChange);
    }
    if (typeof IntersectionObserver === "undefined") return;
    this.#observer = new IntersectionObserver((entries) => {
      this.#visible = entries.some((entry) => entry.isIntersecting);
      if (this.#running && !this.#frame && this.#canAnimate()) this.#frame = requestAnimationFrame(this.#tick);
    });
    this.#observer.observe(this.#canvas);
  }

  #resize(): void {
    const gl = this.#gl;
    if (!gl) return;
    const rect = this.#canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const scale = Math.min(
      RESOLUTION_SCALE * dpr,
      MAX_DIMENSION / Math.max(rect.width, rect.height),
    );
    const width = Math.max(2, Math.round(rect.width * scale));
    const height = Math.max(2, Math.round(rect.height * scale));
    if (this.#canvas.width === width && this.#canvas.height === height) return;
    this.#canvas.width = width;
    this.#canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  readonly #tick = (now: number): void => {
    this.#frame = 0;
    if (!this.#running || !this.#gl) return;
    // Nothing to draw, and nothing scheduled: the visibility handlers restart the loop.
    if (!this.#canAnimate()) return;

    // Idle fields do not need 60fps. Energy buys frame rate.
    const interval = 1000 / (18 + this.#current.energy * 42);
    if (now - this.#lastDrawAt >= interval) this.#draw(now);

    this.#frame = requestAnimationFrame(this.#tick);
  };

  #draw(now: number): void {
    const gl = this.#gl;
    if (!gl) return;
    this.#lastDrawAt = now;
    this.#advance();
    this.#resize();

    const seconds = (now - this.#startedAt) / 1000;
    gl.uniform1f(this.#uniforms.uTime ?? null, seconds);
    gl.uniform2f(this.#uniforms.uResolution ?? null, this.#canvas.width, this.#canvas.height);
    gl.uniform1f(this.#uniforms.uEnergy ?? null, this.#current.energy);
    gl.uniform1f(this.#uniforms.uHue ?? null, this.#current.hue);
    gl.uniform1f(this.#uniforms.uProgress ?? null, this.#current.progress ?? -1);
    gl.uniform1f(this.#uniforms.uFault ?? null, this.#current.fault);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Critically-damped-ish approach toward the target, per drawn frame. */
  #advance(): void {
    // The first frame has nothing to ease from — and on a tab where rAF never runs it is the
    // only frame — so it lands on the requested state exactly.
    if (!this.#hasDrawn) {
      this.#hasDrawn = true;
      this.#current = { ...this.#target };
      return;
    }
    const ease = 0.08;
    this.#current.energy += (this.#target.energy - this.#current.energy) * ease;
    this.#current.fault += (this.#target.fault - this.#current.fault) * ease;
    // Hue is a rotation, so it chases the target the short way around the circle.
    const hueDelta = ((this.#target.hue - this.#current.hue + 0.5) % 1 + 1) % 1 - 0.5;
    this.#current.hue = (this.#current.hue + hueDelta * ease + 1) % 1;
    if (this.#target.progress == null) this.#current.progress = null;
    else this.#current.progress = this.#current.progress == null
      ? this.#target.progress
      : this.#current.progress + (this.#target.progress - this.#current.progress) * 0.16;
  }
}

function linkProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
