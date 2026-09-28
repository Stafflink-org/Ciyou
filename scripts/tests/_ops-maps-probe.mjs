import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const url of process.argv.slice(2)) {
  const p = await b.newPage(); const errs=[];
  p.on('console', m => m.type()==='error' && errs.push(m.text().slice(0,120)));
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(()=>{});
  await new Promise(r=>setTimeout(r,2000));
  console.log(url, errs);
}
await b.close();
