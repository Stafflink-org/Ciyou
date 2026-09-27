// Cloud Functions de l'exploitation (livreurs, commandes, règles, zones), typées.
import type {
  AdminDispatchOrderInput,
  AdminDispatchOrderResult,
  ApplySurgeInput,
  BulkResult,
  BulkUpdateDriversInput,
  CloseZoneInput,
  DecideSanctionContestInput,
  DispatchCandidate,
  DispatchRules,
  ListOrdersAdminInput,
  ListOrdersAdminResult,
  OrderAnomaliesInput,
  OrderAnomaliesResult,
  RequestIdentityChecksInput,
  ReviewDriverApplicationInput,
  ReviewDriverApplicationResult,
  ReviewDriverDocumentInput,
  ReviewDriverDocumentResult,
  ReviewIdentityCheckInput,
  SanctionDriverInput,
  SaveCityInput,
  SaveSurgeRuleInput,
  SaveZoneInput,
  SetCityActiveInput,
  UpdateCourierPayInput,
  UpdateDispatchRulesInput,
  UpdateOrderRulesInput,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

export const fn = {
  reviewDriverApplication: callFunctionWithReason<ReviewDriverApplicationInput, ReviewDriverApplicationResult>('reviewDriverApplication', { title: 'Décision sur l’inscription', description: 'Le motif est conservé dans le journal d’audit (et transmis au livreur en cas de refus).' }),
  reviewDriverDocument: callFunctionWithReason<ReviewDriverDocumentInput, ReviewDriverDocumentResult>('reviewDriverDocument', { title: 'Décision sur le document', description: 'Le motif est conservé dans le journal d’audit (et transmis au livreur en cas de refus).' }),
  reviewIdentityCheck: callFunction<ReviewIdentityCheckInput, { status: string }>('reviewIdentityCheck'),
  requestIdentityChecks: callFunction<RequestIdentityChecksInput, BulkResult>('requestIdentityChecks'),
  sanctionDriver: callFunction<SanctionDriverInput, BulkResult>('sanctionDriver'),
  decideSanctionContest: callFunction<DecideSanctionContestInput, { status: string }>('decideSanctionContest'),
  getDriverFile: callFunction<{ path: string }, { contentType: string; dataBase64: string; name: string }>('getDriverFile'),
  bulkUpdateDrivers: callFunction<BulkUpdateDriversInput, BulkResult>('bulkUpdateDrivers'),
  dispatchOrder: callFunction<AdminDispatchOrderInput, AdminDispatchOrderResult>('dispatchOrder'),
  previewDispatch: callFunction<{ orderId: string }, { rules: DispatchRules; candidates: DispatchCandidate[] }>('previewDispatch'),
  updateDispatchRules: callFunction<UpdateDispatchRulesInput, { rules: DispatchRules }>('updateDispatchRules'),
  updateOrderRules: callFunction<UpdateOrderRulesInput, { updatedFields: string[] }>('updateOrderRules'),
  updateCourierPay: callFunction<UpdateCourierPayInput, { updatedFields: string[] }>('updateCourierPay'),
  saveCity: callFunctionWithReason<SaveCityInput, { cityId: string }>('saveCity', { title: 'Enregistrer la ville', description: 'Le motif est conservé dans le journal d’audit.' }),
  setCityActive: callFunction<SetCityActiveInput, { active: boolean }>('setCityActive'),
  saveZone: callFunction<SaveZoneInput, { zoneId: string }>('saveZone'),
  closeZone: callFunction<CloseZoneInput, { closed: boolean }>('closeZone'),
  saveSurgeRule: callFunction<SaveSurgeRuleInput, { ruleId: string }>('saveSurgeRule'),
  applySurge: callFunction<ApplySurgeInput, { on: boolean; until: number | null }>('applySurge'),
  listOrdersAdmin: callFunction<ListOrdersAdminInput, ListOrdersAdminResult>('listOrdersAdmin'),
  getOrderAnomalies: callFunction<OrderAnomaliesInput, OrderAnomaliesResult>('getOrderAnomalies'),
};

/** Résumé lisible d'une action groupée. */
export function bulkSummary(result: BulkResult | undefined, label: string): string {
  if (!result) return '';
  if (result.failed === 0) return `${label} : ${result.succeeded} livreur${result.succeeded > 1 ? 's' : ''}.`;
  return `${label} : ${result.succeeded} réussi${result.succeeded > 1 ? 's' : ''}, ${result.failed} en échec (${result.errors[0]?.message ?? 'erreur'}).`;
}
