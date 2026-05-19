/** Live Manager/getAgentPerformance — customer, sport, volume, and graded views. */

export const AGENT_PERFORMANCE_TYPES = {
  CP: "Customer Performance",
  CPS: "Sport Performance",
  CPV: "Customer Volume",
  G: "Graded Wagers",
} as const;

export type AgentPerformanceType = keyof typeof AGENT_PERFORMANCE_TYPES;

export function buildGetAgentPerformanceBody(
  agentId: string,
  options: {
    type?: string;
    freePlay?: string;
    store?: string;
    sport?: string;
    subsport?: string;
    period?: number;
    wagerType?: string;
    betType?: string;
    tipo?: number;
    start?: string;
    end?: string;
    debug?: number;
  } = {},
): Record<string, string | number> {
  const id = agentId.trim().toUpperCase();
  const store = (options.store ?? id).trim().toUpperCase();
  return {
    start: options.start ?? "Invalid date",
    end: options.end ?? "Invalid date",
    agentID: id,
    type: options.type ?? "CP",
    freePlay: options.freePlay ?? "Y",
    store,
    sport: options.sport ?? "",
    subsport: options.subsport ?? "",
    period: options.period ?? -1,
    wagerType: options.wagerType ?? "",
    betType: options.betType ?? "",
    tipo: options.tipo ?? -1,
    debug: options.debug ?? 0,
    operation: "getAgentPerformance",
    RRO: 1,
    agentOwner: id,
  };
}

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

export function extractAgentPerformanceList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const info = root.INFO && typeof root.INFO === "object" ? (root.INFO as Record<string, unknown>) : root;
  if (Array.isArray(info.LIST)) return info.LIST;
  if (Array.isArray(info.list)) return info.list;
  if (Array.isArray(root.LIST)) return root.LIST;
  return [];
}

/** Normalize LIST rows for dashboard tables (shape varies by `type`). */
export function normalizeAgentPerformanceRows(
  raw: unknown,
  perfType: string,
): Array<Record<string, unknown>> {
  const rows = extractAgentPerformanceList(raw);
  const type = perfType.toUpperCase();

  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      if (type === "CPS" || r.SportType != null || r.SportSubType != null) {
        return {
          bet_type: trimStr(r.BetType),
          sport_type: trimStr(r.SportType),
          sport_sub_type: trimStr(r.SportSubType),
          period_description: trimStr(r.PeriodDescription),
          wager_type: trimStr(r.WagerType),
          risk: r.Risk ?? null,
          won_lost: r.WonLost ?? null,
          won: r.Won ?? null,
          lost: r.Lost ?? null,
          bets: r.Bets ?? null,
          period_number: r.PeriodNumber ?? null,
        };
      }
      if (type === "G" || r.BetType != null) {
        return {
          bet_type: trimStr(r.BetType),
          sport_type: trimStr(r.SportType),
          sport_sub_type: trimStr(r.SportSubType),
          period_description: trimStr(r.PeriodDescription),
          wager_type: trimStr(r.WagerType),
          risk: r.Risk ?? null,
          won_lost: r.WonLost ?? r.WonLostAmount ?? null,
          won: r.Won ?? null,
          lost: r.Lost ?? null,
          bets: r.Bets ?? r.wagercount ?? null,
          period_number: r.PeriodNumber ?? null,
          login: trimStr(r.Login),
          customer_id: trimStr(r.CustomerID),
        };
      }
      return {
        customer_id: trimStr(r.CustomerID),
        agent_id: trimStr(r.AgentID),
        login: trimStr(r.Login),
        wager_count: r.wagercount ?? r.WagerCount ?? null,
        risk: r.Risk ?? null,
        to_win: r.ToWin ?? null,
        amount_won: r.amountwon ?? r.AmountWon ?? null,
        amount_lost: r.amountlost ?? r.AmountLost ?? null,
        volume: r.volume ?? r.Volume ?? null,
        net: r.net ?? r.Net ?? null,
      };
    });
}
