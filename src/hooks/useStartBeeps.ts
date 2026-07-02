import { useEffect } from 'react';

// Zvukový odpočet startu: 3-2-1 krátké pípnutí, na startu delší vyšší tón.
// Beepy se plánují dopředu přes Web Audio hodiny — hrají na přesný čas
// nezávisle na tikách UI, i když je main thread zrovna zaneprázdněný.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

// Musí se zavolat z uživatelského gesta (klik) — mobilní prohlížeče jinak
// AudioContext nepustí. Krátké potvrzovací pípnutí ověří, že je slyšet.
export function primeAudio(): void {
  const audio = getCtx();
  if (audio.state === 'suspended') void audio.resume();
  scheduleBeep(audio, audio.currentTime + 0.01, 880, 0.08);
}

function scheduleBeep(
  audio: AudioContext,
  when: number,
  freq: number,
  durSec: number,
): OscillatorNode {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  // Krátká náběžná/sestupná rampa proti lupnutí.
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.5, when + 0.005);
  gain.gain.setValueAtTime(0.5, when + durSec - 0.02);
  gain.gain.linearRampToValueAtTime(0, when + durSec);
  osc.connect(gain).connect(audio.destination);
  osc.start(when);
  osc.stop(when + durSec + 0.05);
  return osc;
}

export function useStartBeeps(targetIso: string | null): void {
  useEffect(() => {
    if (!targetIso) return;
    const audio = getCtx();
    const targetMs = new Date(targetIso).getTime();
    const scheduled: { osc: OscillatorNode; when: number }[] = [];

    const add = (offsetSec: number, freq: number, durSec: number) => {
      const when = audio.currentTime + (targetMs - Date.now()) / 1000 + offsetSec;
      if (when < audio.currentTime + 0.02) return; // okamžik už proběhl
      scheduled.push({ osc: scheduleBeep(audio, when, freq, durSec), when });
    };

    for (const s of [3, 2, 1]) add(-s, 880, 0.12);
    add(0, 1760, 0.6);

    return () => {
      // Zrušit jen beepy dál v budoucnu. START tón leží přesně na okamžiku,
      // kdy auto-start přepne odpočet na dalšího závodníka — bez rezervy by
      // ho tenhle cleanup stihl zrušit dřív, než zazní (drift audio hodin
      // vs. Date.now + rychlost liveQuery).
      const keepUntil = audio.currentTime + 0.25;
      for (const { osc, when } of scheduled) {
        if (when > keepUntil) {
          try { osc.stop(); } catch { /* už dohrál */ }
        }
      }
    };
  }, [targetIso]);
}
