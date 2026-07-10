import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.evaluate(() => localStorage.setItem('ai-engine-api-key', 'admin-key'));

await page.goto('http://localhost:3001/super-client/cloud-9?open=microsite&id=2026-07-09T10-08-46-934-ih3n', { waitUntil: 'domcontentloaded', timeout: 20000 });
await new Promise(r => setTimeout(r, 3500));

// Click "Full screen" button
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const btn = btns.find(b => b.textContent?.trim().includes('Full screen'));
  if (btn) { btn.click(); return true; }
  return false;
});
console.log('clicked full screen:', clicked);
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/fullscreen_shot.png', fullPage: false });

const overflow = await page.evaluate(() => ({
  htmlScrollWidth: document.documentElement.scrollWidth,
  htmlClientWidth: document.documentElement.clientWidth,
}));
console.log('page overflow:', JSON.stringify(overflow));

const frames = page.frames();
for (const f of frames) {
  try {
    const info = await f.evaluate(() => ({
      url: location.href.slice(0,50),
      scrollWidth: document.documentElement?.scrollWidth,
      clientWidth: document.documentElement?.clientWidth,
    }));
    console.log('frame:', JSON.stringify(info));
  } catch (e) {}
}
await browser.close();
