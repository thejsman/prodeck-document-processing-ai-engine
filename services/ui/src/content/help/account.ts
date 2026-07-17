import type { HelpTopic } from '@/lib/help/help-types';

export const accountTopics: HelpTopic[] = [
  {
    id: 'api-key-connect',
    title: 'Connecting & disconnecting',
    category: 'account',
    routePatterns: [],
    summary:
      'ProDeck unlocks when you enter your API key on the connect screen, and you can sign out any time with Disconnect.',
    sections: [
      {
        heading: 'Getting in',
        body: [
          'ProDeck is unlocked with an API key. When you open the app, you land on the connect screen. Paste your key there and you are in.',
          '',
          'Until you enter a valid key, nothing else loads. This is the one step between you and the rest of ProDeck.',
        ].join('\n'),
      },
      {
        heading: 'Signing out',
        body: [
          'To sign out, use **Disconnect**. You will find it in two places:',
          '',
          '- The **sidebar footer** on the left.',
          '- The **top bar** at the top of the screen.',
          '',
          'Disconnecting clears your key and returns you to the connect screen. Enter your key again whenever you want to come back.',
        ].join('\n'),
      },
      {
        heading: 'No accounts to manage',
        body: [
          'There are no sign-ups, passwords, or billing screens. Your key is stored locally in your browser on this device, so you stay connected between visits without logging in again.',
          '',
          'Because the key lives in your browser, disconnecting or clearing your browser data will sign you out.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I get in?',
        a: 'Enter your API key on the connect screen. Once it is accepted, the rest of the app loads.',
      },
      {
        q: 'How do I disconnect?',
        a: 'Use **Disconnect** in the sidebar footer or the top bar. This clears your key and sends you back to the connect screen.',
      },
      {
        q: 'Where is my key stored?',
        a: 'Locally, in your browser on this device. It is not tied to an online account.',
      },
      {
        q: 'Do I need to create an account or set up billing?',
        a: 'No. There are no accounts, passwords, or billing to manage. All you need is your API key.',
      },
      {
        q: 'Why does nothing load before I connect?',
        a: 'ProDeck stays locked until you enter a valid key. Once you connect, everything becomes available.',
      },
      {
        q: 'Will I have to reconnect later?',
        a: 'Only if you disconnect or clear your browser data. Otherwise your key is remembered on this device.',
      },
    ],
    related: ['getting-started', 'theming', 'key-concepts'],
    keywords: ['api key', 'connect', 'disconnect', 'sign out', 'login', 'unlock', 'access'],
  },
  {
    id: 'theming',
    title: 'Light & dark theme',
    category: 'account',
    routePatterns: [],
    summary:
      'ProDeck comes in light and dark themes, and your choice is remembered the next time you open the app.',
    sections: [
      {
        heading: 'Switching themes',
        body: [
          'ProDeck supports both a light and a dark look. Use the **theme toggle** to switch between them whenever you like.',
          '',
          'You will find the toggle in two spots:',
          '',
          '- The **top bar**, once you are connected.',
          '- The **welcome screen**, before you connect.',
        ].join('\n'),
      },
      {
        heading: 'Your choice is remembered',
        body: [
          'Once you pick a theme, ProDeck saves it. The next time you open the app, it opens in the same look you chose, so you only need to set it once.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'How do I switch to light mode?',
        a: 'Use the theme toggle in the top bar or on the welcome screen to flip between light and dark.',
      },
      {
        q: 'Does it remember my choice?',
        a: 'Yes. Your theme preference is saved and used again the next time you open ProDeck.',
      },
      {
        q: 'Where is the theme toggle?',
        a: 'It is in the top bar when you are signed in, and on the welcome screen before you connect.',
      },
      {
        q: 'Can I change themes as often as I want?',
        a: 'Yes. Switch back and forth any time. ProDeck simply remembers whatever you last chose.',
      },
    ],
    related: ['api-key-connect', 'getting-started', 'microsite-editor'],
    keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'toggle', 'display', 'colors'],
  },
];
