import type { HelpTopic } from '@/lib/help/help-types';

export const micrositesTopics: HelpTopic[] = [
  {
    id: 'microsites',
    title: 'Microsites & presentations',
    category: 'microsites',
    routePatterns: ['/microsite', '/presentation'],
    summary:
      'A microsite is a polished, presentation-style web page built from a proposal or from a website you point it at. The builder walks you from setup to a live preview.',
    sections: [
      {
        heading: 'What a microsite is',
        body: [
          'A microsite turns your work into a client-facing web page that looks like a presentation. You can create one in two ways:',
          '',
          '- **From a proposal** — pick a project and a proposal, or arrive already linked from a proposal you were editing.',
          '- **From a website** — point the builder at a web address and it studies that brand to shape the design.',
          '',
          'Either way, the builder guides you step by step and ends with a preview you can review before sharing.',
        ].join('\n'),
      },
      {
        heading: 'Using a website as a reference',
        body: [
          'Paste a website address and ProDeck reads that site to inform your design. It picks up:',
          '',
          '- The brand identity (look and feel).',
          '- Content highlights such as calls to action, testimonials, case studies, and pricing.',
          '',
          'If a site blocks automated visits, you will see a "blocked" note. When that happens, skip the website step and design from a theme or from your proposal instead.',
        ].join('\n'),
      },
      {
        heading: 'Design choices',
        body: [
          'Before you generate, you can set the overall look:',
          '',
          '- **Typography** — heading and body font pairings.',
          '- **Style** — the general visual feel.',
          '- **Color palette** — the colors used throughout.',
          '- **Layout structure** — how content is arranged, for example an image-heavy layout.',
          '',
          'You can browse ready-made themes or generate without one. You also add client details like the name, a tagline, and a logo so the page feels personal.',
        ].join('\n'),
      },
      {
        heading: 'Classic and Pro modes',
        body: [
          'There are two ways to build:',
          '',
          '- **Classic** — a guided experience that is quick and simple.',
          '- **Pro** — an advanced mode with finer, element-level control.',
          '',
          'After you generate, you can preview the result and regenerate if you want a different direction.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I turn a proposal into something client-facing?',
        a: 'Generate a microsite from it. Pick the project and proposal (or start from the proposal you were editing), choose your design, and generate a polished page you can share.',
      },
      {
        q: 'Can I use an existing website as a design reference?',
        a: 'Yes. Paste the website address and ProDeck reads that site to pull in its brand look and content highlights, then uses them to shape your design.',
      },
      {
        q: 'What is the difference between Classic and Pro?',
        a: 'Classic is a guided, simpler build. Pro is the advanced mode that gives you finer, element-level control over the design.',
      },
      {
        q: 'Why did importing from a website fail?',
        a: 'The site may block automated access. When that happens you will see a "blocked" note. Try designing from a theme or straight from your proposal instead.',
      },
      {
        q: 'Do I have to pick a theme?',
        a: 'No. You can browse themes for a head start, or generate without one and set the typography, style, colors, and layout yourself.',
      },
    ],
    related: ['proposals', 'microsite-editor', 'microsite-editor-pro', 'microsite-publishing'],
    keywords: ['microsite', 'presentation', 'website', 'design', 'theme', 'generate', 'preview'],
  },
  {
    id: 'microsite-editor',
    title: 'Microsite editor (Classic)',
    category: 'microsites',
    routePatterns: ['/microsite-editor/:namespace/:proposalId', '/microsite-editor'],
    summary:
      'The Classic visual editor lets you shape your microsite with a simple toolbar, drag-to-reorder sections, and an AI panel that can redesign or rewrite parts for you.',
    sections: [
      {
        heading: 'What the toolbar gives you',
        body: [
          'The Classic editor keeps everything within reach in one toolbar:',
          '',
          '- **Section outline** — drag to reorder sections, or duplicate a section.',
          '- **Editor / Live Preview toggle** — switch between working and seeing the result.',
          '- **Undo and Redo** — step back and forward through your changes.',
          '- **Color palette editor** — adjust the colors.',
          '- **Typography** — change the font pairing.',
          '- **Switch Theme** — apply a whole new look instantly.',
        ].join('\n'),
      },
      {
        heading: 'Designing with AI',
        body: [
          'The Design AI panel lets you ask for changes in plain words. You can ask it to redesign, restyle, or rewrite parts of the page.',
          '',
          'When it returns a result, you choose whether to **Apply** it or **Revert** and keep what you had. Nothing changes until you decide.',
        ].join('\n'),
      },
      {
        heading: 'Saving and previewing',
        body: [
          'Your work auto-saves about every 60 seconds, so you do not have to remember to save.',
          '',
          'To see the page exactly as your audience will, turn on **Preview Mode** with Ctrl+Shift+P. It hides all the editor controls so nothing is in the way. When you are happy, publish or export straight from the editor.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I tweak the design with AI?',
        a: 'Yes. Use the Design AI panel to ask for a redesign, a restyle, or a rewrite of part of the page, then Apply the result or Revert it.',
      },
      {
        q: 'Does my work save automatically?',
        a: 'Yes. The editor auto-saves about every 60 seconds.',
      },
      {
        q: 'How do I see it the way the client would?',
        a: 'Turn on Preview Mode with Ctrl+Shift+P. It hides every editor control so you see the microsite exactly as your audience will.',
      },
      {
        q: 'How do I reorder sections?',
        a: 'Drag them into the order you want in the section outline. You can also duplicate a section from there.',
      },
      {
        q: 'How do I change the overall look at once?',
        a: 'Use Switch Theme to apply a whole new look instantly, or adjust the color palette and typography for smaller changes.',
      },
    ],
    related: ['microsites', 'microsite-editor-pro', 'microsite-publishing', 'export-formats'],
    keywords: ['editor', 'classic', 'design ai', 'auto-save', 'preview', 'sections', 'theme'],
  },
  {
    id: 'microsite-editor-pro',
    title: 'Microsite editor (Pro)',
    category: 'microsites',
    routePatterns: ['/microsite-editor-pro/:namespace/:proposalId', '/microsite-editor-pro'],
    summary:
      'The Pro editor is for hands-on, detailed design work. It adds element-level control on top of everything in the Classic editor.',
    sections: [
      {
        heading: 'What Pro adds',
        body: [
          'Pro includes everything in the Classic editor and adds finer control over individual elements:',
          '',
          '- **Command palette** — open it with Cmd/Ctrl+K for quick actions.',
          '- **Click-to-edit** — edit inline elements right where they sit.',
          '- **Per-section edit overlay** — focus on one section at a time.',
          '- **Add-section button** — drop in new sections as you go.',
          '- **Color palette editor** and **typography picker** — fine-tune the look.',
          '- **Pro Design AI panel** — ask AI for changes with the same Apply or Revert control.',
        ].join('\n'),
      },
      {
        heading: 'When to use Pro',
        body: [
          'Reach for Pro when you want precise control over individual elements rather than whole sections. It is the right choice for detailed polish and careful, hands-on adjustments.',
          '',
          'If you just want a quick, guided build, the Classic editor is the simpler place to start.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How is Pro different from Classic?',
        a: 'Pro adds element-level inline editing and a command palette, so you can fine-tune individual elements instead of only working section by section.',
      },
      {
        q: 'How do I open the command palette?',
        a: 'Press Cmd/Ctrl+K to open it and run quick actions.',
      },
      {
        q: 'When should I use Pro instead of Classic?',
        a: 'Use Pro when you want to fine-tune individual elements with precise control. Use Classic when you want a quicker, guided build.',
      },
      {
        q: 'Can I still use AI in the Pro editor?',
        a: 'Yes. The Pro Design AI panel works the same way, letting you ask for changes and then Apply or Revert the result.',
      },
    ],
    related: ['microsites', 'microsite-editor', 'microsite-publishing', 'theming'],
    keywords: ['pro', 'editor', 'command palette', 'inline', 'element', 'advanced', 'design'],
  },
];
