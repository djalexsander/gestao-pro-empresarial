import { useCallback, useEffect, useRef } from "react";

/**
 * Hook leve para feedback sonoro do PDV usando WebAudio (sem assets externos).
 * Habilitado por padrão; pode ser desligado via localStorage `pdv:sound = "off"`.
 *
 * Configuração centralizada — frequências e volume calibrados para serem
 * claramente audíveis em ambiente de loja (operador e cliente).
 */
type Tone = "ok" | "error" | "success" | "warn";

// Configuração central (ajustável aqui em um único lugar).
export const PDV_SCAN_BEEP_FREQUENCY = 2200; // produto escaneado
export const PDV_SUCCESS_BEEP_FREQUENCY = 2800; // venda finalizada
export const PDV_ERROR_BEEP_FREQUENCY = 320; // erro / não encontrado
export const PDV_WARN_BEEP_FREQUENCY = 600;
export const PDV_BEEP_VOLUME = 0.35; // volume bem mais alto que o anterior (0.06)

const TONES: Record<
  Tone,
  { freq: number; duration: number; type: OscillatorType; volume: number }
> = {
  ok: {
    freq: PDV_SCAN_BEEP_FREQUENCY,
    duration: 90,
    type: "square",
    volume: PDV_BEEP_VOLUME,
  },
  warn: {
    freq: PDV_WARN_BEEP_FREQUENCY,
    duration: 160,
    type: "triangle",
    volume: PDV_BEEP_VOLUME,
  },
  error: {
    freq: PDV_ERROR_BEEP_FREQUENCY,
    duration: 260,
    type: "square",
    volume: PDV_BEEP_VOLUME,
  },
  success: {
    freq: PDV_SUCCESS_BEEP_FREQUENCY,
    duration: 220,
    type: "square",
    volume: Math.min(1, PDV_BEEP_VOLUME * 1.2),
  },
};

export function useSomPDV() {
  const ctxRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef<boolean>(true);

  useEffect(() => {
    try {
      enabledRef.current =
        (typeof localStorage !== "undefined"
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
      const Ctx: typeof AudioContext =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!ctxRef.current) ctxRef.current = new Ctx();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const cfg = TONES[tone];

      const playOnce = (delay: number, freq: number, volume = cfg.volume) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = cfg.type;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + delay / 1000;
        const end = start + cfg.duration / 1000;
        // Envelope: ataque rápido, sustain, decay exponencial — som mais "presente".
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.005);
        gain.gain.setValueAtTime(volume, end - 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.start(start);
        osc.stop(end + 0.02);
      };

      if (tone === "success") {
        // Bipe duplo bem audível para venda finalizada.
        playOnce(0, cfg.freq);
        playOnce(140, cfg.freq * 1.25);
        if (import.meta.env.DEV) console.log("[PDV_BEEP] venda_finalizada");
      } else if (tone === "error") {
        playOnce(0, cfg.freq);
        playOnce(160, cfg.freq * 0.8);
        if (import.meta.env.DEV) console.log("[PDV_BEEP] erro");
      } else if (tone === "ok") {
        playOnce(0, cfg.freq);
        if (import.meta.env.DEV) console.log("[PDV_BEEP] scan");
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
