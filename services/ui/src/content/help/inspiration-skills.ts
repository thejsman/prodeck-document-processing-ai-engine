import type { HelpTopic } from '@/lib/help/help-types';

export const inspirationSkillsTopics: HelpTopic[] = [
  {
    id: 'inspiration-context',
    title: 'Author Voice & Design Kit',
    category: 'inspiration-skills',
    routePatterns: ['/inspiration-context'],
    summary:
      'Org-wide settings that shape everything you generate: teach ProDeck to write in your voice and apply your brand look to every proposal and microsite.',
    sections: [
      {
        heading: 'Two tabs, one purpose',
        body: [
          'This page holds settings that apply across your whole organization, so you set them up once and every new piece of content benefits. There are two tabs:',
          '',
          '- **Author Voice** — teaches ProDeck how you write.',
          '- **Design Kit** — teaches ProDeck how your brand looks.',
          '',
          'Both are optional, and each has its own on/off switch so you stay in control of when they are applied.',
        ].join('\n'),
      },
      {
        heading: 'Author Voice: sound like you',
        body: [
          'Upload writing samples you are proud of. These can be past proposals or any other writing you like, in a range of formats:',
          '',
          '- PDF, plain text, Markdown, and Word documents',
          '- Images of writing',
          '',
          'ProDeck studies each sample, learns the patterns in how you write, and blends everything into a single Author Voice profile. Turn Author Voice on and new content starts to sound like you.',
          '',
          'It is cumulative and org-wide. Add samples over time to sharpen the voice, and you never have to re-upload the same material.',
        ].join('\n'),
      },
      {
        heading: 'Design Kit: look like your brand',
        body: [
          'On the Assets tab, upload your brand and design files (PNG, JPG, WEBP, GIF, and SVG). ProDeck looks at each one, tags it, and builds a Design Kit that captures your colors, visual style, and key assets.',
          '',
          'You can mark one asset as your primary logo or hero image. Turn the Design Kit on and your microsites and proposals adopt your brand look automatically.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I get ProDeck to write in our style?',
        a: 'Upload a few writing samples on the Author Voice tab, then turn Author Voice on. New content will follow the style ProDeck learns from your samples.',
      },
      {
        q: 'Do I have to upload samples every time I generate something?',
        a: 'No. Author Voice is org-wide and cumulative. Once you add samples they stay, and everything you build can draw on them.',
      },
      {
        q: 'How do I put our branding on the output?',
        a: 'Upload your brand and design assets on the Assets tab, then turn the Design Kit on. Your colors and visual style carry through to microsites and proposals.',
      },
      {
        q: 'How do I set our main logo?',
        a: 'Mark an asset as the primary logo or hero. That tells ProDeck which one to feature first.',
      },
      {
        q: 'Which image types can I upload for the Design Kit?',
        a: 'PNG, JPG, WEBP, GIF, and SVG.',
      },
    ],
    related: ['skills', 'microsites', 'proposals', 'theming'],
    keywords: ['author voice', 'design kit', 'branding', 'writing style', 'assets', 'logo', 'inspiration'],
  },
  {
    id: 'skills',
    title: 'Skills',
    category: 'inspiration-skills',
    routePatterns: ['/skills'],
    summary:
      'A Skill is a saved recipe for producing a type of content, so you get consistent, on-brand results every time.',
    sections: [
      {
        heading: 'What a Skill is',
        body: [
          'A Skill captures how you want a certain kind of deliverable made, and reuses those choices whenever you apply it. That means less setup and more consistency across your work. There are two kinds:',
          '',
          '- **Proposal Skills** — control how proposals are written and structured.',
          '- **Design Skills** — control how microsites look.',
        ].join('\n'),
      },
      {
        heading: 'Proposal Skills',
        body: [
          'A Proposal Skill bundles the choices that shape a proposal:',
          '',
          '- The tone of the writing',
          '- The section structure',
          '- Pricing defaults',
          '- Clarifying questions ProDeck asks you before generating',
          '- The output formats that are allowed',
          '',
          'You can set how strictly the structure is followed:',
          '',
          '- **Free-form** — flexible, ProDeck adapts the sections.',
          '- **Guided** — a suggested structure that can flex.',
          '- **Strict** — the structure must be followed exactly, which is ideal for compliance documents.',
          '',
          'If you already have a proposal you love, you can generate a Skill automatically from it and reuse that shape going forward.',
        ].join('\n'),
      },
      {
        heading: 'Design Skills',
        body: [
          'A Design Skill is a named look-and-feel preset for microsites. Each one bundles:',
          '',
          '- An aesthetic tone, for example editorial, luxury, or minimal',
          '- A color palette',
          '- Typography',
          '',
          'Applying a Design Skill gives a microsite a distinct, cohesive style in one step.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I get consistent output for the same kind of deliverable?',
        a: 'Create a Skill for it, or apply an existing one. The Skill remembers your tone, structure, and other choices so each new piece matches the last.',
      },
      {
        q: 'Can ProDeck ask me questions before it generates?',
        a: 'Yes. A Proposal Skill can include clarifying questions, so ProDeck gathers what it needs before writing.',
      },
      {
        q: 'Can I make a Skill from a proposal I already have?',
        a: 'Yes. You can generate a Proposal Skill automatically from an existing proposal and reuse its structure and tone.',
      },
      {
        q: 'How do I change a microsite whole visual style at once?',
        a: 'Apply a Design Skill. It swaps in a new aesthetic tone, palette, and typography together.',
      },
      {
        q: 'Can I choose fonts and colors?',
        a: 'Yes, within the preset. A Design Skill defines the palette and typography that get applied.',
      },
      {
        q: 'I do not see Skills in the menu. Is it still available?',
        a: 'Yes. Skills may be hidden from the main menu, but the feature is still available to use.',
      },
    ],
    related: ['proposals', 'proposal-templates', 'microsites', 'inspiration-context'],
    keywords: ['skills', 'proposal skill', 'design skill', 'preset', 'structure', 'tone', 'consistency'],
  },
];
