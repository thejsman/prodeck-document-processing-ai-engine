import type { HelpTopic } from '@/lib/help/help-types';

export const gettingStartedTopics: HelpTopic[] = [
  {
    id: 'getting-started',
    title: 'Getting started with ProDeck',
    category: 'getting-started',
    routePatterns: ['/'],
    summary:
      'ProDeck turns your documents and client knowledge into polished proposals, presentations, and shareable microsites — written in your voice and styled in your brand.',
    sections: [
      {
        heading: 'What ProDeck does',
        body: [
          'ProDeck is an AI studio for client work. You bring the raw material — a brief, an RFP, meeting notes, or just a company name — and ProDeck helps you produce finished deliverables:',
          '',
          '- **Proposals** — structured, section-by-section documents you can edit and version.',
          '- **Microsites** — polished, presentation-style web pages you can publish and share.',
          '- **Presentations** — slide decks you can export to PDF or PowerPoint.',
          '- **Documents** — one-off pieces like blogs, briefs, or strategy docs.',
          '',
          'Everything is generated with AI but stays fully editable, so you keep control of the final result.',
        ].join('\n'),
      },
      {
        heading: 'Your first deliverable in four steps',
        body: [
          '1. **Create a client** from the welcome screen or the sidebar (“New Client”). Add the company name, and optionally a website URL so ProDeck can research it.',
          '2. **Open the client workspace** and tell the assistant what you need — for example, “Draft a proposal for a brand refresh”.',
          '3. **Review and edit.** Rewrite any section, adjust the tone, or lock the parts you like so they stay put.',
          '4. **Turn it into a microsite or deck**, then publish or export it to share with your client.',
        ].join('\n'),
      },
      {
        heading: 'Two ways to work',
        body: [
          "There are two starting points, and you can use either:",
          '',
          '- **Super-Client Workspace** — the main hub. You set up a client once, then chat to generate and manage everything for them in one place. Best for ongoing client relationships.',
          '- **Projects (namespaces)** — a document-first workspace. Upload an RFP or brief into a project, then generate a proposal grounded strictly in those documents. Best for a specific engagement built around a set of files.',
        ].join('\n'),
      },
      {
        heading: 'Finding your work later',
        body: [
          'Nothing is lost between sessions:',
          '',
          '- Every client lists its proposals, microsites, decks, and documents in the workspace.',
          '- The **Artifacts** library shows everything you have generated across the app, filterable by type.',
          '- Look for the **?** button anywhere (or press **?** on your keyboard) to open help for whatever you are looking at.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Do I need to upload documents to get started?',
        a: 'No. You can start from just a company name and a website URL. Uploading documents (a brief, RFP, or past work) makes the output more accurate and specific, but it is optional.',
      },
      {
        q: 'Is the AI output final, or can I change it?',
        a: 'You can change everything. Proposals are editable section by section, microsites have a visual editor, and you can regenerate or rewrite any part until it is right.',
      },
      {
        q: 'What is the difference between a client and a project?',
        a: 'A **client** (super-client) is a reusable profile you build once and keep working with. A **project** (namespace) is a document-grounded workspace for a specific engagement. See **Key concepts** for more.',
      },
      {
        q: 'Where do I open help?',
        a: 'Use the floating **?** button (bottom-left), the Help entry in the sidebar, or press the **?** key. The Help panel automatically shows guidance for the page you are on.',
      },
    ],
    related: ['key-concepts', 'super-client-workspace', 'proposals'],
    keywords: ['intro', 'start', 'onboarding', 'begin', 'new', 'welcome', 'basics', 'overview'],
  },
  {
    id: 'key-concepts',
    title: 'Key concepts',
    category: 'getting-started',
    routePatterns: [],
    summary:
      'A quick glossary of the building blocks in ProDeck — clients, projects, artifacts, the knowledge base, and the brand settings that shape every deliverable.',
    sections: [
      {
        heading: 'Clients and projects',
        body: [
          '- **Client (super-client)** — a saved profile for a company you work with. ProDeck remembers what it learns about them across conversations, so every deliverable stays on-brand and on-message.',
          '- **Project (namespace)** — an isolated workspace for one engagement. Documents you upload into a project stay private to that project and power the answers and proposals generated there.',
        ].join('\n'),
      },
      {
        heading: 'Artifacts',
        body: [
          'An **artifact** is anything ProDeck generates for you: a proposal, a microsite, a presentation, or a document. Artifacts are saved automatically and appear both under their client/project and in the central **Artifacts** library.',
        ].join('\n'),
      },
      {
        heading: 'The knowledge base',
        body: [
          'When you upload documents, ProDeck reads them, pulls out the important facts, and files them into a searchable **knowledge base**. Generation then draws on this knowledge so the output reflects your real material rather than guesses.',
        ].join('\n'),
      },
      {
        heading: 'Author Voice and Design Kit',
        body: [
          'Two org-wide settings shape the look and feel of everything you make:',
          '',
          '- **Author Voice** — learned from writing samples you upload, so new content sounds like you.',
          '- **Design Kit** — learned from brand assets you upload, so microsites and decks adopt your colors and style.',
          '',
          'You turn each on or off in the Inspiration area.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can one client’s documents leak into another client’s work?',
        a: 'No. Projects are isolated, and each client keeps its own context and memory. Work generated for one stays scoped to that client or project.',
      },
      {
        q: 'What exactly counts as an artifact?',
        a: 'Proposals, microsites, presentations, and generated documents. Each is versioned and can be reopened, edited, exported, or deleted.',
      },
      {
        q: 'Do I have to set up Author Voice and Design Kit before I start?',
        a: 'No — they are optional boosters. You can generate great work without them, then add them later to make everything sound and look consistently like your brand.',
      },
    ],
    related: ['getting-started', 'super-client-workspace', 'knowledge-base', 'inspiration-context'],
    keywords: ['glossary', 'terms', 'namespace', 'client', 'artifact', 'concept', 'definition'],
  },
];
