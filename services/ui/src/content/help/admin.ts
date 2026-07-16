import type { HelpTopic } from '@/lib/help/help-types';

export const adminTopics: HelpTopic[] = [
  {
    id: 'admin',
    title: 'Administration',
    category: 'admin',
    routePatterns: ['/admin'],
    summary:
      'Administration is the hub for behind-the-scenes settings that fine-tune how ProDeck generates your work. Most of it is set up once and rarely touched again.',
    sections: [
      {
        heading: 'What lives here',
        body: [
          'Administration gathers the optional, advanced settings in one place. From here you can reach:',
          '',
          '- **Projects** — create, rename, and delete the isolated workspaces you work in.',
          '- **Memory** — the durable facts the AI keeps in mind when it writes for you.',
          '- **Configuration** — the deeper engine settings that control how generation runs.',
          '- **Templates** — the proposal sections that decide what a generated proposal covers.',
        ].join('\n'),
      },
      {
        heading: 'When to come here',
        body: [
          'You do not need to visit Administration to use ProDeck day to day. Come here when you want to tune the defaults, correct a fact the AI keeps getting wrong, or manage the projects and templates behind your work.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What is in Administration?',
        a: 'Four areas: Projects, Memory, Configuration, and Templates. Each one adjusts a different part of how ProDeck behaves.',
      },
      {
        q: 'Do I need to change these settings to use ProDeck?',
        a: 'No. Everything here is optional fine-tuning. The defaults work well, and you can generate proposals and microsites without ever opening Administration.',
      },
      {
        q: 'Who should use these settings?',
        a: 'Anyone can, but they are most useful once you have used ProDeck for a while and want to shape its output more precisely.',
      },
    ],
    related: ['namespaces', 'admin-memory', 'admin-config', 'admin-templates'],
    keywords: ['admin', 'settings', 'configuration', 'management', 'setup', 'options'],
  },
  {
    id: 'admin-config',
    title: 'Configuration',
    category: 'admin',
    routePatterns: ['/admin/config'],
    summary:
      'Configuration holds the deeper engine settings for a project that control how generation runs. It is advanced, and most people never need to touch it.',
    sections: [
      {
        heading: 'What Configuration does',
        body: [
          'Each project has its own set of engine settings that shape how ProDeck produces work for it. Configuration is where those settings live.',
          '',
          'These are the deeper controls behind generation, separate from everyday choices like which client or template you pick. They come with sensible defaults that suit most people.',
        ].join('\n'),
      },
      {
        heading: 'Editing with care',
        body: [
          'Because these settings affect how every generation behaves for the project, change them only when you have a clear reason to. If you are unsure, leaving the defaults in place is the safe choice.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What does Configuration control?',
        a: 'The per-project engine settings that determine how generation runs for that project.',
      },
      {
        q: 'Should I edit it?',
        a: 'Only if you know you need to. The defaults work well for most users, so there is no need to change anything unless you have a specific goal in mind.',
      },
      {
        q: 'Does Configuration apply to all my projects?',
        a: 'No. These settings belong to one project at a time, so a change here does not affect your other projects.',
      },
    ],
    related: ['admin', 'namespaces', 'admin-memory'],
    keywords: ['config', 'configuration', 'settings', 'engine', 'advanced', 'project'],
  },
  {
    id: 'admin-memory',
    title: 'Memory',
    category: 'admin',
    routePatterns: ['/admin/memory'],
    summary:
      'Memory is the set of durable facts the proposal generator keeps in mind when it writes. You can view and edit it to correct or add details that should shape future output.',
    sections: [
      {
        heading: 'What Memory is',
        body: [
          'As ProDeck works, it builds up a set of lasting facts about your work and reuses them whenever it generates something new. Memory is where you can see those facts laid out.',
          '',
          'Think of it as the background knowledge the AI carries from one proposal to the next, so it does not have to relearn the same details every time.',
        ].join('\n'),
      },
      {
        heading: 'Why edit it',
        body: [
          'Editing Memory lets you steer future output directly:',
          '',
          '- **Correct** a fact the AI has been getting wrong.',
          '- **Add** a detail you want it to remember and use going forward.',
          '- **Remove** something that is out of date or no longer relevant.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What is Memory?',
        a: 'The durable facts the AI reuses whenever it generates, so it keeps important details in mind from one piece of work to the next.',
      },
      {
        q: 'Why would I edit it?',
        a: 'To correct or add facts that should shape future proposals, so the AI produces more accurate and on-point results.',
      },
      {
        q: 'Will editing Memory change past work?',
        a: 'No. Memory guides what gets generated next. Anything you already produced stays exactly as it was.',
      },
    ],
    related: ['admin', 'admin-config', 'knowledge-base', 'proposals'],
    keywords: ['memory', 'facts', 'knowledge', 'remember', 'context', 'edit'],
  },
  {
    id: 'admin-templates',
    title: 'Template manager',
    category: 'admin',
    routePatterns: ['/admin/templates'],
    summary:
      'The template manager is where you manage the proposal-section templates that decide which sections a generated proposal includes and what each one covers.',
    sections: [
      {
        heading: 'What these templates do',
        body: [
          'A proposal template is the blueprint for a generated proposal. It sets out which sections appear and what each section is meant to cover, so every proposal follows a consistent structure.',
          '',
          'Adjusting a template changes the shape of the proposals you generate from it going forward.',
        ].join('\n'),
      },
      {
        heading: 'The admin view of your templates',
        body: [
          'These are the same templates you choose from when you generate a proposal. This page is simply the management view, where you can review and organize them in one place rather than pick one to use.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What are these templates?',
        a: 'They define the sections a generated proposal includes and what each section covers.',
      },
      {
        q: 'How is this different from the Templates page I use when generating?',
        a: 'They are the same templates. This is the admin management view for reviewing and organizing them, while the generating flow is where you pick one to use.',
      },
      {
        q: 'Will changing a template affect proposals I already made?',
        a: 'No. Changes apply to proposals you generate afterward. Existing proposals are not rewritten.',
      },
    ],
    related: ['proposal-templates', 'proposals', 'admin'],
    keywords: ['templates', 'sections', 'proposal', 'manager', 'structure', 'blueprint'],
  },
  {
    id: 'namespaces',
    title: 'Projects (namespaces)',
    category: 'admin',
    routePatterns: ['/admin/namespaces'],
    summary:
      'Projects, also called namespaces, are isolated workspaces, each with its own documents and knowledge. This is where you create, rename, and delete them.',
    sections: [
      {
        heading: 'What a project is',
        body: [
          'A project is a self-contained workspace. Each one has its own documents and its own knowledge, and they stay separate from one another so work for one client never mixes with another.',
          '',
          'You may also see projects referred to as namespaces. They are the same thing.',
        ].join('\n'),
      },
      {
        heading: 'Creating, switching, and managing',
        body: [
          '- **Create** a project here, or from the sidebar.',
          '- **Switch** the active project using the Project selector in the top bar.',
          '- **Rename or delete** a project from this page.',
          '',
          'Because a deleted project cannot be brought back, ProDeck asks you to confirm before removing one.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I create a project?',
        a: 'Use the create action on this page, or create one from the sidebar.',
      },
      {
        q: 'How do I switch between projects?',
        a: 'Use the Project selector in the top bar to change which project is active.',
      },
      {
        q: 'Is deleting a project reversible?',
        a: 'No. Deletion is permanent, which is why you are asked to confirm before it happens.',
      },
      {
        q: 'Does each project keep its documents separate?',
        a: 'Yes. Every project is an isolated workspace with its own documents and knowledge, so nothing carries over between them.',
      },
    ],
    related: ['admin', 'key-concepts', 'knowledge-base', 'ingestion'],
    keywords: ['projects', 'namespaces', 'workspace', 'create', 'switch', 'delete'],
  },
  {
    id: 'eval',
    title: 'Evaluation',
    category: 'admin',
    routePatterns: ['/eval'],
    summary:
      'Evaluation is a planned area for checking the quality of generated work. It is not available yet.',
    sections: [
      {
        heading: 'Coming soon',
        body: [
          'Evaluation will be a place to review and measure the quality of what ProDeck generates. It is still in the works, so for now the page shows a coming soon message and there is nothing to set up.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Is Evaluation available?',
        a: 'Not yet. It is coming soon, and the page currently shows a placeholder message.',
      },
    ],
    related: ['admin', 'executions'],
    keywords: ['evaluation', 'eval', 'quality', 'coming soon', 'testing', 'review'],
  },
];
