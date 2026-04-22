import { useCallback, useEffect, useRef } from "react";

/**
 * Hook leve para feedback sonoro do PDV usando WebAudio (sem assets externos).
 * Habilitado por padrão; pode ser desligado via localStorage `pdv:sound = "off"`.
 */
type Tone = "ok" | "error" | "success" | "warn";

const TONES: Record<Tone, { freq: number; duration: number; type: OscillatorType; volume: number }> = {
  ok:      { freq: 880,  duration: 70,  type: "sine",     volume: 0.06 },
  warn:    { freq: 520,  duration: 140, type: "triangle", volume: 0.08 },
  error:   { freq: 220,  duration: 220, type: "square",   volume: 0.08 },
  success: { freq: 1320, duration: 180, type: "sine",     volume: 0.08 },
};

export function useSomPDV() {
  const ctxRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef<boolean>(true);

  useEffect(() => {
    try {
      enabledRef.current = (typeof localStorage !== "undefined"
        ? localStorage.getItem("pdv:sound")
        : null) !== "off";
    } catch {
      enabledRef.current = true;
    }
    return () => {
      try {
        ctxRef.current?.close();
      } catch {
        // ignore
      }
      ctxRef.current = null;
    };
  }, []);

  const beep = useCallback((tone: Tone) => {
    if (!enabledRef.current) return;
    if (typeof window === "undefined") return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!ctxRef.current) ctxRef.current = new Ctx();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const cfg = TONES[tone];

      const playOnce = (delay: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = cfg.type;
        osc.frequency.value = freq;
        gain.gain.value = cfg.volume;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + delay / 1000;
        const end = start + cfg.duration / 1000;
        gain.gain.setValueAtTime(cfg.volume, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.start(start);
        osc.stop(end + 0.02);
      };

      if (tone === "success") {
        playOnce(0, cfg.freq);
        playOnce(120, cfg.freq * 1.25);
      } else if (tone === "error") {
        playOnce(0, cfg.freq);
        playOnce(140, cfg.freq * 0.8);
      } else {
        playOnce(0, cfg.freq);
      }
    } catch {
      // ignore failures (e.g. user gesture not yet given)
    }
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    try {
      localStorage.setItem("pdv:sound", enabled ? "on" : "off");
    } catch {
      // ignore
    }
  }, []);

  const isEnabled = useCallback(() => enabledRef.current, []);

  return { beep, setEnabled, isEnabled };
}
