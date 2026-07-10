import puppeteer from 'puppeteer';
import fs from 'fs';
const html = fs.readFileSync('/tmp/new_msite_srcdoc.html', 'utf-8');
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
for (const w of [1039, 900, 700, 1440]) {
  await page.setViewport({ width: w, height: 800 });
  await page.goto('about:blank');
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));
  const overflow = await page.evaluate(() => ({
    htmlScrollWidth: document.documentElement.scrollWidth,
    htmlClientWidth: document.documentElement.clientWidth,
  }));
  console.log(w, JSON.stringify(overflow));
  await page.screenshot({ path: `/tmp/new_shot_${w}.png`, fullPage: true });
}
await browser.close();
