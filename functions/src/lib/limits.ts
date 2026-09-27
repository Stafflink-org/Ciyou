// Limites et seuils techniques modifiables par le super admin (H5) : lignes maximales
// des exports (CSV, Excel, PDF, audit, import de commerces) et alerte d'ancienneté des
// espèces des livreurs de commerce. Repli documenté : DEFAULT_LIMITS_SETTINGS.
import { COLLECTIONS, DEFAULT_LIMITS_SETTINGS, SETTINGS_DOCS, type LimitsSettings } from '@golink/shared';
import { db } from './admin';

let cached: { at: number; value: LimitsSettings } | null = null;
const CACHE_MS = 15_000;

export async function loadLimitsSettings(fresh = false): Promise<LimitsSettings> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.limits).get();
  const data = snap.data() ?? {};
  const value = {
    ...DEFAULT_LIMITS_SETTINGS,
    ...data,
    exports: { ...DEFAULT_LIMITS_SETTINGS.exports, ...(data as Partial<LimitsSettings>).exports },
  } as LimitsSettings;
  cached = { at: Date.now(), value };
  return value;
}
