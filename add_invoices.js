const fs = require('fs');
const path = 'F:/Arlette/FoodChoose/lunchapp/server.js';
let src = fs.readFileSync(path, 'utf8');

const anchor = '// ─────────────────────────────────────────────────────────────────────────────\n// ABONNEMENTS';
const idx = src.indexOf(anchor);
if (idx === -1) { console.log('ANCHOR NOT FOUND'); process.exit(1); }

const invoiceRoutes = `// ─────────────────────────────────────────────────────────────────────────────
// FACTURES (INVOICES)
// ─────────────────────────────────────────────────────────────────────────────

// Créer une facture (restaurant pour une entreprise)
app.post('/api/invoices', auth, requireRole('restauratrice'), async (req, res) => {
  const { orderId, frequency } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId requis' });

  const orders = read('orders');
  const order  = orders.find(o => o.id === orderId && o.restaurantId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  const existingInvoices = read('invoices');
  if (existingInvoices.find(i => i.orderId === orderId))
    return res.status(409).json({ error: 'Facture déjà générée pour cette commande' });

  const restaurant  = read('restaurants').find(r => r.id === req.user.id) || {};
  const enterprises = read('enterprises');
  const enterprise  = enterprises.find(e => e.id === order.enterpriseId) || {};

  // Agréger les articles
  const itemMap = {};
  (order.items || []).forEach(it => {
    if (it.foodItem)  { const k = it.foodItem.name;  itemMap[k] = { name: k, qty: (itemMap[k]?.qty||0)+1, unitPrice: it.foodItem.price||0 }; }
    if (it.drinkItem) { const k = it.drinkItem.name; itemMap[k] = { name: k, qty: (itemMap[k]?.qty||0)+1, unitPrice: it.drinkItem.price||0 }; }
  });
  const items = Object.values(itemMap).map(i => ({ ...i, total: i.qty * i.unitPrice }));

  const now  = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const dateISO = now.toISOString().slice(0, 10);
  const invId   = uid();
  const invNum  = \`FACT-\${dateISO.replace(/-/g,'')}-\${invId.slice(0,6).toUpperCase()}\`;

  const invoice = {
    id: invId, number: invNum,
    restaurantId: req.user.id, restaurantName: req.user.restaurantName,
    enterpriseId: order.enterpriseId, enterpriseName: order.enterpriseName,
    orderId, date: dateISO, items,
    totalAmount: order.totalAmount || 0,
    frequency: frequency || 'monthly',
    status: 'sent',
    createdAt: now.toISOString(),
  };

  try {
    const buf  = await buildInvoicePDF(invoice, restaurant, enterprise, invNum, dateStr);
    invoice.pdfBase64 = buf.toString('base64');
  } catch (e) {
    console.error('PDF invoice error:', e.message);
  }

  existingInvoices.push(invoice);
  write('invoices', existingInvoices);

  pushNotif(order.enterpriseId, 'enterprise', 'new_invoice', '🧾 Nouvelle facture',
    \`\${req.user.restaurantName} vous a envoyé une facture de \${(order.totalAmount||0).toLocaleString('fr-FR')} FCFA (commande du \${order.date}).\`,
    { invoiceId: invId, invoiceNumber: invNum });

  const { pdfBase64: _, ...safe } = invoice;
  res.status(201).json(safe);
});

// Lister les factures
app.get('/api/invoices', auth, requireRole('enterprise', 'restauratrice'), (req, res) => {
  let invoices = read('invoices');
  if (req.user.role === 'enterprise')    invoices = invoices.filter(i => i.enterpriseId === req.user.id);
  if (req.user.role === 'restauratrice') invoices = invoices.filter(i => i.restaurantId === req.user.id);
  res.json(invoices.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    .map(({ pdfBase64: _, ...i }) => i));
});

// Télécharger le PDF d'une facture
app.get('/api/invoices/:id/pdf', auth, requireRole('enterprise', 'restauratrice'), (req, res) => {
  const inv = read('invoices').find(i => i.id === req.params.id &&
    (i.enterpriseId === req.user.id || i.restaurantId === req.user.id));
  if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
  if (!inv.pdfBase64) return res.status(404).json({ error: 'PDF non disponible' });
  const buf = Buffer.from(inv.pdfBase64, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', \`attachment; filename="\${inv.number}.pdf"\`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

// Confirmer réception d'une facture (enterprise)
app.put('/api/invoices/:id/confirm', auth, requireRole('enterprise'), (req, res) => {
  const invoices = read('invoices');
  const idx = invoices.findIndex(i => i.id === req.params.id && i.enterpriseId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Facture introuvable' });
  invoices[idx].status      = 'confirmed';
  invoices[idx].confirmedAt = new Date().toISOString();
  write('invoices', invoices);
  pushNotif(invoices[idx].restaurantId, 'restauratrice', 'invoice_confirmed', '✅ Facture confirmée',
    \`\${req.user.companyName} a confirmé la réception de la facture \${invoices[idx].number}.\`,
    { invoiceId: invoices[idx].id });
  res.json(invoices[idx]);
});

`;

src = src.slice(0, idx) + invoiceRoutes + src.slice(idx);

