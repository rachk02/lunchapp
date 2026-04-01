const fs = require('fs');
const path = 'F:/Arlette/FoodChoose/lunchapp/public/app.js';
let src = fs.readFileSync(path, 'utf8');

function replace(old, nw) {
  if (!src.includes(old)) { console.error('NOT FOUND:', old.slice(0,80)); process.exit(1); }
  src = src.replace(old, nw);
}

// 1. SPECIALTIES constant + helpers après _confirmCallback
replace(
`let _confirmCallback  = null;`,
`let _confirmCallback  = null;

const SPECIALTIES = [
  'Cuisine africaine','Cuisine ivoirienne','Cuisine burkinabè','Cuisine sénégalaise',
  'Grillades / Brochettes','Fast food / Sandwichs','Pizzas','Burgers',
  'Cuisine asiatique','Cuisine française','Fruits de mer','Soupes / Bouillons',
  'Cuisine végétarienne','Pâtisserie / Desserts','Cuisine fusion',
];

function renderSpecialtyCheckboxes(containerId, selected = []) {
  const sel = Array.isArray(selected) ? selected : (selected ? [selected] : []);
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = SPECIALTIES.map(s =>
    \`<label class="spec-chip"><input type="checkbox" value="\${s}" \${sel.includes(s)?'checked':''}> \${s}</label>\`
  ).join('');
}

function collectSpecialties(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return [];
  return Array.from(c.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}`
);

// 2. Remove confirm2 from deleteItem
replace(
`async function deleteItem(id) {
  confirm2('Supprimer cet article ?', async () => {
    try {
      await api('DELETE', \`/api/restaurant/menu/items/\${id}\`);
      toast('Article supprimé', 'success');
      loadMenus();
    } catch (e) { toast(e.message, 'error'); }
  });
}`,
`async function deleteItem(id) {
  try {
    await api('DELETE', \`/api/restaurant/menu/items/\${id}\`);
    toast('Article supprimé', 'success');
    loadMenus();
  } catch (e) { toast(e.message, 'error'); }
}`
);

