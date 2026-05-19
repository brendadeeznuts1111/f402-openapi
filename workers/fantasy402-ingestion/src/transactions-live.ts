/** Live Manager transaction reports (history, deleted, list, analysis). */

import { formatPaddedCustomerId } from "./customer-profile-live";

export const TRANSACTION_REPORT_TYPES = {
  player: {
    label: "Player Transactions",
    path: "/cloud/api/Manager/getTransactionHistory",
    operation: "getTransactionHistory",
  },
  agent: {
    label: "Agent Transactions",
    path: "/cloud/api/Manager/getTransactionHistory",
    operation: "getTransactionHistory",
  },
  deleted: {
    label: "Deleted Transactions",
    path: "/cloud/api/Manager/getReportDeletedTransactions",
    operation: "getReportDeletedTransactions",
  },
  "free-play": {
    label: "Free Play Transactions",
    path: "/cloud/api/Manager/getTransactionHistory",
    operation: "getTransactionHistory",
  },
  "free-play-analysis": {
    label: "Free Play Analysis",
    path: "/cloud/api/Manager/getReportPlayerAnalysis",
    operation: "getReportPlayerAnalysis",
  },
  summary: {
    label: "Player Summary",
    path: "/cloud/api/Manager/getTransactionList",
    operation: "getTransactionList",
  },
} as const;

export type TransactionReportType = keyof typeof TRANSACTION_REPORT_TYPES;

export type TransactionHistoryFlags = {
  deposits?: "checked" | "unchecked";
  withdrawals?: "checked" | "unchecked";
  adjustments?: "checked" | "unchecked";
  transfers?: "checked" | "unchecked";
  fees?: "checked" | "unchecked";
  promotional?: "checked" | "unchecked";
  balances?: "checked" | "unchecked";
  distribution?: "checked" | "unchecked";
};

export type BuildTransactionsBodyInput = {
  type: TransactionReportType;
  agentId: string;
  customerId?: string;
  startDate: string;
  endDate: string;
  freeFlag?: "player" | "agent";
  historyFlags?: TransactionHistoryFlags;
  reportType?: number;
  lineType?: number;
};

function checkbox(value: "checked" | "unchecked" | undefined, defaultValue: "checked" | "unchecked"): string {
  return value ?? defaultValue;
}

export function buildTransactionsBody(input: BuildTransactionsBodyInput): Record<string, string | number> {
  const agentId = input.agentId.trim().toUpperCase();
  const meta = TRANSACTION_REPORT_TYPES[input.type];
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  const customerRaw = (input.customerId ?? "").trim();
  const customerID = customerRaw ? formatPaddedCustomerId(customerRaw) : customerRaw;

  if (input.type === "deleted") {
    return {
      customerID: customerID || agentId,
      startDate,
      endDate,
      operation: meta.operation,
      RRO: 1,
      agentID: agentId,
      agentOwner: agentId,
    };
  }

  if (input.type === "summary") {
    return {
      RRO: 1,
      agentID: agentId,
      agentOwner: agentId,
      operation: meta.operation,
    };
  }

  if (input.type === "free-play-analysis") {
    return {
      agentID: agentId,
      agentOwner: agentId,
      customerID: customerID || formatPaddedCustomerId(agentId),
      reportType: input.reportType ?? 2,
      startDate,
      endDate,
      lineType: input.lineType ?? 2,
      operation: meta.operation,
      RRO: 1,
    };
  }

  const flags = input.historyFlags ?? {};
  const freeFlag =
    input.type === "agent"
      ? "agent"
      : input.type === "free-play"
        ? "player"
        : (input.freeFlag ?? "player");

  const defaultChecks: TransactionHistoryFlags =
    input.type === "free-play"
      ? {
          deposits: "unchecked",
          withdrawals: "unchecked",
          adjustments: "unchecked",
          transfers: "unchecked",
          fees: "unchecked",
          promotional: "checked",
          balances: "unchecked",
          distribution: "unchecked",
        }
      : {
          deposits: "checked",
          withdrawals: "checked",
          adjustments: "checked",
          transfers: "checked",
          fees: "checked",
          promotional: "checked",
          balances: "checked",
          distribution: "unchecked",
        };

  return {
    agentID: agentId,
    customerID,
    startDate,
    endDate,
    deposits: checkbox(flags.deposits, defaultChecks.deposits!),
    withdrawals: checkbox(flags.withdrawals, defaultChecks.withdrawals!),
    adjustments: checkbox(flags.adjustments, defaultChecks.adjustments!),
    transfers: checkbox(flags.transfers, defaultChecks.transfers!),
    fess: checkbox(flags.fees, defaultChecks.fees!),
    promotional: checkbox(flags.promotional, defaultChecks.promotional!),
    balances: checkbox(flags.balances, defaultChecks.balances!),
    distribution: checkbox(flags.distribution, defaultChecks.distribution!),
    freeFlag,
    operation: meta.operation,
    RRO: 1,
    agentOwner: agentId,
  };
}

export function transactionPathForType(type: TransactionReportType): string {
  return TRANSACTION_REPORT_TYPES[type].path;
}

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

export function extractTransactionList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const info = root.INFO && typeof root.INFO === "object" ? (root.INFO as Record<string, unknown>) : root;
  if (Array.isArray(info.LIST)) return info.LIST;
  if (Array.isArray(info.list)) return info.list;
  if (Array.isArray(root.LIST)) return root.LIST;
  if (Array.isArray(root.list)) return root.list;
  return [];
}

export function normalizeTransactionRows(raw: unknown): Array<Record<string, unknown>> {
  return extractTransactionList(raw)
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        posted_at: r.POSTEDDATETIME ?? r.PostedDateTime ?? r.Date ?? r.date ?? null,
        description: trimStr(r.DESCRIPTION ?? r.Description ?? r.Memo ?? r.memo),
        login: trimStr(r.LOGIN ?? r.Login ?? r.Player ?? r.player),
        customer_id: trimStr(r.CUSTOMERID ?? r.CustomerID ?? r.customerID),
        amount: r.AMOUNT ?? r.Amount ?? r.amount ?? r.TRANSACTIONAMOUNT ?? null,
        balance: r.BALANCE ?? r.Balance ?? r.balance ?? null,
        transaction_type: trimStr(r.TRANSACTIONTYPE ?? r.TransactionType ?? r.Type ?? r.type),
        reference: trimStr(r.REFERENCE ?? r.Reference ?? r.TicketNumber ?? r.ticketNumber),
        agent_id: trimStr(r.AGENTID ?? r.AgentID ?? r.agentID),
        deleted_by: trimStr(r.DELETEDBY ?? r.DeletedBy),
        raw: r,
      };
    });
}
