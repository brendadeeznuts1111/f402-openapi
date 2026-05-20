// Map bet-ticker-worker WebSocket payload → dashboard row shapes.

/**
 * @param {Record<string, unknown>} wager - normalized worker payload
 * @returns {Record<string, unknown> | null}
 */
export function workerWagerToPendingRow(wager) {
  if (!wager || typeof wager !== 'object') return null;
  const ticket =
    wager.wager_number != null
      ? Number(wager.wager_number)
      : wager.id != null
        ? Number(String(wager.id).replace(/\D/g, '')) || String(wager.id)
        : null;
  if (ticket == null || !Number.isFinite(Number(ticket))) return null;

  const login = String(wager.login ?? '').trim();
  const captured = wager.captured_at ? String(wager.captured_at) : new Date().toISOString();

  const customerId = String(wager.customer_id ?? login).trim();
  const ticketWriter = String(wager.ticket_writer ?? '').trim();
  const agentLogin = String(wager.agent_login ?? wager.agent_id ?? '').trim();
  const vip = String(wager.vip ?? '').trim();

  return {
    ticket_number: Number(ticket),
    login,
    customer_id: customerId,
    wager_type: String(wager.wager_type ?? '').trim(),
    amount_wagered: Number(wager.amount_wagered ?? 0),
    to_win_amount: wager.to_win_amount != null ? Number(wager.to_win_amount) : null,
    volume_amount: Number(wager.volume_amount ?? 0),
    accepted_at: captured,
    sport_type: String(wager.sport_type ?? '').trim(),
    description: String(wager.short_desc ?? wager.description ?? '').trim(),
    wager_status: String(wager.wager_status ?? 'O').trim() || 'O',
    agent_id: String(wager.agent_id ?? '').trim(),
    agent_login: agentLogin,
    ticket_writer: ticketWriter,
    vip,
    _live: true,
  };
}

/** Ensure ticker feed fields (worker payload is already compatible). */
export function normalizeWorkerWager(wager) {
  if (!wager || typeof wager !== 'object') return null;
  if (!wager.captured_at && !wager.id && !wager.login) return null;
  return wager;
}
