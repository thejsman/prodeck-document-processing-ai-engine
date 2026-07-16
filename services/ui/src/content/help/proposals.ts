import type { HelpTopic } from '@/lib/help/help-types';

export const proposalsTopics: HelpTopic[] = [
  {
    id: 'proposals',
    title: 'Proposals',
    category: 'proposals',
    routePatterns: ['/proposal', '/proposals', '/proposals/:id'],
    summary:
      'A proposal is a full, structured document built from your documents and a chosen template, split into sections you can edit, rewrite, lock, version, and export.',
    sections: [
      {
        heading: 'What a proposal is',
        body: [
          'A proposal is a complete client-ready document assembled from your uploaded documents and the template you picked. It comes broken into clear parts, for example:',
          '',
          '- **Executive summary** — the short version that busy readers see first.',
          '- **Problem statement** — the challenge you are solving.',
          '- **Approach** — how you plan to solve it.',
          '- **Timeline** — the phases and dates.',
          '- **Pricing** — what it costs.',
          '',
          'Each part is its own editable **section**. You work section by section, so you can polish one piece at a time instead of wrestling with the whole document at once. ProDeck keeps the sections consistent with each other, so details like the timeline, pricing, and overall tone stay in step across the whole proposal.',
        ].join('\n'),
      },
      {
        heading: 'Editing and improving a section',
        body: [
          'For any section you have four ways to change it:',
          '',
          '- **Edit directly** — click into the section and type your own changes, just like a normal document.',
          '- **Improve with AI** — ask ProDeck to make the section clearer or more persuasive while keeping your meaning.',
          '- **Regenerate** — throw out the current wording and let ProDeck write the section fresh.',
          '- **Change tone** — nudge the section to be more formal, more persuasive, or shorter.',
          '',
          'There is also a **Rewrite section with AI instructions** action. Use this when you want to tell ProDeck exactly what to do in your own words, for example "mention our 24/7 support" or "make this sound warmer and less corporate". You give the instruction and only that section is rewritten.',
          '',
          'When you want a bigger reset, there is a button that **regenerates the entire proposal** at once. Locked sections (see below) are left untouched.',
        ].join('\n'),
      },
      {
        heading: 'Locking sections you are happy with',
        body: [
          'Once a section is exactly how you want it, you can **lock** it. A locked section shows a **Locked** badge and is protected: it will not be changed when you regenerate other sections or the whole proposal, and AI improvements will skip it.',
          '',
          'This is the safest way to freeze wording you have carefully approved, for example a pricing table or a legal line, while you keep experimenting with the rest of the document.',
          '',
          'To make changes again, simply **unlock** the section. The badge disappears and editing, rewriting, and regeneration are allowed once more.',
        ].join('\n'),
      },
      {
        heading: 'Versions, status, and export',
        body: [
          'Every edit you make is saved automatically as a **version**, so your earlier work is never lost. From the version history you can:',
          '',
          '- **View version history** — see the list of saved versions over time.',
          '- **Roll back** — restore an earlier version if a change did not work out.',
          '- **Compare two versions** — open a side-by-side diff to see exactly what changed between them.',
          '',
          'A proposal also moves through a **status** as it matures, for example from draft to approved, so everyone can tell where it stands.',
          '',
          'When the proposal is ready, use **Export** to save the finished document and share it with your client.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I edit just one part without redoing the whole thing?',
        a: 'Yes. Every section is independent, so you can edit, improve, rewrite, or regenerate a single section and leave the rest exactly as it is.',
      },
      {
        q: 'Will editing lose my earlier version?',
        a: 'No. Every edit is saved as its own version. You can open the version history at any time and roll back to an earlier one.',
      },
      {
        q: 'How do I stop a section from being regenerated?',
        a: 'Lock it. A locked section shows a Locked badge and is skipped whenever you regenerate other sections or the whole proposal.',
      },
      {
        q: 'Why is a section showing as locked?',
        a: 'Because it was locked (by you or a teammate) to protect the wording. Unlock it whenever you want to allow edits and regeneration again.',
      },
      {
        q: 'Can I compare two versions?',
        a: 'Yes. Open the version history and choose two versions to see a side-by-side diff of exactly what changed.',
      },
      {
        q: 'How do I ask AI for a very specific change?',
        a: 'Use the Rewrite section with AI instructions action on that section. Type what you want in plain words, and only that section is rewritten to match.',
      },
    ],
    related: ['proposal-templates', 'version-history', 'microsites', 'export-formats'],
    keywords: ['proposal', 'section', 'rewrite', 'regenerate', 'lock', 'version', 'export', 'tone'],
  },
  {
    id: 'proposal-templates',
    title: 'Proposal templates',
    category: 'proposals',
    routePatterns: ['/proposal/templates'],
    summary:
      'Templates are reusable proposal blueprints that define which sections a proposal should include and what each one should cover.',
    sections: [
      {
        heading: 'What a template does',
        body: [
          'A template is a reusable blueprint for a proposal. It decides which sections a new proposal starts with and what each section is meant to cover, so you do not have to build the structure from scratch every time.',
          '',
          'ProDeck can **recommend the best-fit template** for you by looking at the documents you have uploaded and matching them to the closest one. You can also pick a template yourself.',
        ].join('\n'),
      },
      {
        heading: 'Creating and managing your own',
        body: [
          'You are not limited to the built-in blueprints. You can:',
          '',
          '- **Create** your own template with the sections and structure you use most.',
          '- **Edit** an existing template as your needs change.',
          '- **Delete** templates you no longer want.',
          '',
          'When you name a template you give it a short slug, for example "sales-brief", which acts as its handy short name in the list.',
          '',
          'If you would rather not build one by hand, the **AI Template Builder** can generate a full template for you. Describe what you need and it drafts the sections, which you can then adjust.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I define my own proposal structure?',
        a: 'Yes. Create your own template with exactly the sections you want, then reuse it for future proposals.',
      },
      {
        q: 'How does ProDeck pick a template for me?',
        a: 'It looks at the documents you have uploaded and recommends the template that most closely matches them. You can always override its choice.',
      },
      {
        q: 'Can AI build a template for me?',
        a: 'Yes. Use the AI Template Builder to generate a template automatically, then edit the sections to suit your style.',
      },
      {
        q: 'What is the slug when I name a template?',
        a: 'It is a short, simple name for the template, for example "sales-brief", used to identify it in your template list.',
      },
    ],
    related: ['proposals', 'inspiration-context', 'admin-templates'],
    keywords: ['template', 'blueprint', 'sections', 'builder', 'reusable', 'slug', 'structure'],
  },
];
