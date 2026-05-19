/** Cross-view navigation via validated data attributes on .ds-link controls. */
import { agentNavSchema, customerNavSchema, wagerLinkSchema, parseSafe } from './schemas.js';

export const NAV_EVENT = 'f402:navigate';

let bridge = null;

export function installNavigationBridge(handlers) {
  bridge = handlers;
  if (typeof document === 'undefined') return;
  document.addEventListener('click', onNavClick);
}

export function dispatchNavigate(detail) {
  document.dispatchEvent(new CustomEvent(NAV_EVENT, { detail, bubbles: true }));
}

function onNavClick(e) {
  const el = e.target.closest('[data-f402-nav]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const kind = el.dataset.f402Nav;
  if (kind === 'customer') {
    const parsed = parseSafe(customerNavSchema, {
      customerId: el.dataset.customerId,
      login: el.dataset.login,
    });
    if (!parsed.success) {
      bridge?.showError?.(parsed.error.issues[0]?.message ?? 'Invalid customer link');
      return;
    }
    bridge?.onCustomer?.(parsed.data.customerId, parsed.data.login);
    return;
  }
  if (kind === 'agent') {
    const parsed = parseSafe(agentNavSchema, { agentId: el.dataset.agentId });
    if (!parsed.success) {
      bridge?.showError?.(parsed.error.issues[0]?.message ?? 'Invalid agent link');
      return;
    }
    bridge?.onAgent?.(parsed.data.agentId);
    return;
  }
  if (kind === 'wager') {
    const parsed = parseSafe(wagerLinkSchema, {
      ticketNumber: el.dataset.ticket,
      login: el.dataset.login,
      customerId: el.dataset.customerId,
    });
    if (!parsed.success) {
      bridge?.showError?.(parsed.error.issues[0]?.message ?? 'Invalid wager link');
      return;
    }
    bridge?.onWager?.(parsed.data);
  }
}
