import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => console.log('BROWSER:', m.text().slice(0,200)));
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.evaluate(() => localStorage.setItem('ai-engine-api-key', 'admin-key'));

await page.goto('http://localhost:3001/super-client/cloud-9?open=microsite&id=2026-07-09T10-08-46-934-ih3n', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: '/tmp/real_app_1440.png', fullPage: false });

const overflow = await page.evaluate(() => ({
  htmlScrollWidth: document.documentElement.scrollWidth,
  htmlClientWidth: document.documentElement.clientWidth,
}));
console.log('page-level overflow:', JSON.stringify(overflow));

const frames = page.frames();
console.log('frame count:', frames.length);
for (const f of frames) {
  try {
    const info = await f.evaluate(() => ({
      url: location.href.slice(0,60),
      scrollWidth: document.documentElement?.scrollWidth,
      clientWidth: document.documentElement?.clientWidth,
    }));
    console.log('frame:', JSON.stringify(info));
  } catch (e) { console.log('frame err', e.message); }
}
await browser.close();