// 3. Rewrite loadClientele() — new Commandes structure
replace(
`async function loadClientele() {
  try {
    const [clients, orders, subs, enterprises] = await Promise.all([
      api('GET', '/api/restaurant/clientele'),
      api('GET', '/api/orders'),
      api('GET', '/api/subscriptions'),
      api('GET', '/api/restaurant/enterprises'),
    ]);

    // Clientèle affiliée
    el('clientele-list').innerHTML = clients.length
      ? clients.map(c => \`
          <div class="client-card">
            <div>
              <strong>\${esc(c.companyName)}</strong>
              \${c.location ? \`<a href="\${esc(c.location)}" target="_blank" class="map-link">📍 Maps</a>\` : ''}
            </div>
            <span class="badge">\${c.todayChoices?.length || 0} choix aujourd'hui</span>
          </div>\`).join('')
      : '<p class="empty">Aucune entreprise affiliée.</p>';

    // Commandes
    el('rst-orders-list').innerHTML = orders.length
      ? orders.map(o => \`
          <div class="order-card">
            <div>
              <strong>\${esc(o.enterpriseName)}</strong> — \${fmtDateTime(o.createdAt)}
              <span class="badge \${o.status}">\${o.status}</span>
            </div>
            <div>\${fmtPrice(o.totalAmount)} · \${o.paymentMode === 'upfront' ? '💳 Mobile' : '🚚 Livraison'}</div>
            <div class="order-btns">
              \${['confirmed','preparing','delivered'].map(s =>
                \`<button class="btn ghost sm" onclick="updateOrderStatus('\${o.id}','\${s}')">\${s}</button>\`
              ).join('')}
            </div>
          </div>\`).join('')
      : '<p class="empty">Aucune commande.</p>';

    // Abonnements
    el('rst-subs-list').innerHTML = subs.length
      ? subs.map(s => \`
          <div class="sub-card">
            <span>\${esc(s.enterpriseName)} — <em>\${s.frequency}</em> — <span class="badge \${s.status}">\${s.status}</span></span>
            \${s.status === 'pending' ? \`
              <div>
                <button class="btn primary sm" onclick="respondSub('\${s.id}','accepted')">✓ Accepter</button>
                <button class="btn danger sm"  onclick="respondSub('\${s.id}','declined')">✕ Refuser</button>
              </div>\` : ''}
          </div>\`).join('')
      : '<p class="empty">Aucune demande.</p>';

    // Offrir services
    el('rst-enterprises-list').innerHTML = enterprises.map(e => \`
      <div class="ent-row">
        <span>\${esc(e.companyName)}</span>
        \${e.isAffiliated ? '<span class="badge success">Affiliée</span>' : ''}
        \${!e.hasOffer && !e.isAffiliated
          ? \`<button class="btn primary sm" onclick="offerService('\${e.id}')">📤 Proposer</button>\`
          : e.hasOffer && !e.isAffiliated
          ? \`<button class="btn ghost sm" onclick="withdrawOffer('\${e.id}')">Retirer l'offre</button>\`
          : ''}
      </div>\`).join('') || '<p class="empty">Aucune entreprise.</p>';
  } catch (e) { toast(e.message, 'error'); }
}`,
`async function loadClientele() {
  try {
    const [clients, orders, subs, enterprises, invoices] = await Promise.all([
      api('GET', '/api/restaurant/clientele'),
      api('GET', '/api/orders'),
      api('GET', '/api/subscriptions'),
      api('GET', '/api/restaurant/enterprises'),
      api('GET', '/api/invoices'),
    ]);

    const invoiceByOrder = {};
    invoices.forEach(i => { invoiceByOrder[i.orderId] = i; });

    // Grouper commandes par entreprise
    const byEnt = {};
    orders.forEach(o => {
      if (!byEnt[o.enterpriseId]) byEnt[o.enterpriseId] = { name: o.enterpriseName, orders: [] };
      byEnt[o.enterpriseId].orders.push(o);
    });
    // Ajouter les affiliés sans commandes
    clients.forEach(c => {
      if (!byEnt[c.id]) byEnt[c.id] = { name: c.companyName, orders: [], todayChoices: c.todayChoices || [] };
      else byEnt[c.id].todayChoices = c.todayChoices || [];
    });

    const statusBtns = o => {
      const inv = invoiceByOrder[o.id];
      const actions = [];
      if (o.status === 'pending')   actions.push(\`<button class="btn primary sm" onclick="updateOrderStatus('\${o.id}','confirmed')">✅ Accuser réception</button>\`);
      if (o.status === 'confirmed') actions.push(\`<button class="btn ghost sm" onclick="updateOrderStatus('\${o.id}','preparing')">🍳 En préparation</button>\`);
      if (['confirmed','preparing'].includes(o.status)) actions.push(\`<button class="btn success sm" onclick="updateOrderStatus('\${o.id}','delivered')">🚚 Livrée</button>\`);
      if (!inv && o.status !== 'pending') actions.push(\`<button class="btn primary sm" onclick="createInvoice('\${o.id}')">🧾 Faire la facture</button>\`);
      if (inv) actions.push(\`<button class="btn outline sm" onclick="downloadInvoice('\${inv.id}')">⬇ Facture (\${inv.status})</button>\`);
      return actions.join('');
    };

    el('clientele-list').innerHTML = Object.values(byEnt).length
      ? Object.values(byEnt).map(g => \`
          <div class="enterprise-group">
            <div class="group-header">
              <strong>🏢 \${esc(g.name)}</strong>
              <span class="badge">\${(g.todayChoices||[]).length} choix aujourd'hui</span>
            </div>
            \${g.orders.length ? \`
            <table class="choice-table" style="margin-top:10px">
              <thead><tr><th>Date</th><th>Repas</th><th>Total</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>\${g.orders.map(o => \`<tr>
                <td>\${fmtDateTime(o.createdAt)}</td>
                <td>\${o.items?.length||0} repas</td>
                <td>\${fmtPrice(o.totalAmount)}</td>
                <td><span class="badge \${o.status}">\${o.status}</span></td>
                <td class="order-btns">\${statusBtns(o)}</td>
              </tr>\`).join('')}</tbody>
            </table>\` : '<p class="empty" style="margin:6px 0">Aucune commande pour cette entreprise.</p>'}
          </div>\`).join('')
      : '<p class="empty">Aucune entreprise affiliée.</p>';

    // Abonnements
    el('rst-subs-list').innerHTML = subs.length
      ? subs.map(s => \`
          <div class="sub-card">
            <span>\${esc(s.enterpriseName)} — <em>\${s.frequency}</em> <span class="badge \${s.status}">\${s.status}</span></span>
            \${s.status === 'pending' ? \`
              <div>
                <button class="btn primary sm" onclick="respondSub('\${s.id}','accepted')">✓ Accepter</button>
                <button class="btn danger sm"  onclick="respondSub('\${s.id}','declined')">✕ Refuser</button>
              </div>\` : ''}
          </div>\`).join('')
      : '<p class="empty">Aucune demande.</p>';

    // Proposer services
    el('rst-enterprises-list').innerHTML = enterprises.map(e => \`
      <div class="ent-row">
        <span>\${esc(e.companyName)}</span>
        \${e.isAffiliated ? '<span class="badge success">Affiliée</span>' : ''}
        \${!e.hasOffer && !e.isAffiliated
          ? \`<button class="btn primary sm" onclick="offerService('\${e.id}')">📤 Proposer</button>\`
          : e.hasOffer && !e.isAffiliated
          ? \`<button class="btn outline sm" onclick="withdrawOffer('\${e.id}')">Retirer l'offre</button>\`
          : ''}
      </div>\`).join('') || '<p class="empty">Aucune entreprise.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

// Créer une facture (restaurant)
async function createInvoice(orderId) {
  try {
    await api('POST', '/api/invoices', { orderId });
    toast('Facture générée et envoyée !', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

// Télécharger une facture (restaurant)
async function downloadInvoice(invoiceId) {
  try {
    const res = await fetch(\`/api/invoices/\${invoiceId}/pdf\`, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { toast('PDF non disponible', 'error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = \`facture-\${invoiceId.slice(0,8)}.pdf\`;
    a.click();
  } catch (e) { toast(e.message, 'error'); }
}`
);

