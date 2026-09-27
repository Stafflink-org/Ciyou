// Sons d'alerte de nouvelle commande, synthétisés avec Web Audio (aucun fichier à charger).
import type { RestaurantNotificationSound } from '@golink/shared';

export const SOUND_OPTIONS: Array<{ value: RestaurantNotificationSound; label: string; description: string }> = [
  { value: 'chime', label: 'Carillon', description: 'Deux notes claires, discret en salle.' },
  { value: 'bell', label: 'Cloche', description: 'Timbre de comptoir, bien audible.' },
  { value: 'marimba', label: 'Marimba', description: 'Doux et chaleureux.' },
  { value: 'pulse', label: 'Signal', description: 'Bips rapides, pour les cuisines bruyantes.' },
];

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

function tone(ctx: AudioContext, output: AudioNode, frequency: number, start: number, duration: number, type: OscillatorType, peak: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(output);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Joue le son choisi au volume indiqué (0-100). */
export async function playSound(sound: RestaurantNotificationSound, volume: number): Promise<boolean> {
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state === 'suspended') await ctx.resume();
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.6;
  master.connect(ctx.destination);
  const t = ctx.currentTime + 0.02;
  switch (sound) {
    case 'chime':
      tone(ctx, master, 880, t, 0.5, 'sine', 0.9);
      tone(ctx, master, 1318.5, t + 0.18, 0.7, 'sine', 0.8);
      break;
    case 'bell':
      tone(ctx, master, 1046.5, t, 1.2, 'triangle', 0.9);
      tone(ctx, master, 2093, t, 0.6, 'sine', 0.3);
      tone(ctx, master, 1046.5, t + 0.35, 1.0, 'triangle', 0.7);
      break;
    case 'marimba':
      [523.25, 659.25, 783.99].forEach((f, i) => tone(ctx, master, f, t + i * 0.12, 0.35, 'sine', 0.8));
      break;
    case 'pulse':
      [0, 0.16, 0.32].forEach((d) => tone(ctx, master, 1250, t + d, 0.1, 'square', 0.35));
      break;
  }
  return true;
}
