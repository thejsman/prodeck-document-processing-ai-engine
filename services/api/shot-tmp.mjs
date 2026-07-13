import puppeteer from 'puppeteer';
import fs from 'fs';

const html = fs.readFileSync('/tmp/msite.html', 'utf-8');
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 700 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/shot_900.png', fullPage: false });

// Check actual scrollWidth vs clientWidth to detect real overflow
const overflow = await page.evaluate(() => {
  const html = document.documentElement;
  const body = document.body;
  return {
    htmlScrollWidth: html.scrollWidth,
    htmlClientWidth: html.clientWidth,
    bodyScrollWidth: body.scrollWidth,
    bodyClientWidth: body.clientWidth,
  };
});
console.log(JSON.stringify(overflow, null, 2));
await browser.close();
