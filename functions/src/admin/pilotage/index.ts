// Pilotage du super admin (cahier §1 à §4) : agrégats de la plateforme, surveillance
// par exception, recherche universelle, analytics, exports et rapports programmés.
export { aggregatePlatformStats, onOrderWrittenPlatformStats, refreshPlatformStats, refreshTodayExternalFields, trackFunnelEvent } from './platform-stats';
export { detectAnomalies } from './anomalies';
export { handlePlatformAlert, runMonitoringNow, updateMonitoringSettings } from './alerts';
export { globalSearch } from './search';
export { getPilotageOverview } from './overview';
export { getPilotageAnalytics } from './analytics';
export { exportData } from './exports';
export { deleteScheduledReport, runReportNow, runScheduledReports, saveScheduledReport } from './reports';