// ─── buildInvoicePDF ─────────────────────────────────────────────────────────
const pdfAnchor = 'function buildPDF(blocks)';
const pdfIdx = src.indexOf(pdfAnchor);
if (pdfIdx === -1) { console.log('PDF ANCHOR NOT FOUND'); process.exit(1); }

const buildInvoicePDFFn = `function buildInvoicePDF(invoice, restaurant, enterprise, invNum, dateStr) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;
    const M  = 40;
    const CW = PW - M * 2;

    // ── Bandeau orange ──────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 70).fill('#F97316');
    doc.fontSize(26).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('LunchApp', M, 18, { width: CW/2, lineBreak: false });
    doc.fontSize(11).font('Helvetica').fillColor('#FFF7ED')
      .text('Gestion des repas d\\'entreprise', M, 46, { width: CW/2, lineBreak: false });
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('FACTURE', M + CW/2, 22, { width: CW/2, align: 'right', lineBreak: false });
    doc.fontSize(10).font('Helvetica').fillColor('#FFF7ED')
      .text(invNum, M + CW/2, 46, { width: CW/2, align: 'right', lineBreak: false });

    // ── Infos restaurant / entreprise ───────────────────────────────────────
    const infoY = 88;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#F97316')
      .text('DE :', M, infoY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1E293B')
      .text(restaurant.restaurantName || invoice.restaurantName, M, infoY + 14);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(restaurant.address || '', M, infoY + 27)
      .text(restaurant.phone   || '', M, infoY + 39);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#F97316')
      .text('FACTURÉ À :', M + CW/2, infoY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1E293B')
      .text(enterprise.companyName || invoice.enterpriseName, M + CW/2, infoY + 14);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(enterprise.email    || '', M + CW/2, infoY + 27)
      .text(enterprise.phone    || '', M + CW/2, infoY + 39);

    // Date + référence commande
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(\`Date : \${dateStr}   ·   Commande : \${invoice.orderId?.slice(0,8).toUpperCase() || '—'}\`, M, infoY + 56);

    // ── Séparateur ──────────────────────────────────────────────────────────
    const sepY = infoY + 74;
    doc.moveTo(M, sepY).lineTo(PW-M, sepY).strokeColor('#E2E8F0').lineWidth(1).stroke();

    // ── Tableau des articles ─────────────────────────────────────────────────
    const cols  = [30, 220, 80, 95, 90]; // N°, Article, Qté, Prix unit., Total
    const heads = ['N°', 'Article', 'Qté', 'Prix unit.', 'Total FCFA'];
    const RH    = 24;
    let ty = sepY + 14;

    // En-tête tableau
    doc.rect(M, ty, CW, RH).fill('#1E293B');
    let cx = M;
    heads.forEach((h, i) => {
      const align = i >= 2 ? 'right' : 'left';
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
        .text(h, cx + 5, ty + 7, { width: cols[i] - 10, lineBreak: false, align });
      cx += cols[i];
    });
    ty += RH;

    // Lignes
    (invoice.items || []).forEach((item, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(M, ty, CW, RH).fillAndStroke(bg, '#E2E8F0');
      cx = M;
      const cells = [
        String(idx + 1), item.name || '—',
        String(item.qty || 1),
        \`\${(item.unitPrice||0).toLocaleString('fr-FR')}\`,
        \`\${(item.total||0).toLocaleString('fr-FR')}\`,
      ];
      cells.forEach((cell, i) => {
        const align = i >= 2 ? 'right' : 'left';
        doc.fontSize(9).font('Helvetica').fillColor('#334155')
          .text(cell, cx + 5, ty + 7, { width: cols[i] - 10, lineBreak: false, align, ellipsis: true });
        cx += cols[i];
      });
      ty += RH;
    });

    if (!(invoice.items || []).length) {
      doc.rect(M, ty, CW, RH).fill('#FAFAFA');
      doc.fontSize(9).font('Helvetica').fillColor('#94A3B8')
        .text('Aucun article', M, ty + 7, { width: CW, align: 'center', lineBreak: false });
      ty += RH;
    }

    // ── Ligne total ──────────────────────────────────────────────────────────
    ty += 6;
    doc.rect(M + CW - 185, ty, 185, 28).fill('#FFF7ED');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#F97316')
      .text(\`TOTAL  \${(invoice.totalAmount||0).toLocaleString('fr-FR')} FCFA\`,
        M, ty + 7, { width: CW, align: 'right', lineBreak: false });
    ty += 28;

    // ── Pied de page ────────────────────────────────────────────────────────
    ty += 20;
    doc.rect(0, ty, PW, 1).fill('#E2E8F0');
    ty += 10;
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text('Paiement à la livraison', M, ty, { continued: true })
      .text('LunchApp — Tous droits réservés', { align: 'right' });
    doc.fontSize(8).fillColor('#94A3B8')
      .text(\`Généré le \${dateStr} · \${invNum}\`, M, ty + 16, { align: 'center', width: CW });

    doc.end();
  });
}

`;

src = src.slice(0, pdfIdx) + buildInvoicePDFFn + src.slice(pdfIdx);
fs.writeFileSync(path, src, 'utf8');
console.log('Done. Length:', src.length);
