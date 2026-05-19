/**
 * AgentLink, WagerLink, CustomerLink — validated navigation controls.
 */
import { escapeHtml } from '../dom.js';
import {
  agentIdSchema,
  customerNavSchema,
  parseSafe,
  wagerLinkSchema,
} from './schemas.js';

function attr(value) {
  return escapeHtml(String(value ?? ''));
}

/**
 * @param {string} agentId
 * @param {{ label?: string, className?: string, title?: string }} [opts]
 */
export function agentLink(agentId, opts = {}) {
  const parsed = parseSafe(agentIdSchema, agentId);
  if (!parsed.success) return escapeHtml(String(agentId ?? '-'));
  const id = parsed.data;
  const label = opts.label ?? id;
  const cls = ['ds-link', opts.className].filter(Boolean).join(' ');
  const title = opts.title ? ` title="${attr(opts.title)}"` : '';
  return [
    `<button type="button" class="${cls}" data-f402-nav="agent" data-agent-id="${attr(id)}"${title}>`,
    escapeHtml(label),
    '</button>',
  ].join('');
}

/**
 * @param {{ customerId: string, login?: string, label?: string, className?: string }} opts
 */
export function customerLink(opts) {
  const parsed = parseSafe(customerNavSchema, {
    customerId: opts.customerId,
    login: opts.login,
  });
  if (!parsed.success) return escapeHtml(String(opts.customerId ?? '-'));
  const { customerId, login } = parsed.data;
  const label = opts.label ?? login ?? customerId;
  const cls = ['ds-link', opts.className].filter(Boolean).join(' ');
  const loginAttr = login ? ` data-login="${attr(login)}"` : '';
  return [
    `<button type="button" class="${cls}" data-f402-nav="customer" data-customer-id="${attr(customerId)}"${loginAttr}>`,
    escapeHtml(label),
    '</button>',
  ].join('');
}

/**
 * @param {{ ticketNumber?: string|number, login?: string, customerId?: string, label?: string }} opts
 */
export function wagerLink(opts) {
  const parsed = parseSafe(wagerLinkSchema, {
    ticketNumber: opts.ticketNumber,
    login: opts.login,
    customerId: opts.customerId,
  });
  const label =
    opts.label ??
    (parsed.success && parsed.data.ticketNumber != null
      ? `#${parsed.data.ticketNumber}`
      : parsed.success && parsed.data.login
        ? parsed.data.login
        : 'Wager');
  if (!parsed.success) return escapeHtml(String(label));
  const { ticketNumber, login, customerId } = parsed.data;
  const parts = [
    'type="button"',
    'class="ds-link"',
    'data-f402-nav="wager"',
  ];
  if (ticketNumber != null && String(ticketNumber).trim()) {
    parts.push(`data-ticket="${attr(ticketNumber)}"`);
  }
  if (login) parts.push(`data-login="${attr(login)}"`);
  if (customerId) parts.push(`data-customer-id="${attr(customerId)}"`);
  return `<button ${parts.join(' ')}>${escapeHtml(label)}</button>`;
}

/** Column formatter: player login → customer link when customer_id present. */
export function formatCustomerCell(value, row) {
  const cid = String(row?.customer_id ?? '').trim();
  const login = String(value ?? row?.login ?? '').trim();
  if (cid) return customerLink({ customerId: cid, login: login || cid, label: login || cid });
  if (login) return escapeHtml(login);
  return '-';
}

/** Column formatter: agent_id → agent link. */
export function formatAgentCell(value) {
  const id = String(value ?? '').trim();
  if (!id) return '-';
  return agentLink(id);
}

/** Column formatter: ticket / wager number → wager link. */
export function formatWagerCell(value, row) {
  const ticket = value ?? row?.ticket_number ?? row?.wager_number;
  if (ticket == null || ticket === '') return '-';
  return wagerLink({
    ticketNumber: ticket,
    login: row?.login,
    customerId: row?.customer_id,
    label: `#${ticket}`,
  });
}
