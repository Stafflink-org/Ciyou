#!/bin/bash
# Déploiement une à une des fonctions d'exploitation, avec nouvelles tentatives (quota de processeurs partagé).
cd "$(dirname "$0")/../.."
FNS="requestCourier enforceAcceptanceTimeout listOrdersAdmin getOrderAnomalies getDriverFile reviewDriverApplication reviewDriverDocument reviewIdentityCheck requestIdentityChecks sanctionDriver decideSanctionContest bulkUpdateDrivers dispatchOrder previewDispatch respondToOffer updateCourierPay updateDispatchRules updateOrderRules saveCity setCityActive saveZone closeZone saveSurgeRule applySurge computeZoneLive advanceDispatchOffers runDriverCompliance onDriverLocationWritten"
for f in $FNS; do
  for attempt in $(seq 1 30); do
    FUNCTIONS_DISCOVERY_TIMEOUT=120 timeout 900 npx firebase deploy --only functions:$f --project golink-9f16d --force > .ops-deploy-$f.log 2>&1
    if grep -q "Deploy complete" .ops-deploy-$f.log && ! grep -q "had errors" .ops-deploy-$f.log; then echo "OK $f"; break; fi
    echo "KO $f (essai $attempt) : $(grep -m1 -oE 'Quota exceeded[^.]*|another deployment[^.]*|Error[^\n]{0,120}' .ops-deploy-$f.log)"
    sleep 180
  done
done
echo FIN