// 4. Update openProfileModal: add specialty checkboxes, remove prof-spec
replace(
`    el('prof-spec').value  = r.specialty || '';`,
`    const spec = Array.isArray(r.specialty) ? r.specialty : (r.specialty ? [r.specialty] : []);
    renderSpecialtyCheckboxes('prof-spec-container', spec);`
);

// 5. Update saveProfile: specialty → collectSpecialties
replace(
`    specialty:      el('prof-spec').value.trim(),`,
`    specialty:      collectSpecialties('prof-spec-container'),`
);

// 6. loadEntToday: rename button + use launchOrder
replace(
`            <button class="btn primary sm" onclick="openOrderModal('\${g.choices[0].restaurantId}')">📦 Commander</button>`,
`            <button class="btn primary sm" onclick="launchOrder('\${g.choices[0].restaurantId}')">🚀 Lancer la commande</button>`
);

// 7. Replace openOrderModal + submitOrder with launchOrder
replace(
`function openOrderModal(restaurantId) {
  _orderRestaurantId = restaurantId;
  el('modal-order-body').innerHTML = \`
    <p>Mode de paiement :</p>
    <label class="radio-row"><input type="radio" name="paymode" value="delivery" checked> 🚚 Livraison (paiement à la livraison)</label>
    <label class="radio-row"><input type="radio" name="paymode" value="upfront"> 💳 Mobile Money (paiement à l'avance)</label>
    <div id="upfront-section" class="hidden" style="margin-top:12px">
      <div class="field-label">Type de paiement</div>
      <input id="dep-type" type="text" placeholder="Ex: OM, Wave…"/>
      <div class="field-label">Capture du dépôt (base64 ou URL)</div>
      <input id="dep-screenshot" type="text" placeholder="Optionnel"/>
    </div>\`;
  document.querySelectorAll('input[name="paymode"]').forEach(r => {
    r.addEventListener('change', () => {
      el('upfront-section').classList.toggle('hidden', r.value !== 'upfront');
    });
  });
  openModal('modal-order');
}

async function submitOrder() {
  const paymentMode = document.querySelector('input[name="paymode"]:checked')?.value;
  const body = { restaurantId: _orderRestaurantId, paymentMode };
  if (paymentMode === 'upfront') {
    body.depositType       = el('dep-type')?.value.trim();
    body.depositScreenshot = el('dep-screenshot')?.value.trim();
  }
  try {
    await api('POST', '/api/orders', body);
    closeModal('modal-order');
    toast('Commande envoyée !', 'success');
    loadEntToday();
  } catch (e) { toast(e.message, 'error'); }
}`,
`async function launchOrder(restaurantId) {
  try {
    await api('POST', '/api/orders', { restaurantId });
    toast('Commande lancée ! Le restaurant a été notifié.', 'success');
    loadEntToday();
  } catch (e) { toast(e.message, 'error'); }
}`
);

