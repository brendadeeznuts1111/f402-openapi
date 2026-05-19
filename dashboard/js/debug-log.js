// #region agent log
const DEBUG_ENDPOINT = 'http://127.0.0.1:7719/ingest/bcd4e5dc-b3d5-401f-8090-e1abeb16e668';
const DEBUG_SESSION = 'a70b9c';
const DEBUG_BUFFER_KEY = 'f402-debug-buffer';

export function debugLog(location, message, data = {}, hypothesisId = '') {
  const payload = {
    sessionId: DEBUG_SESSION,
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
    runId: data.runId || 'pre-fix',
  };
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': DEBUG_SESSION },
    body: JSON.stringify(payload),
  }).catch(() => {});
  try {
    const buf = JSON.parse(sessionStorage.getItem(DEBUG_BUFFER_KEY) || '[]');
    buf.push(payload);
    while (buf.length > 80) buf.shift();
    sessionStorage.setItem(DEBUG_BUFFER_KEY, JSON.stringify(buf));
  } catch {
    /* private mode */
  }
  if (typeof console !== 'undefined') {
    console.debug('[f402-debug]', hypothesisId, message, data);
  }
}
// #endregion
