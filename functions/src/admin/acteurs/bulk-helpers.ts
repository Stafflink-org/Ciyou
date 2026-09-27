// Traduction des paramètres d'une action groupée en modification commerciale.
import type { PlanCode } from '@golink/shared';

export function commercialPatchFor(
  action: 'set_commission' | 'set_plan',
  params: { planCode?: PlanCode; platformDeliveryBps?: number | null; restaurantDeliveryBps?: number | null; pickupBps?: number | null },
): { planCode?: PlanCode; rates?: { platformDeliveryBps: number | null; restaurantDeliveryBps: number | null; pickupBps: number | null } } {
  if (action === 'set_plan') return { planCode: params.planCode };
  return {
    rates: {
      platformDeliveryBps: params.platformDeliveryBps ?? null,
      restaurantDeliveryBps: params.restaurantDeliveryBps ?? null,
      pickupBps: params.pickupBps ?? null,
    },
  };
}
