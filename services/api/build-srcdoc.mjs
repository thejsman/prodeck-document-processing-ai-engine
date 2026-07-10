import fs from 'fs';

const CURSOR_RESET_CSS = `<style id="__preview-cursor-reset">
html,body{max-width:none!important;margin-left:0!important;margin-right:0!important;width:100%!important;}
body{overflow-x:clip!important;}
script,style,noscript,template{display:none!important;visibility:hidden!important;}
*,*::before,*::after{cursor:auto!important}
*{animation:none!important}
</style>`;

const NAV_FIX_SCRIPT = `<script id="__nav-anchor-fix">document.addEventListener('click',function(e){if(window.__editMode)return;var a=e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var href=a.getAttribute('href');if(!href||href==='#')return;var id=href.slice(1);var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el)el.scrollIntoView({behavior:'smooth'});},true);</script>`;

function normalizeMicrositeHtml(html) {
  let out = html;
  const headClose = out.indexOf('</head>');
  out = headClose !== -1 ? out.slice(0, headClose) + CURSOR_RESET_CSS + out.slice(headClose) : CURSOR_RESET_CSS + out;
  const bodyOpen = out.search(/<body[^>]*>/i);
  if (bodyOpen !== -1) {
    const tagEnd = out.indexOf('>', bodyOpen) + 1;
    out = out.slice(0, tagEnd) + NAV_FIX_SCRIPT + out.slice(tagEnd);
  } else {
    out = NAV_FIX_SCRIPT + out;
  }
  return out;
}

const raw = fs.readFileSync('/tmp/msite.html', 'utf-8');
fs.writeFileSync('/tmp/msite_srcdoc.html', normalizeMicrositeHtml(raw));
console.log('written');
