'use client';

import { normalizeMicrositeHtml } from '@/lib/microsite-bridge';

export function MicrositeV2Frame({ html }: { html: string }) {
  return (
    <iframe
      srcDoc={normalizeMicrositeHtml(html)}
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
      title="Microsite"
    />
  );
}
