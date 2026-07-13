import puppeteer from 'puppeteer';
import fs from 'fs';

const html = fs.readFileSync('/tmp/msite_srcdoc.html', 'utf-8');
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

for (const w of [900, 1000, 1200, 700, 500]) {
  await page.setViewport({ width: w, height: 700 });
  await page.goto('about:blank');
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));
  const overflow = await page.evaluate(() => ({
    htmlScrollWidth: document.documentElement.scrollWidth,
    htmlClientWidth: document.documentElement.clientWidth,
  }));
  console.log(w, JSON.stringify(overflow));
  if (overflow.htmlScrollWidth > overflow.htmlClientWidth) {
    await page.screenshot({ path: `/tmp/shot_srcdoc_${w}.png`, fullPage: false });
  }
}
await browser.close();
