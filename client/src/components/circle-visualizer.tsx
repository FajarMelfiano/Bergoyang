import * as React from 'react';
import type { BeatInfo } from '@/lib/types';

/* ------------------------------------------------------------------ types */

interface CircleVisualizerProps {
  className?: string;
  /** URL sampul lagu (mis. thumbnail YouTube) — kosong = vinil polos */
  coverUrl?: string | null;
  playing?: boolean;
  /** Sumber spektrum nyata (DJ lokal: AnalyserNode). Tanpa ini = mode beat/idle */
  analyser?: AnalyserNode | null;
  /** Beat-grid dari panel DJ (mode tamu) */
  beat?: BeatInfo | null;
  /** Teks kecil di label tengah vinil */
  label?: string;
}

/* ------------------------------------------------------------- konstanta */

const N_BARS = 72;
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- komponen */

/**
 * Visualizer lingkaran ala Avee Player: cincin spektrum, sampul berputar
 * seperti vinil, aura hijau berdenyut mengikuti beat, partikel orbit.
 * Mode sumber data: AnalyserNode (lokal) → beat-grid (tamu) → idle sintetis.
 */
export function CircleVisualizer({
  className = '',
  coverUrl,
  playing = false,
  analyser = null,
  beat = null,
  label,
}: CircleVisualizerProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const propsRef = React.useRef({ coverUrl, playing, analyser, beat, label });
  propsRef.current = { coverUrl, playing, analyser, beat, label };

  // state animasi yang hidup di antar-render
  const stateRef = React.useRef({
    smoothed: new Float32Array(N_BARS),
    values: new Float32Array(N_BARS),
    angle: 0,
    pulse: 0,
    lastFrame: 0,
    lastBeatKey: null as number | null,
    nextBeatAt: 0,
    img: null as HTMLImageElement | null,
    imgUrl: '' as string,
    particles: Array.from({ length: 16 }, (_, i) => ({
      a: (i / 16) * TAU,
      speed: 0.12 + (i % 5) * 0.05 + (i % 3) * 0.03,
      r: 0.8 + ((i * 37) % 20) / 100,
      size: 1.2 + ((i * 13) % 10) / 6,
      phase: i * 0.7,
      kick: 0,
    })),
    freq: null as Uint8Array<ArrayBuffer> | null,
    silentFor: 0,
    reduced: false,
  });

  React.useEffect(() => {
    stateRef.current.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let alive = true;

    const draw = (now: number) => {
      if (!alive) return;
      const s = stateRef.current;
      const p = propsRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const R = Math.min(w, h) / 2;
      const cx = w / 2;
      const cy = h / 2;
      const dt = s.lastFrame ? Math.min((now - s.lastFrame) / 1000, 0.1) : 0.016;
      s.lastFrame = now;

      /* ---- energi: spektrum nyata ATAU beat-grid ATAU idle ---- */
      let energy = 0;
      const values = s.values;

      // baca spektrum sekali; kalau analyser senyap >0.8s sementara beat
      // server masih datang (YouTube iframe tanpa capture, dsb.) → jatuh ke
      // mode beat-grid supaya beat tetap hidup di semua halaman
      let modeSpektrum = Boolean(p.analyser);
      if (p.analyser && modeSpektrum) {
        const bins = p.analyser.frequencyBinCount;
        if (!s.freq || s.freq.length !== bins) s.freq = new Uint8Array(bins);
        p.analyser.getByteFrequencyData(s.freq);
        let sum = 0;
        for (let i = 0; i < bins; i += 4) sum += s.freq[i] ?? 0;
        s.silentFor = sum > 0 ? 0 : s.silentFor + dt;
        if (s.silentFor > 0.8 && p.beat && p.beat.playing) modeSpektrum = false;
      }

      if (p.analyser && modeSpektrum) {
        const bins = p.analyser.frequencyBinCount;
        let bass = 0;
        for (let i = 1; i <= 6 && i < bins; i++) bass += s.freq?.[i] ?? 0;
        bass = bass / (6 * 255);
        energy = bass;
        for (let i = 0; i < N_BARS; i++) {
          // sebaran log ke bawah spektrum — bass di bawah, treble di atas
          const frac = i / (N_BARS - 1);
          const bin = Math.min(bins - 1, 1 + Math.floor(Math.pow(frac, 1.6) * (bins - 2)));
          values[i] = ((s.freq?.[bin] ?? 0) / 255) * (1 - frac * 0.35);
        }
        s.pulse = Math.max(s.pulse * Math.pow(0.001, dt), bass > 0.34 ? bass : s.pulse * 0.92);
      } else {
        /* beat-grid: pulse diumpan tempo (beatIdx / interval BPM) tapi
           AMPLITUDE-nya diikat ke loudness — nada tenang → denyut halus,
           nada tinggi → brutal. energy juga menggerakkan bar & aura. */
        if (p.beat && p.beat.playing) {
          const interval = p.beat.bpm ? 60000 / p.beat.bpm : 1000;
          const loud = Math.max(0, Math.min(1, p.beat.energy));
          const beatAmp = 0.12 + 0.88 * loud;
          const bi = p.beat.beatIdx;
          if (bi !== undefined && bi !== null) {
            if (s.lastBeatKey !== bi) {
              s.lastBeatKey = bi;
              s.pulse = beatAmp;
              s.nextBeatAt = now + interval;
            } else if (now >= s.nextBeatAt) {
              s.pulse = beatAmp;
              s.nextBeatAt += interval;
            }
          } else if (now >= s.nextBeatAt) {
            s.pulse = beatAmp;
            s.nextBeatAt += interval;
          }
          energy = p.beat.energy;
        } else {
          s.lastBeatKey = null;
        }
        const amp = p.playing ? 1 : 0.35;
        const t = now / 1000;
        for (let i = 0; i < N_BARS; i++) {
          const idle =
            0.16 +
            0.1 * Math.sin(i * 0.63 + t * 1.7) +
            0.07 * Math.sin(i * 1.91 - t * 2.3) +
            0.05 * Math.sin(i * 0.17 + t * 0.9);
          const beatShape = 0.34 * Math.pow(Math.max(0, Math.sin(i * 0.9 + t * 0.6)), 2);
          values[i] = Math.max(0.04, (idle + beatShape * s.pulse) * amp + energy * 0.25);
        }
        s.pulse = Math.max(0, s.pulse - dt * 2.4);
      }

      /* ---- smoothing bar (serang cepat, lepas lambat) ---- */
      for (let i = 0; i < N_BARS; i++) {
        const target = values[i] ?? 0;
        const cur = s.smoothed[i] ?? 0;
        const k = target > cur ? 0.42 : 0.11;
        s.smoothed[i] = cur + (target - cur) * k;
      }

      const playing = p.playing;
      if (playing) s.angle += dt * 0.45;

      /* ---- 1. aura hijau di belakang ---- */
      const breathe = 1 + 0.03 * Math.sin(now / 1300) + s.pulse * 0.1;
      const auraR = R * 0.62 * breathe;
      const grad = ctx.createRadialGradient(cx, cy, auraR * 0.2, cx, cy, auraR);
      grad.addColorStop(0, `rgba(30,215,96,${0.05 + s.pulse * 0.16 + energy * 0.1})`);
      grad.addColorStop(0.75, `rgba(30,215,96,${0.08 + s.pulse * 0.1})`);
      grad.addColorStop(1, 'rgba(30,215,96,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, TAU);
      ctx.fill();

      /* ---- 2. partikel orbit ---- */
      for (const pt of s.particles) {
        if (playing) pt.a += pt.speed * dt;
        pt.kick = Math.max(0, pt.kick - dt * 2.2);
        const pr = R * (pt.r + pt.kick * 0.1 + s.pulse * 0.03);
        const x = cx + Math.cos(pt.a) * pr;
        const y = cy + Math.sin(pt.a) * pr;
        const tw = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(pt.phase + now / 520)) + s.pulse * 0.3;
        ctx.fillStyle = `rgba(105,255,137,${Math.min(1, tw)})`;
        ctx.beginPath();
        ctx.arc(x, y, pt.size, 0, TAU);
        ctx.fill();
      }

      /* ---- 3. cincin spektrum ---- */
      const r0 = R * 0.6 + s.pulse * R * 0.015;
      const maxLen = R * 0.3;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, R * 0.032);
      ctx.shadowColor = `rgba(30,215,96,${0.35 + s.pulse * 0.5})`;
      ctx.shadowBlur = 6 + s.pulse * 10;
      for (let i = 0; i < N_BARS; i++) {
        const a = (i / N_BARS) * TAU - Math.PI / 2;
        const v = s.smoothed[i] ?? 0;
        const len = R * 0.045 + v * maxLen;
        const x1 = cx + Math.cos(a) * r0;
        const y1 = cy + Math.sin(a) * r0;
        const x2 = cx + Math.cos(a) * (r0 + len);
        const y2 = cy + Math.sin(a) * (r0 + len);
        ctx.strokeStyle = `rgba(${30 + v * 40},${215 + v * 40},${96 + v * 60},${0.4 + v * 0.6})`;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      /* ---- 4. cincin tipis pemisah ---- */
      ctx.strokeStyle = `rgba(30,215,96,${0.14 + s.pulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 - R * 0.03, 0, TAU);
      ctx.stroke();

      /* ---- 5. vinil + sampul ---- */
      const rv = R * 0.53;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rv, 0, TAU);
      ctx.clip();

      const url = p.coverUrl || '';
      if (url !== s.imgUrl) {
        s.imgUrl = url;
        s.img = null;
        if (url) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { s.img = img; };
          img.src = url;
        }
      }

      if (s.img && s.img.complete && s.img.naturalWidth > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s.angle);
        const size = rv * 2;
        // cover-fit persegi
        const scale = Math.max(size / s.img.naturalWidth, size / s.img.naturalHeight);
        const iw = s.img.naturalWidth * scale;
        const ih = s.img.naturalHeight * scale;
        ctx.drawImage(s.img, -iw / 2, -ih / 2, iw, ih);
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(cx - rv, cy - rv, rv * 2, rv * 2);
      } else {
        const vg = ctx.createRadialGradient(cx - rv * 0.3, cy - rv * 0.3, rv * 0.1, cx, cy, rv);
        vg.addColorStop(0, '#242424');
        vg.addColorStop(1, '#0d0d0d');
        ctx.fillStyle = vg;
        ctx.fillRect(cx - rv, cy - rv, rv * 2, rv * 2);
      }

      // alur vinil berputar
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.angle);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let g = 1; g <= 7; g++) {
        ctx.beginPath();
        ctx.arc(0, 0, rv * (0.42 + g * 0.075), 0.3, Math.PI - 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, rv * (0.42 + g * 0.075), Math.PI + 0.3, TAU - 0.3);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();

      /* ---- 6. label tengah ---- */
      const rl = rv * 0.34;
      ctx.fillStyle = 'rgba(10,10,10,0.92)';
      ctx.beginPath();
      ctx.arc(cx, cy, rl, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(30,215,96,${0.35 + s.pulse * 0.55})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (p.label) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `700 ${Math.max(8, R * 0.075)}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.label, cx, cy);
      } else {
        // lubang vinil
        ctx.fillStyle = '#121212';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, R * 0.035), 0, TAU);
        ctx.fill();
      }

      if (!s.reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    // render ulang tunggal saat reduced-motion (tanpa loop)
    if (stateRef.current.reduced) {
      cancelAnimationFrame(raf);
      draw(performance.now());
    }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={`relative aspect-square ${className}`} data-testid="circle-visualizer">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
    </div>
  );
}
