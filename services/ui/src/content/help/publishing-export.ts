import type { HelpTopic } from '@/lib/help/help-types';

export const publishingExportTopics: HelpTopic[] = [
  {
    id: 'microsite-publishing',
    title: 'Publishing a microsite',
    category: 'publishing-export',
    routePatterns: [],
    summary:
      'Once your microsite looks right, you can download it, share a preview link, or publish it live on a subdomain or your own custom domain.',
    sections: [
      {
        heading: 'Ways to share your microsite',
        body: [
          'When a microsite is finished, you have a few ways to get it in front of people:',
          '',
          '- **Download the HTML file** — a single, self-contained web page you can save, email, or host anywhere.',
          '- **Share a preview link** — a quick way to send the microsite to someone without publishing it live.',
          '- **Publish to a subdomain** — pick a name (for example your-microsite) and ProDeck hosts it at a ready-to-share web address.',
          '- **Publish to your own custom domain** — an advanced option for putting the site on an address you own.',
        ].join('\n'),
      },
      {
        heading: 'Publishing to a subdomain',
        body: [
          'This is the simplest way to put a microsite live. Choose a name for the site, and ProDeck gives you a shareable web address right away.',
          '',
          'If you want to keep it private, turn on password protection and set a password of at least 6 characters. Anyone who opens the link will see a password gate before they can view the site.',
        ].join('\n'),
      },
      {
        heading: 'Publishing to your own custom domain',
        body: [
          'If you want the microsite to live on an address you own (for example deck.yourdomain.com), you can publish to a custom domain. This is an advanced option and takes a few extra steps:',
          '',
          '1. Enter the address you want to use, such as deck.yourdomain.com.',
          '2. ProDeck shows you the CNAME DNS records to add. Copy these into the settings at your domain provider (wherever you manage that domain).',
          '3. Wait for the domain and its security certificate to verify. This can take a little time.',
          '',
          'You can also set a password on a custom domain, just like a subdomain.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I share a microsite?',
        a: 'You have several options: download it as an HTML file, send a preview link, or publish it live on a subdomain or your own custom domain.',
      },
      {
        q: 'Can I use my own domain?',
        a: 'Yes. Choose the custom domain option, enter your address (for example deck.yourdomain.com), and add the CNAME records ProDeck shows you at your domain provider.',
      },
      {
        q: 'Can I password-protect a published microsite?',
        a: 'Yes. Turn on password protection and set a password of at least 6 characters. Visitors will see a password gate before they can view the site.',
      },
      {
        q: 'Why is my custom domain not live yet?',
        a: 'After you add the DNS records, the domain and its security certificate still need to verify, and that can take some time. Once verification finishes, the site goes live.',
      },
      {
        q: 'What is the difference between a preview link and publishing?',
        a: 'A preview link is a fast way to show someone the microsite. Publishing puts it live at a stable web address on a subdomain or your own domain, with the option to protect it with a password.',
      },
    ],
    related: ['microsites', 'microsite-editor', 'export-formats', 'version-history'],
    keywords: ['publish', 'share', 'domain', 'subdomain', 'password', 'link', 'cname', 'live'],
  },
  {
    id: 'export-formats',
    title: 'Exporting to PDF, PowerPoint & HTML',
    category: 'publishing-export',
    routePatterns: [],
    summary:
      'You can save your finished work in the formats you need, including PDF, PowerPoint, Word, and a standalone web page.',
    sections: [
      {
        heading: 'Exporting decks and microsites',
        body: [
          'Decks and microsites can be saved in a few different formats depending on how you plan to use them:',
          '',
          '- **PDF** — a fixed, easy-to-send file that looks the same everywhere.',
          '- **PowerPoint (PPTX)** — an editable slide file you can open in PowerPoint.',
          '- **HTML** — a single, self-contained web page you can host or share.',
        ].join('\n'),
      },
      {
        heading: 'Exporting generated documents',
        body: [
          'Documents you generate can be exported to a wider set of formats, so you can drop them into whatever tool you already work in:',
          '',
          '- PDF',
          '- Word',
          '- PowerPoint',
          '- RTF',
          '- Notion',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I get a Word or PDF file?',
        a: 'Yes. Generated documents can be exported to PDF, Word, and several other formats.',
      },
      {
        q: 'Can I export a deck to PowerPoint?',
        a: 'Yes. You can export a deck as a PowerPoint (PPTX) file and keep editing it in PowerPoint.',
      },
      {
        q: 'Can I get a standalone web page?',
        a: 'Yes. You can publish or download a self-contained HTML file that works on its own, without any extra setup.',
      },
      {
        q: 'Which formats can I use for a document?',
        a: 'Generated documents export to PDF, Word, PowerPoint, RTF, and Notion.',
      },
    ],
    related: ['microsite-publishing', 'microsites', 'proposals', 'deck-orientation'],
    keywords: ['export', 'pdf', 'powerpoint', 'pptx', 'word', 'html', 'notion', 'download'],
  },
  {
    id: 'deck-orientation',
    title: 'Slide orientation (16:9 vs 9:16)',
    category: 'publishing-export',
    routePatterns: [],
    summary:
      'Slide decks come in two shapes: wide landscape (16:9) for standard presentations, and tall portrait (9:16) for phone and social viewing.',
    sections: [
      {
        heading: 'The two deck shapes',
        body: [
          'Every deck is built in one of two shapes:',
          '',
          '- **16:9 (landscape)** — the standard widescreen presentation shape. This is the default.',
          '- **9:16 (portrait)** — a tall, vertical shape made for phone-first or social viewing.',
        ].join('\n'),
      },
      {
        heading: 'How ProDeck chooses the shape',
        body: [
          'ProDeck reads the shape from how you phrase your request. If you mention "9:16" or ask for a "vertical" deck, you get the portrait shape. Anything else stays in the standard landscape shape.',
          '',
          'The orientation you choose sets the shape of the on-screen preview and the size of your exported PDF and PowerPoint files, so what you see matches what you send.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I make a vertical or portrait deck?',
        a: 'Ask for a "9:16" or "vertical" deck when you make your request, and ProDeck builds it in the tall portrait shape.',
      },
      {
        q: 'Why is my deck widescreen?',
        a: 'Landscape (16:9) is the default. Unless you ask for a vertical or 9:16 deck, you get the standard widescreen shape.',
      },
      {
        q: 'Why did the preview shape change?',
        a: 'The preview always matches the deck orientation, so a switch between landscape and portrait changes the shape you see on screen.',
      },
      {
        q: 'Does orientation affect my exports?',
        a: 'Yes. The orientation sets the dimensions of your exported PDF and PowerPoint files, so they match the shape shown in the preview.',
      },
    ],
    related: ['export-formats', 'microsites', 'microsite-editor'],
    keywords: ['orientation', 'landscape', 'portrait', 'vertical', '16:9', '9:16', 'slides', 'shape'],
  },
  {
    id: 'version-history',
    title: 'Versions & snapshots',
    category: 'publishing-export',
    routePatterns: [],
    summary:
      'Your work is protected as you go. You can save named checkpoints, browse past versions, compare changes, and roll back whenever you need to.',
    sections: [
      {
        heading: 'Snapshots and history for microsites',
        body: [
          'Microsites give you two ways to go back in time:',
          '',
          '- **Snapshots** — named checkpoints you save yourself. Save one before a big change, then restore it later if you need to. You can save, restore, and delete snapshots at any time.',
          '- **History** — a list of past generations of the microsite. You can restore an earlier one or remove entries you no longer need.',
        ].join('\n'),
      },
      {
        heading: 'Version history for proposals',
        body: [
          'Proposals keep a full version history as you work. You can:',
          '',
          '- Open any two versions side by side and compare them with a diff to see exactly what changed.',
          '- Roll back to an earlier version whenever you want.',
          '',
          'Nothing is thrown away, so earlier versions stay available even after you make new changes.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I undo a big change?',
        a: 'Yes. Restore a saved snapshot or roll back to an earlier version to return to how things were before the change.',
      },
      {
        q: 'Can I compare versions?',
        a: 'Yes. On a proposal you can open the diff to see two versions side by side and spot exactly what changed.',
      },
      {
        q: 'Are my older versions kept?',
        a: 'Yes. Nothing is overwritten. Earlier versions and generations remain available so you can always go back.',
      },
      {
        q: 'What is the difference between a snapshot and history?',
        a: 'A snapshot is a named checkpoint you save on purpose, while history is the running list of past generations. You can restore from either one.',
      },
    ],
    related: ['proposals', 'microsites', 'microsite-editor', 'artifacts-library'],
    keywords: ['version', 'snapshot', 'history', 'restore', 'rollback', 'diff', 'compare', 'undo'],
  },
];
