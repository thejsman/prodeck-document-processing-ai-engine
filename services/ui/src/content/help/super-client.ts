import type { HelpTopic } from '@/lib/help/help-types';

export const superClientTopics: HelpTopic[] = [
  {
    id: 'super-client-workspace',
    title: 'Super-Client Workspace',
    category: 'super-client',
    routePatterns: ['/super-client/:name', '/super-client'],
    summary:
      'The all-in-one hub for a single client, where you chat with an assistant and turn that conversation into finished proposals, microsites, presentations, and documents.',
    sections: [
      {
        heading: 'What the workspace is for',
        body: [
          'A Super-Client Workspace is a home base for everything you do for one client. You talk to the assistant on the left about that client, and the work you ask for is created for you right there.',
          '',
          'From a single conversation you can produce every kind of deliverable:',
          '',
          '- **Proposals** — structured documents you can view and edit.',
          '- **Microsites** — polished, shareable web pages.',
          '- **Presentations** — slide decks you can export.',
          '- **Documents** — written deliverables you can export.',
          '',
          'The assistant stays focused on this one client. It works fast, hands you finished results, and remembers what it learns so each conversation is smarter than the last.',
        ].join('\n'),
      },
      {
        heading: 'How the screen is laid out',
        body: [
          'The workspace has three parts:',
          '',
          '- **Chat on the left** — where you describe what you want and attach images or logos.',
          '- **Preview panel in the middle** — slides in when you open something you made, so you can view or edit it. Drag the divider to resize it.',
          '- **Info rail on the right** — two tabs that keep everything about the client in one place.',
          '',
          'The **Context** tab holds the client profile and memory, an editable website address you can pull fresh details from, and logo management. The **Artifacts** tab is a single list of everything you have made for the client, and each item has a menu to view it or delete it.',
        ].join('\n'),
      },
      {
        heading: 'Editing what you make',
        body: [
          'When you open a deliverable, it appears in a resizable preview pane that matches its type:',
          '',
          '- **Microsite** — a live preview with an edit toggle. Click any element to change it, use undo and redo, watch for the unsaved-changes marker, then publish or download as a PDF.',
          '- **Proposal** — view and edit the content directly.',
          '- **Presentation** — a strip of slides you can edit one at a time, then export to PDF or PowerPoint.',
          '- **Document** — view the content and export it.',
        ].join('\n'),
      },
      {
        heading: 'Starting a client and getting good results',
        body: [
          'You create a client once from a company name, plus an optional website address or a few notes. ProDeck researches that into a starting profile so the assistant knows who it is working for from day one.',
          '',
          'Before it builds something, the assistant may show a short question card or ask for a missing profile detail, such as the type of project. Answering keeps the result on target.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How is a super-client different from a regular project?',
        a: 'A super-client is tied to a saved client and its growing profile, and it is built to hand you finished deliverables on demand. It is less about managing steps and more about producing polished work for that specific client.',
      },
      {
        q: 'Does it remember past conversations?',
        a: 'Yes. The workspace keeps a growing memory about the client, so details you share and things it learns carry over from one chat to the next.',
      },
      {
        q: 'Can I ask it general questions?',
        a: 'No. The assistant stays scoped to work for this client. Off-topic requests are politely declined and it redirects you back to what you would like to make for the client.',
      },
      {
        q: 'What do I need to create a client?',
        a: 'Just a company name to start. Adding a website address or a few notes lets ProDeck build a richer profile, which makes everything the assistant produces more accurate.',
      },
      {
        q: 'Where do I find the files I have made?',
        a: 'Open the Artifacts tab in the right-hand rail. It lists every microsite, proposal, presentation, and document created for the client, and each one has a menu to view or delete it.',
      },
      {
        q: 'Can I add images or a logo to what I am making?',
        a: 'Yes. You can attach images and logos directly to the chat, and manage the client logo from the Context tab.',
      },
    ],
    related: ['getting-started', 'artifacts-library', 'microsites', 'proposals'],
    keywords: ['super-client', 'workspace', 'client hub', 'assistant', 'chat', 'deliverables', 'artifacts'],
  },
];