// 8. Update switchRestoTab: normalize specialty
replace(
`              \${r.specialty ? \`<p>\${esc(r.specialty)}</p>\` : ''}`,
`              \${r.specialty?.length ? \`<p>\${esc(Array.isArray(r.specialty)?r.specialty.join(', '):r.specialty)}</p>\` : ''}`
);

// 9. buildSidebar: Clientèle → Commandes
replace(
`      { id: 'clientele',  icon: '👥', label: 'Clientèle' },`,
`      { id: 'clientele',  icon: '📦', label: 'Commandes' },`
);

// 10. onPaneLoad: add invoice loading in ent-employees
replace(
`    case 'ent-employees':   loadEntEmployees(); loadEntOrders(); loadEntStats(); break;`,
`    case 'ent-employees':   loadEntEmployees(); loadEntOrders(); loadEntInvoices(); loadEntStats(); break;`
);

// 11. Remove confirm2 from disaffiliate
replace(
`async function disaffiliate(restaurantId) {
  confirm2('Se désaffilier de ce restaurant ?', async () => {
    try {
      await api('DELETE', \`/api/enterprise/restaurants/\${restaurantId}/affiliate\`);
      toast('Désaffilié', 'success');
      loadEntRestaurants();
    } catch (e) { toast(e.message, 'error'); }
  });
}`,
`async function disaffiliate(restaurantId) {
  try {
    await api('DELETE', \`/api/enterprise/restaurants/\${restaurantId}/affiliate\`);
    toast('Désaffilié', 'success');
    loadEntRestaurants();
  } catch (e) { toast(e.message, 'error'); }
}`
);

// 12. Remove confirm2 from deleteEmployee
replace(
`async function deleteEmployee(id) {
  confirm2('Supprimer cet employé ?', async () => {
    try {
      await api('DELETE', \`/api/enterprise/employees/\${id}\`);
      toast('Employé supprimé', 'success');
      loadEntEmployees();
    } catch (e) { toast(e.message, 'error'); }
  });
}`,
`async function deleteEmployee(id) {
  try {
    await api('DELETE', \`/api/enterprise/employees/\${id}\`);
    toast('Employé supprimé', 'success');
    loadEntEmployees();
  } catch (e) { toast(e.message, 'error'); }
}`
);

// 13. doRegister restaurant: specialty → collectSpecialties
replace(
`      const specialty      = el('r-spec').value.trim();`,
`      const specialty      = collectSpecialties('r-spec-container');`
);

// 14. Add loadEntInvoices + confirmInvoice after loadEntOrders
replace(
`async function loadEntStats() {`,
`async function loadEntInvoices() {
  try {
    const invoices = await api('GET', '/api/invoices');
    el('ent-invoices-list').innerHTML = invoices.length
      ? invoices.map(inv => \`
          <div class="order-card invoice-card">
            <div>
              <strong>\${esc(inv.restaurantName)}</strong> — \${fmtDateTime(inv.createdAt)}
              <span class="badge \${inv.status}">\${inv.status === 'sent' ? '📨 Reçue' : inv.status === 'confirmed' ? '✅ Confirmée' : inv.status}</span>
            </div>
            <div>\${inv.number} · \${fmtPrice(inv.totalAmount)} · \${inv.items?.length||0} article(s)</div>
            <div class="order-btns">
              <button class="btn ghost sm" onclick="downloadInvoice('\${inv.id}')">⬇ PDF</button>
              \${inv.status === 'sent' ? \`<button class="btn primary sm" onclick="confirmInvoice('\${inv.id}')">✅ Confirmer réception</button>\` : ''}
            </div>
          </div>\`).join('')
      : '<p class="empty">Aucune facture.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function confirmInvoice(invoiceId) {
  try {
    await api('PUT', \`/api/invoices/\${invoiceId}/confirm\`);
    toast('Réception confirmée !', 'success');
    loadEntInvoices();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadEntStats() {`
);

fs.writeFileSync(path, src, 'utf8');
console.log('Done. Length:', src.length);
