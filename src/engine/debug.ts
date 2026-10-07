/** Frame timing for the debug overlay: FPS and how each frame's time is spent. */

export interface FrameSample {
  /** Time since the previous frame. */
  frameMs: number;
  /** Simulation (all math: fixed steps incl. scripts). */
  simMs: number;
  /** Part of simMs spent inside actor scripts. */
  scriptMs: number;
  renderMs: number;
  /** Fixed simulation steps run this frame. */
  steps: number;
}

export interface FrameSummary {
  fps: number;
  frameMs: number;
  simMs: number;
  scriptMs: number;
  renderMs: number;
  /** Shares of the frame interval, 0..100. */
  simPct: number;
  scriptPct: number;
  renderPct: number;
  idlePct: number;
  steps: number;
}

export interface DebugCounts {
  actors: number;
  projectiles: number;
  particles: number;
}

const WINDOW = 120;
const BUDGET_MS = 1000 / 60;
const MAX_FRAME_MS = 250;

export class FrameStats {
  private samples: FrameSample[] = [];

  add(s: FrameSample): void {
    // A long gap (hidden tab, breakpoint) is a pause, not a frame: don't let it skew the averages.
    if (s.frameMs > MAX_FRAME_MS) return;
    this.samples.push(s);
    if (this.samples.length > WINDOW) this.samples.shift();
  }

  /** Averages over the last half second. */
  summary(): FrameSummary {
    const recent: FrameSample[] = [];
    let total = 0;
    for (let i = this.samples.length - 1; i >= 0 && total < 500; i--) {
      recent.push(this.samples[i]);
      total += this.samples[i].frameMs;
    }
    const n = recent.length || 1;
    const avg = (k: keyof FrameSample) => recent.reduce((a, s) => a + s[k], 0) / n;
    const frameMs = avg('frameMs');
    const simMs = avg('simMs');
    const scriptMs = avg('scriptMs');
    const renderMs = avg('renderMs');
    const pct = (v: number) => (frameMs > 0 ? Math.min(100, (v / frameMs) * 100) : 0);
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      simMs,
      scriptMs,
      renderMs,
      simPct: pct(simMs),
      scriptPct: pct(scriptMs),
      renderPct: pct(renderMs),
      idlePct: Math.max(0, 100 - pct(simMs) - pct(renderMs)),
      steps: avg('steps'),
    };
  }

  /** Draws the overlay in screen space (call after the scene is drawn). */
  draw(ctx: CanvasRenderingContext2D, dpr: number, width: number, counts?: DebugCounts): void {
    const s = this.summary();
    const lines: Array<[string, string]> = [
      [`${s.fps.toFixed(0)} FPS   ${s.frameMs.toFixed(1)} ms`, s.fps >= 55 ? '#9be3aa' : s.fps >= 30 ? '#ffd166' : '#ff8f86'],
      [`sim     ${s.simMs.toFixed(2)} ms  ${s.simPct.toFixed(1)}%`, '#ffb347'],
      [`  scripts ${s.scriptMs.toFixed(2)} ms  ${s.scriptPct.toFixed(1)}%`, '#e0a060'],
      [`render  ${s.renderMs.toFixed(2)} ms  ${s.renderPct.toFixed(1)}%`, '#82aaff'],
      [`idle    ${s.idlePct.toFixed(1)}%   steps/frame ${s.steps.toFixed(2)}`, '#aab3c2'],
    ];
    if (counts) lines.push([`actors ${counts.actors}  proj ${counts.projectiles}  fx ${counts.particles}`, '#aab3c2']);

    const w = 236;
    const graphH = 40;
    const lh = 15;
    const h = lines.length * lh + graphH + 20;
    const x = width - w - 10;
    const y = 10;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(12,14,18,0.82)';
    ctx.fillRect(x, y, w, h);
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    lines.forEach(([t, c], i) => {
      ctx.fillStyle = c;
      ctx.fillText(t, x + 8, y + 16 + i * lh);
    });

    // Stacked bars per frame: sim (orange) + render (blue) against the frame time (grey); line = 60 fps budget.
    const gx = x + 8;
    const gy = y + h - graphH - 6;
    const gw = w - 16;
    const scaleMs = Math.max(BUDGET_MS * 2, ...this.samples.map((f) => f.frameMs));
    const bw = gw / WINDOW;
    const hOf = (ms: number) => (Math.min(ms, scaleMs) / scaleMs) * graphH;
    this.samples.forEach((f, i) => {
      const bx = gx + (WINDOW - this.samples.length + i) * bw;
      ctx.fillStyle = 'rgba(170,179,194,0.25)';
      ctx.fillRect(bx, gy + graphH - hOf(f.frameMs), Math.max(1, bw - 0.5), hOf(f.frameMs));
      const hs = hOf(f.simMs);
      const hr = hOf(f.renderMs);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(bx, gy + graphH - hs, Math.max(1, bw - 0.5), hs);
      ctx.fillStyle = '#82aaff';
      ctx.fillRect(bx, gy + graphH - hs - hr, Math.max(1, bw - 0.5), hr);
    });
    const by = gy + graphH - hOf(BUDGET_MS);
    ctx.strokeStyle = 'rgba(155,227,170,0.7)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx, by);
    ctx.lineTo(gx + gw, by);
    ctx.stroke();
    ctx.restore();
  }
}

/** High-resolution clock that also works in tests / node. */
export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
