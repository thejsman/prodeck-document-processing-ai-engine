import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => localStorage.setItem('ai-engine-api-key', 'admin-key'));
await page.goto('http://localhost:3001/super-client/cloud-9', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.chat-side-panel', { timeout: 30000 });

const layout = async (label) => {
  const s = await page.evaluate(() => {
    const rp = document.querySelector('.chat-side-panel');
    const panels = Array.from(document.querySelectorAll('.sc-viewer-panel')).map(p => ({
      open: p.className.includes('--open'), w: Math.round(p.getBoundingClientRect().width),
    })).filter(p => p.w > 0);
    return { rightPanelWidth: rp ? Math.round(rp.getBoundingClientRect().width) : -1, openViewers: panels };
  });
  console.log(`[${label}] rightPanel=${s.rightPanelWidth}px  openViewer=${JSON.stringify(s.openViewers)}`);
};

const openFromArtifacts = async (kind) => {
  // ensure Artifacts tab
  await page.evaluate(() => { const t=[...document.querySelectorAll('button,div')].find(e=>/^Artifacts/.test(e.textContent||'')); t&&t.click(); });
  await new Promise(r=>setTimeout(r,600));
  const clicked = await page.evaluate((kind) => {
    const rows = Array.from(document.querySelectorAll('.client-panel-row'));
    // pick a row under the matching section by icon text label
    const row = rows.find(r => (r.innerText||'').length>0);
    return false;
  }, kind);
};

await layout('no viewer');
// open a proposal (reference) by clicking first proposal row
await page.evaluate(() => { const t=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && /^Artifacts/.test(e.textContent||'')); t&&t.click(); });
await new Promise(r=>setTimeout(r,500));
// click first .client-panel-row that is a proposal (has 'Proposal'? too fragile) — just click rows and check
const rows = await page.$$('.client-panel-row');
console.log('artifact rows found:', rows.length);
