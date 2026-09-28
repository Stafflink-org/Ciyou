// Ticket cuisine imprimable (format rouleau 80 mm) : imprimé depuis un cadre
// masqué, sans quitter la page du service.
import { formatPrice, type Order } from '@golink/shared';
import { fulfillmentLabel } from '../lib';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function time(value: { toDate(): Date } | null | undefined): string {
  return value ? value.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
}

export function kitchenTicketHtml(order: Order, restaurantName: string): string {
  const readyAt = order.timeline.preparing
    ? new Date(order.timeline.preparing.toMillis() + (order.prepMinutes + order.prepExtendedMinutes) * 60_000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;
  const lines = order.items
    .map((item) => {
      const groups = new Map<string, string[]>();
      for (const o of item.options) groups.set(o.groupName, [...(groups.get(o.groupName) ?? []), `${o.quantity > 1 ? `${o.quantity}× ` : ''}${o.name}`]);
      const options = [...groups.entries()].map(([g, names]) => `<div class="opt">${escape(g)} : ${escape(names.join(', '))}</div>`).join('');
      const comment = item.comment ? `<div class="note">» ${escape(item.comment)}</div>` : '';
      return `<div class="item"><div class="row"><span class="qty">${item.quantity}×</span><span class="name">${escape(item.name)}</span></div>${options}${comment}</div>`;
    })
    .join('');
  const address = order.delivery
    ? `<div class="block"><b>Livraison</b><br>${escape(order.delivery.address.line1)}${order.delivery.address.details ? `<br>${escape(order.delivery.address.details)}` : ''}<br>${escape(`${order.delivery.address.postalCode} ${order.delivery.address.city}`)}</div>`
    : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ticket ${escape(order.number)}</title>
<style>
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
body { font-family: ui-monospace, "DM Mono", Menlo, Consolas, monospace; font-size: 12px; color: #000; width: 72mm; margin: 0; }
h1 { font-size: 22px; margin: 0; letter-spacing: -0.02em; }
.center { text-align: center; }
.muted { font-size: 11px; }
.mode { display: inline-block; border: 2px solid #000; padding: 2px 8px; font-weight: 700; font-size: 14px; margin: 6px 0; text-transform: uppercase; }
hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
.item { margin: 6px 0; }
.row { display: flex; gap: 6px; font-size: 14px; font-weight: 700; }
.qty { min-width: 26px; }
.opt { padding-left: 32px; font-size: 12px; }
.note { padding-left: 32px; font-style: italic; font-weight: 700; }
.block { margin-top: 6px; }
.big { font-size: 13px; font-weight: 700; }
</style></head><body>
<div class="center">
  <div class="muted">${escape(restaurantName)}</div>
  <h1>${escape(order.number)}</h1>
  <div class="mode">${escape(fulfillmentLabel(order.fulfillment))}</div>
  <div class="muted">Reçue à ${time(order.createdAt)}${readyAt ? ` · prête pour ${readyAt}` : ''}</div>
</div>
<hr>
<div class="big">${escape(order.customerName)}</div>
${order.pickupCode && order.fulfillment !== 'delivery' ? `<div>Code de retrait : <b>${escape(order.pickupCode)}</b></div>` : ''}
<hr>
${lines}
<hr>
<div>${order.itemsCount} article${order.itemsCount > 1 ? 's' : ''} · ${escape(formatPrice(order.amounts.subtotalCents))}</div>
${order.customerNote ? `<div class="block"><b>Note du client</b><br>${escape(order.customerNote)}</div>` : ''}
${order.containsAlcohol ? '<div class="block"><b>Contient de l’alcool : pièce d’identité à la remise</b></div>' : ''}
${address}
<hr>
<div class="center muted">GoLink · ticket cuisine</div>
</body></html>`;
}

/** Ouvre la boîte d'impression du navigateur avec le ticket de la commande. */
export function printKitchenTicket(order: Order, restaurantName: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.right = '0';
  frame.style.bottom = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(kitchenTicketHtml(order, restaurantName));
  doc.close();
  const win = frame.contentWindow;
  const cleanup = () => window.setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup);
  window.setTimeout(() => {
    win.focus();
    win.print();
    cleanup();
  }, 150);
}
