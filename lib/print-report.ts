/**
 * Printable cut list (and optional quote) as a standalone HTML document.
 * Printed through a hidden iframe so it works the same in browsers and in
 * the desktop app; "Save as PDF" in the print dialog makes the PDF.
 */
import { edgeCutsOf, mitreStrips } from "@/lib/edges";
import { outlineOnSlab, pieceHoles, placement, type Project } from "@/lib/model";
import { cutList, quote, type Pricing } from "@/lib/production";
import { pathD, pieceOutline, pointInPolygon } from "@/lib/shapes";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function slabDrawing(pr: Project, slabId: string) {
  const slab = pr.slabs.find((s) => s.id === slabId)!;
  const pad = Math.max(slab.w, slab.h) * 0.03;
  const font = Math.max(slab.w, slab.h) * 0.022;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${slab.w}" height="${slab.h}" fill="#fafafa" stroke="#222" stroke-width="${font * 0.12}"/>`);
  if (pr.margin > 0)
    parts.push(`<rect x="${pr.margin}" y="${pr.margin}" width="${slab.w - 2 * pr.margin}" height="${slab.h - 2 * pr.margin}" fill="none" stroke="#999" stroke-width="${font * 0.06}" stroke-dasharray="${font * 0.4} ${font * 0.3}"/>`);
  pr.pieces.forEach((p, i) => {
    if (p.slab !== slabId) return;
    const pl = placement(p);
    const holes = pieceHoles(p).map((h) => pathD(h.map(pl.slab))).join("");
    parts.push(`<path d="${pathD(outlineOnSlab(p))}${holes}" fill-rule="evenodd" fill="#e8efe0" stroke="#111" stroke-width="${font * 0.1}"/>`);
    for (const s of mitreStrips(pieceOutline(p), edgeCutsOf(p), slab.thickness))
      parts.push(`<path d="${pathD(s.pts.map(pl.slab))}" fill="${s.cut === "below" ? "#e0a542" : "#3fa7b3"}"/>`);
    // Number on the stone: the centre, unless that falls in an opening.
    const centre = { x: p.w / 2, y: p.h / 2 };
    const inHole = pieceHoles(p).some((h) => pointInPolygon(centre, h));
    const c = pl.slab(inHole ? { x: Math.min(p.w * 0.12, 160), y: Math.min(p.h * 0.22, 160) } : centre);
    parts.push(`<circle cx="${c.x}" cy="${c.y}" r="${font * 0.9}" fill="#111"/><text x="${c.x}" y="${c.y + font * 0.35}" font-size="${font}" text-anchor="middle" fill="#fff" font-weight="700">${i + 1}</text>`);
  });
  parts.push(`<text x="${slab.w / 2}" y="${-pad * 0.35}" font-size="${font}" text-anchor="middle">${slab.w} mm</text>`);
  parts.push(`<text transform="translate(${-pad * 0.35} ${slab.h / 2}) rotate(-90)" font-size="${font}" text-anchor="middle">${slab.h} mm</text>`);
  return `<svg viewBox="${-pad} ${-pad} ${slab.w + 2 * pad} ${slab.h + 2 * pad}" class="drawing">${parts.join("")}</svg>`;
}

