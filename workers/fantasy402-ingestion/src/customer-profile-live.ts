/** Live Manager calls for a single customer (getInfoPlayer, getPerformancePlayer). */

/** Padded customer id/login for Manager reports (e.g. GX195 → GX195+++++). */
export function formatPaddedCustomerId(loginOrCustomerId: string): string {
  return formatPerformanceAcc(loginOrCustomerId);
}

export function formatPerformanceAcc(loginOrCustomerId: string): string {
  const raw = String(loginOrCustomerId ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.length >= 10) return raw.slice(0, 10);
  return raw.padEnd(10, "+");
}

export function buildGetInfoPlayerBody(
  agentId: string,
  customerId: string,
): Record<string, string | number> {
  return {
    customerID: customerId.trim(),
    agentID: agentId,
    agentOwner: agentId,
    operation: "getInfoPlayer",
    RRO: 0,
  };
}

export function buildGetPerformancePlayerBody(
  agentId: string,
  acc: string,
  period: number,
): Record<string, string | number> {
  return {
    acc: formatPerformanceAcc(acc),
    period,
    operation: "getPerformancePlayer",
    RRO: 1,
    agentID: agentId,
    agentOwner: agentId,
  };
}

export function extractInfoPlayerPayload(raw: unknown): {
  data: Record<string, unknown> | null;
  balance: Record<string, unknown> | null;
  added: Record<string, unknown> | null;
  thisWeek: Record<string, unknown> | null;
} {
  if (!raw || typeof raw !== "object") {
    return { data: null, balance: null, added: null, thisWeek: null };
  }
  const root = raw as Record<string, unknown>;
  const info = root.INFO && typeof root.INFO === "object" ? (root.INFO as Record<string, unknown>) : root;
  const data =
    info.data && typeof info.data === "object" ? (info.data as Record<string, unknown>) : null;
  const balance =
    info.balance && typeof info.balance === "object" ? (info.balance as Record<string, unknown>) : null;
  const added =
    info.added && typeof info.added === "object" ? (info.added as Record<string, unknown>) : null;
  const thisWeek =
    info.thisWeek && typeof info.thisWeek === "object" ? (info.thisWeek as Record<string, unknown>) : null;
  return { data, balance, added, thisWeek };
}

export function defaultAnalysisDateRange(now = new Date()): { startDate: string; endDate: string } {
  const end = now.toISOString().slice(0, 10);
  const startMs = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const start = new Date(startMs).toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

export function buildGetReportPlayerAnalysisBody(
  agentId: string,
  customerKey: string,
  startDate: string,
  endDate: string,
  reportType = 2,
  lineType = 2,
): Record<string, string | number> {
  return {
    agentID: agentId,
    agentOwner: agentId,
    customerID: formatPaddedCustomerId(customerKey),
    reportType,
    startDate,
    endDate,
    lineType,
    operation: "getReportPlayerAnalysis",
    RRO: 1,
  };
}

export function normalizePlayerAnalysisRows(raw: unknown): Array<Record<string, unknown>> {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) rows = raw;
  else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.LIST)) rows = obj.LIST;
    else if (Array.isArray(obj.list)) rows = obj.list;
    else if (obj.INFO && typeof obj.INFO === "object") {
      const info = obj.INFO as Record<string, unknown>;
      if (Array.isArray(info.LIST)) rows = info.LIST;
    }
  }
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        posted_at: r.POSTEDDATETIME ?? r.PostedDateTime ?? null,
        description: String(r.DESCRIPTION ?? r.Description ?? "").trim(),
        sport: String(r.SPORTSUBTYPE ?? r.SportSubType ?? "").trim(),
        wager_status: String(r.WAGERSTATUS ?? r.WagerStatus ?? "").trim(),
        risk: r.RISK ?? r.Risk ?? null,
        to_win: r.TOWIN ?? r.ToWin ?? null,
        win_lose: r.WINLOSE ?? r.WinLose ?? null,
        bet_points: r.BETPOINTS ?? r.BetPoints ?? null,
        juice: r.JUICE ?? r.Juice ?? null,
        close_line: String(r.CLOSELINE ?? r.CloseLine ?? "").trim(),
        points: r.POINTS ?? r.Points ?? null,
        period_number: r.PERIODNUMBER ?? r.PeriodNumber ?? null,
        player_login: String(r.PlayerLogin ?? r.Login ?? "").trim(),
        agent_login: String(r.AgentLogin ?? "").trim(),
        daily_figure_date: r.DAILYFIGUREDATE ?? null,
      };
    });
}

export function normalizePerformanceRows(raw: unknown): Array<Record<string, unknown>> {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) rows = raw;
  else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.LIST)) rows = obj.LIST;
    else if (obj.INFO && typeof obj.INFO === "object") {
      const info = obj.INFO as Record<string, unknown>;
      if (Array.isArray(info.LIST)) rows = info.LIST;
      else if (Array.isArray(info.list)) rows = info.list;
    } else if (Array.isArray(obj.list)) rows = obj.list;
  }
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => row as Record<string, unknown>);
}
