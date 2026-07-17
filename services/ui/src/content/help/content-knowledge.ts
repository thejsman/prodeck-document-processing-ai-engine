import type { HelpTopic } from '@/lib/help/help-types';

export const contentKnowledgeTopics: HelpTopic[] = [
  {
    id: 'artifacts-library',
    title: 'Artifacts library',
    category: 'content-knowledge',
    routePatterns: ['/artifacts'],
    summary:
      'The Artifacts library is one place to browse everything ProDeck has generated across your workspace, and to reopen any piece in its editor or viewer.',
    sections: [
      {
        heading: 'What you will find here',
        body: [
          'The Artifacts library gathers every deliverable ProDeck has produced for you in a single view. Instead of hunting through different projects, you get one running list of your finished and in-progress work:',
          '',
          '- **Proposals** — structured, section-by-section documents.',
          '- **Microsites** — polished, presentation-style web pages.',
          '- **Documents** — long-form written pieces.',
          '- **Presentations** — slide-style decks.',
        ].join('\n'),
      },
      {
        heading: 'Filtering and reopening',
        body: [
          'Use the tabs at the top to narrow the list to a single type, so you can quickly find the microsite or proposal you are after.',
          '',
          'To pick up where you left off, just click any item. ProDeck opens it straight into the right place: proposals and documents open in their editor, and microsites and presentations open in their viewer.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Where can I find everything I have made?',
        a: 'Open the Artifacts library. It brings together every proposal, microsite, document, and presentation ProDeck has generated across your workspace.',
      },
      {
        q: 'Can I filter by type?',
        a: 'Yes. Use the tabs to switch between Proposals, Microsites, Documents, and Presentations so you only see the kind of work you want.',
      },
      {
        q: 'How do I reopen something I made earlier?',
        a: 'Click the item in the list. It opens directly in its editor or viewer so you can keep working or share it.',
      },
      {
        q: 'Does the library show work from all my projects?',
        a: 'Yes. It is a workspace-wide view, so you do not have to remember which project a deliverable belongs to.',
      },
    ],
    related: ['proposals', 'microsites', 'document-viewer', 'version-history'],
    keywords: ['artifacts', 'library', 'deliverables', 'gallery', 'filter', 'reopen', 'browse'],
  },
  {
    id: 'ingestion',
    title: 'Uploading documents',
    category: 'content-knowledge',
    routePatterns: ['/ingest'],
    summary:
      'Upload your documents so ProDeck can learn from them. It cleans each file, pulls out the important facts, and files them into your project so they are ready to use.',
    sections: [
      {
        heading: 'How uploading works',
        body: [
          'When you upload a file, ProDeck does not just store it as-is. It works through a few steps so the content is genuinely useful later:',
          '',
          '- Recognizes what kind of file it is.',
          '- Cleans up the content so it reads clearly.',
          '- Pulls out the key facts and requirements.',
          '- Files everything into your project so it can be searched.',
          '',
          'Because raw files are always processed first, your proposals and answers are built from tidy, meaningful details rather than messy source text.',
        ].join('\n'),
      },
      {
        heading: 'What you can upload',
        body: [
          'ProDeck accepts a wide range of everyday formats, including:',
          '',
          '- PDF files',
          '- Plain text and Markdown',
          '- Word documents',
          '- Images',
          '- Audio transcripts',
        ].join('\n'),
      },
      {
        heading: 'After you upload',
        body: [
          'Uploads are handled in the background, so you can keep working while ProDeck processes them. Each file becomes usable once it has finished and been filed away.',
          '',
          'Occasionally a detail that ProDeck is not confident about is left out, so the material it keeps stays reliable.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'What file types can I upload?',
        a: 'PDFs, plain text, Markdown, Word documents, images, and audio transcripts.',
      },
      {
        q: 'What happens after I upload a file?',
        a: 'It is processed in the background. Once ProDeck has cleaned it and pulled out the important details, it becomes usable in your project.',
      },
      {
        q: 'Why was a detail from my document not picked up?',
        a: 'When ProDeck is not confident about a piece of information, it may leave it out. This keeps the saved material trustworthy. If something important is missing, try uploading a clearer version of the file.',
      },
      {
        q: 'Do I have to wait for a file to finish before doing anything else?',
        a: 'No. Uploads process in the background, so you can carry on. The file simply becomes available once it is ready.',
      },
      {
        q: 'Are my original files used directly?',
        a: 'No. Every file is cleaned and processed first, so the content ProDeck works from is accurate and easy to search.',
      },
    ],
    related: ['knowledge-base', 'super-client-workspace', 'proposals', 'getting-started'],
    keywords: ['upload', 'ingest', 'documents', 'files', 'pdf', 'processing', 'import'],
  },
  {
    id: 'knowledge-base',
    title: 'Knowledge base',
    category: 'content-knowledge',
    routePatterns: ['/knowledge'],
    summary:
      'The knowledge base lists every document filed into a project and lets you ask plain-language questions that are answered from your own material.',
    sections: [
      {
        heading: 'What the knowledge base shows',
        body: [
          'The knowledge base is your project library. For each document you will see:',
          '',
          '- Its file name',
          '- Its size',
          '- When it was uploaded',
          '- Its current status',
          '',
          'At a glance you also get running counts of Total, Indexed, Processing, and Failed documents, so you always know how much of your material is ready to use.',
        ].join('\n'),
      },
      {
        heading: 'Asking questions',
        body: [
          'Once your documents are ready, you can ask questions in plain language and get answers pulled straight from what you uploaded. Nothing is invented: the answers are grounded in your own material, so you can trust that what you read reflects your documents.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I just ask questions about my documents?',
        a: 'Yes. Once your documents are ready, ask in plain language and ProDeck answers using the material you uploaded.',
      },
      {
        q: 'Does it make things up?',
        a: 'No. Answers are drawn from your indexed documents rather than invented, so they stay grounded in your own material.',
      },
      {
        q: 'What does the Processing status mean?',
        a: 'It means the document is still being filed away and is not quite ready to use yet. It will switch to Indexed once it is done.',
      },
      {
        q: 'What does the Failed status mean?',
        a: 'It means ProDeck could not file that document. Try uploading it again, ideally as a clearer version of the file.',
      },
      {
        q: 'What do the counts at the top tell me?',
        a: 'Total is how many documents you have, Indexed is how many are ready, Processing is how many are still being handled, and Failed is how many could not be filed.',
      },
    ],
    related: ['ingestion', 'super-client-workspace', 'document-viewer', 'proposals'],
    keywords: ['knowledge', 'search', 'questions', 'indexed', 'documents', 'status', 'grounded'],
  },
  {
    id: 'document-viewer',
    title: 'Document viewer',
    category: 'content-knowledge',
    routePatterns: ['/document'],
    summary:
      'The document viewer gives you a clean reading view of any generated or uploaded document, and lets you export it to the format you need.',
    sections: [
      {
        heading: 'Reading a document',
        body: [
          'Open any generated or uploaded document to read it in full in a clear, distraction-free view. It is designed for easy reading, so you can review the whole piece comfortably before you share it.',
        ].join('\n'),
      },
      {
        heading: 'Exporting',
        body: [
          'When you are happy with a document, export it to your preferred format so you can send it on or use it elsewhere.',
        ].join('\n'),
      },
    ],
    faqs: [
      {
        q: 'Can I read a document in full here?',
        a: 'Yes. The viewer shows the whole document in a clean reading view.',
      },
      {
        q: 'Can I export it?',
        a: 'Yes. You can export the document to your chosen format straight from the viewer.',
      },
      {
        q: 'Does this work for both generated and uploaded documents?',
        a: 'Yes. Whether ProDeck created the document or you uploaded it, you can read and export it here.',
      },
    ],
    related: ['export-formats', 'artifacts-library', 'proposals', 'knowledge-base'],
    keywords: ['document', 'viewer', 'read', 'export', 'view', 'reading'],
  },
];
