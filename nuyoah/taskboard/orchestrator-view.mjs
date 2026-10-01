export function mergeOrchestratorRequestSnapshot(listRequest, detailResponse) {
  const events = detailResponse?.request?.events;
  if (!Array.isArray(events)) return listRequest;
  return { ...listRequest, events };
}
