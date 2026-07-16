import type { HelpTopic } from '@/lib/help/help-types';

export const insightsTopics: HelpTopic[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    category: 'insights',
    routePatterns: ['/dashboard'],
    summary:
      'The dashboard gives you a single at-a-glance view of your workspace, from live activity to recent proposals and projects.',
    sections: [
      {
        heading: 'The stat cards',
        body: [
          'At the top of the dashboard are four cards that show live counts of what is happening in your workspace:',
          '',
          '- **Active Executions** — AI tasks that are running right now, such as a proposal or microsite being generated.',
          '- **Ingestion Jobs** — documents currently being read and added to your knowledge.',
          '- **Proposals** — how many proposals you have created this week.',
          '- **Templates** — the templates available for you to start from.',
          '',
          'These numbers update as you work, so the dashboard always reflects the current state of things.',
        ].join('\n'),
      },
      {
        heading: 'Below the cards',
        body: [
          'Under the stat cards you will find everything you need to jump back into your work:',
          '',
          '- **Activity timeline** — a running list of your most recent work, so you can see what happened and when.',
          '- **Quick actions** — shortcuts to common tasks like starting a new proposal or adding documents.',
          '- **Knowledge stats** — a quick look at how much client knowledge you have gathered.',
          '- **Projects** — a list of your projects so you can open one and pick up where you left off.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What do the four stat cards mean?',
        a: 'They are live counts: AI tasks running now, documents being added to your knowledge, proposals you made this week, and the templates you can start from.',
      },
      {
        q: 'Where can I see my recent activity?',
        a: 'The activity timeline, just below the stat cards, lists your most recent work in order so you can retrace your steps.',
      },
      {
        q: 'How do I get back to a project I was working on?',
        a: 'Scroll to the projects list on the dashboard and open the one you want. It takes you straight back into that work.',
      },
      {
        q: 'Do the numbers update on their own?',
        a: 'Yes. The stat cards reflect what is happening as you work, so you do not need to refresh to see the current counts.',
      },
    ],
    related: ['getting-started', 'executions', 'proposals', 'knowledge-base'],
    keywords: ['dashboard', 'overview', 'home', 'stats', 'activity', 'projects', 'timeline'],
  },
  {
    id: 'executions',
    title: 'AI activity & execution trace',
    category: 'insights',
    routePatterns: ['/executions/:id', '/executions'],
    summary:
      'An execution is a tracked AI task, such as generating a proposal or a microsite. You can watch it run step by step and safely carry on with other work while it finishes.',
    sections: [
      {
        heading: 'What an execution is',
        body: [
          'Whenever you ask ProDeck to do a bigger piece of AI work, it becomes an execution you can follow. Common examples are generating a proposal or building a microsite.',
          '',
          'Each execution has its own trace view so you can see exactly what happened, not just the final result.',
        ].join('\n'),
      },
      {
        heading: 'The trace view',
        body: [
          'Open an execution to see how the work unfolded:',
          '',
          '- A **live badge** shows while the task is still running.',
          '- A **step-by-step timeline** lists each stage of the work in order.',
          '- A **summary** gives you the short version of what was done.',
          '- A **detail panel** lets you click any step to see more about it.',
          '',
          'If a step runs into trouble, an **error banner** appears so you know what went wrong.',
        ].join('\n'),
      },
      {
        heading: 'Keeping track anywhere in the app',
        body: [
          'You do not have to sit and wait. A persistent **AI Activity** indicator and drawer follow you around the app, and small pop-up notifications keep you posted on tasks in progress.',
          '',
          'You can move to another page, start something else, or come back later. Your tasks keep running, and you will be notified as they finish.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What exactly is an execution?',
        a: 'It is a tracked AI task, like generating a proposal or a microsite. ProDeck records each step so you can follow along and review it afterwards.',
      },
      {
        q: 'Can I leave the page while a task is running?',
        a: 'Yes. Tasks keep running in the background, the AI Activity indicator keeps track of them, and you are notified when they finish.',
      },
      {
        q: 'Why does it say "Live updates unavailable"?',
        a: 'That means the live connection that streams progress dropped. Your task is not affected. Use the Refresh option to pull in the latest status.',
      },
      {
        q: 'How do I know if something failed?',
        a: 'The trace view shows an error banner on the step that ran into trouble, so you can see what went wrong and where.',
      },
      {
        q: 'Where do I find tasks that are still running?',
        a: 'Open the AI Activity indicator and drawer, available anywhere in the app, to see everything in progress at a glance.',
      },
    ],
    related: ['dashboard', 'proposals', 'microsites', 'getting-started'],
    keywords: ['executions', 'trace', 'ai activity', 'progress', 'status', 'timeline', 'tasks', 'live'],
  },
];
