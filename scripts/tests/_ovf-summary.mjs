import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const agg = {};
for (const p of r.pages) {
  if (p.error) console.log('ERR', p.url, p.error);
  const all = [...p.measures.map((m) => ({ ...m, dlg: false })), ...p.dialogs.map((d) => ({ ...d, dlg: d.label }))];
  for (const m of all) {
    if (m.docScroll > 1) { const k = 'DOCSCROLL | ' + p.url; (agg[k] ??= { n: 0, pages: new Set(), w: new Set() }).w.add(m.width); }
    for (const i of m.issues) {
      const k = i.type + ' | ' + (m.dlg ? '[dlg ' + m.dlg + '] ' : '') + i.el.replace(/ « .*/, '').slice(0, 110);
      const a = (agg[k] ??= { n: 0, pages: new Set(), w: new Set(), d: i.detail });
      a.pages.add(p.url); a.w.add(m.width);
    }
  }
}
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].pages.size - a[1].pages.size).slice(0, +(process.argv[3] ?? 40)))
  console.log(v.pages.size + 'p', [...v.w].join('/'), k, '::', v.d ?? '', [...v.pages].slice(0, 2).join(','));