export function reportHtml(pr: Project, opts: { quote?: Pricing } = {}) {
  const list = cutList(pr);
  const date = new Date().toLocaleDateString();
  const slabs = list
    .map(
      (s) => `
  <section class="slab">
    <h2>Slab ${s.number}: ${esc(s.slab.name)} <small>${s.slab.w} × ${s.slab.h} × ${s.slab.thickness} mm · used ${s.usedM2.toFixed(2)} of ${s.slabM2.toFixed(2)} m² (${((s.usedM2 / s.slabM2) * 100).toFixed(1)}%)</small></h2>
    ${slabDrawing(pr, s.slab.id)}
    <p class="legend"><span class="sw below"></span> 45° mitre below <span class="sw above"></span> 45° mitre above · dashed: edge trim ${pr.margin} mm · saw gap ${pr.kerf} mm</p>
    ${
      s.pieces.length
        ? `<table>
      <thead><tr><th>#</th><th>Piece</th><th>Shape</th><th>Size (mm)</th><th>On slab</th><th>Edges</th><th>Openings</th><th>m²</th></tr></thead>
      <tbody>${s.pieces
        .map(
          (c) => `<tr>
        <td><b>${c.number}</b></td><td>${esc(c.piece.name)}</td><td>${esc(c.shape)}</td><td>${c.size}</td>
        <td>X ${c.position.x}, Y ${c.position.y}${c.angle ? `, ${c.angle}°` : ""}</td>
        <td>${c.edges.map((e) => `${e.side}: ${e.cut === "Straight" ? esc(e.finish) : esc(e.cut)} (${e.lengthMm})`).join("<br>")}</td>
        <td>${c.openings.length ? c.openings.map((o) => `${esc(o.label)} ${o.size} ${o.kind}<br><small>${esc(o.position)}</small>`).join("<br>") : "—"}</td>
        <td>${c.areaM2.toFixed(3)}</td></tr>`,
        )
        .join("")}</tbody></table>`
        : `<p class="muted">No pieces on this slab.</p>`
    }
  </section>`,
    )
    .join("");
  let quoteHtml = "";
  if (opts.quote) {
    const q = quote(pr, opts.quote), cur = esc(opts.quote.currency);
    quoteHtml = `
  <section class="quote">
    <h2>Quote</h2>
    <table>
      <thead><tr><th>Item</th><th class="n">Quantity</th><th class="n">Price</th><th class="n">Total</th></tr></thead>
      <tbody>${q.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${l.qty.toFixed(l.unit === "pcs" ? 0 : 2)} ${l.unit}</td><td class="n">${money(l.price, cur)}</td><td class="n">${money(l.total, cur)}</td></tr>`).join("")}</tbody>
      <tfoot>
        <tr><td colspan="3">Subtotal</td><td class="n">${money(q.subtotal, cur)}</td></tr>
        <tr><td colspan="3">VAT ${opts.quote.vat}%</td><td class="n">${money(q.vat, cur)}</td></tr>
        <tr class="total"><td colspan="3">Total</td><td class="n">${money(q.total, cur)}</td></tr>
      </tfoot>
    </table>
  </section>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pr.name)} – cut list</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 11px/1.45 Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  header h1 { font-size: 18px; margin: 0; letter-spacing: .04em; }
  header span { color: #555; }
  .slab { margin-bottom: 18px; }
  .drawing, tr, h2, .legend { break-inside: avoid; page-break-inside: avoid; }
  h2 { break-after: avoid; page-break-after: avoid; }
  .slab + .slab { break-before: page; page-break-before: always; }
  h2 { font-size: 14px; margin: 0 0 6px; } h2 small { font-weight: 400; color: #555; font-size: 11px; }
  .drawing { width: 100%; max-height: 105mm; display: block; }
  .drawing text { font-family: inherit; }
  .legend { color: #555; margin: 4px 0 8px; } .sw { display: inline-block; width: 18px; height: 6px; vertical-align: middle; margin: 0 4px 0 10px; } .sw.below { background: #e0a542; } .sw.above { background: #3fa7b3; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; } th { background: #f0f0f0; font-weight: 600; }
  td small { color: #555; } .n { text-align: right; white-space: nowrap; } .muted { color: #777; }
  .quote { break-before: page; page-break-before: always; } .quote table { max-width: 160mm; } tfoot td { font-weight: 600; } tr.total td { font-size: 13px; border-top: 2px solid #111; }
</style></head><body>
<header><h1>PRELA STONE STUDIO · ${esc(pr.name)}</h1><span>${date} · ${pr.pieces.length} pieces · ${pr.slabs.length} slab${pr.slabs.length === 1 ? "" : "s"} · planning document, confirm on site</span></header>
${slabs}${quoteHtml}
</body></html>`;
}

/** Print an HTML document through a hidden iframe (Save as PDF from the dialog). */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (doc.readyState === "complete") setTimeout(go, 100);
  else frame.onload = go;
}
