// Poster for a PR comment: a frame of the video with a big ▶ and a caption, rendered with the
// runner's Chromium (no image libs, same fonts everywhere). The comment links it to the player.
// usage: node poster.mjs <frame.png> <out.png> "<caption>"
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const [frame, out, caption = 'Play the demo'] = process.argv.slice(2);
const src = `data:image/png;base64,${readFileSync(frame).toString('base64')}`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(`<!doctype html><html><body style="margin:0">
<div style="position:relative;width:1280px;height:800px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
  <img src="${src}" style="width:100%;height:100%;object-fit:cover;filter:brightness(.62)">
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px">
    <div style="width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.95);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 40px rgba(0,0,0,.45)">
      <div style="width:0;height:0;border-top:34px solid transparent;border-bottom:34px solid transparent;border-left:56px solid #111827;margin-left:14px"></div>
    </div>
    <div style="color:#fff;font-size:40px;font-weight:700;line-height:1.25;text-shadow:0 2px 12px rgba(0,0,0,.6);max-width:1080px;text-align:center">${esc(caption)}</div>
  </div>
</div></body></html>`);
await page.waitForLoadState('load');
await page.screenshot({ path: out });
await browser.close();
