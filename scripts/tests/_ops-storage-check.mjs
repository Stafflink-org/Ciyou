import { readFileSync } from 'node:fs';
const accounts = readFileSync('.test-accounts.local.md', 'utf8');
const email = process.argv[2];
const pw = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const key = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw, returnSecureToken: true }) }).then((x) => x.json());
for (const p of process.argv.slice(3)) {
  const res = await fetch(`https://firebasestorage.googleapis.com/v0/b/golink-9f16d.firebasestorage.app/o/${encodeURIComponent(p)}`, { headers: { Authorization: `Firebase ${r.idToken}` } });
  console.log(p, res.status, (await res.text()).slice(0, 200));
}
