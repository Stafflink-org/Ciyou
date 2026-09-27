// « Voir comme le restaurant » de bout en bout : ouverture de la session par la
// Cloud Function, connexion de l'administrateur dans l'espace restaurant avec
// ?voir-comme=, contrôle de la lecture seule et du bandeau, puis fin de session.
//
// Usage : node scripts/tests/a-restaurants-clients.impersonation.mjs [port de l'espace restaurant]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import puppeteer from 'puppeteer-core';
import { db } from '../lib/admin.mjs';

const port = process.argv[2] ?? '5173';
const out = process.env.OUT ?? '.smoke';
const accounts = readFileSync('.test-accounts.local.md', 'utf8');
const email = 'superadmin@golink.test';
const password = [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const app = initializeApp({ apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM', authDomain: 'golink-9f16d.firebaseapp.com', projectId: 'golink-9f16d', appId: '1:683198090102:web:3640bfa24dd0d325910857' });
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, email, password);
const call = (name, data) => httpsCallable(getFunctions(app, 'europe-west1'), name)(data).then((r) => r.data);

const session = await call('startImpersonation', { restaurantId: 'mina-kitchen', reason: 'Contrôle automatisé de l’affichage', durationMinutes: 15 });
console.log('Session ouverte', session.sessionId);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let ok = true;
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height: 900 });
    await page.goto(`http://localhost:${port}/?voir-comme=mina-kitchen`, { waitUntil: 'networkidle0', timeout: 90_000 });
    if (page.url().includes('/connexion')) {
      await page.type('input[type=email]', email);
      await page.type('input[autocomplete=current-password]', password);
      await page.click('button[type=submit]');
      await page.waitForFunction(() => !location.pathname.startsWith('/connexion'), { timeout: 30_000 });
    }
    await new Promise((r) => setTimeout(r, 6000));
    const report = await page.evaluate(() => ({
      banner: document.querySelector('[role=status]')?.textContent ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    await page.screenshot({ path: join(out, `restaurant-arc-voir-comme-${width}.png`) });
    console.log(width, JSON.stringify(report), errors.slice(0, 3));
    if (!report.banner?.includes('Lecture seule') || report.overflow > 0) ok = false;
    await page.close();
  }
} finally {
  await browser.close();
  await call('endImpersonation', { sessionId: session.sessionId });
  const snap = await db.doc(`impersonationSessions/${session.sessionId}`).get();
  console.log('Session terminée :', Boolean(snap.get('endedAt')));
  await signOut(auth);
  await deleteApp(app);
}
process.exit(ok ? 0 : 1);
