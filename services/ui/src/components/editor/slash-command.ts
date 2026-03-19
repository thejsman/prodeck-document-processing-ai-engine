import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';
import {
  SlashCommandMenu,
  type SlashMenuItem,
  type SlashCommandMenuRef,
} from './SlashCommandMenu';

const SLASH_ITEMS: SlashMenuItem[] = [
  {
    title: 'Text',
    description: 'Plain text paragraph',
    icon: 'T',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .setNode('paragraph')
        .run();
    },
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium heading',
    icon: 'H2',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small heading',
    icon: 'H3',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: '•',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .toggleBulletList()
        .run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: '1.',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .toggleOrderedList()
        .run();
    },
  },
  {
    title: 'Table',
    description: 'Insert a table',
    icon: '⊞',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    title: 'Callout',
    description: 'Highlighted info block',
    icon: 'ℹ',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .insertContent({
          type: 'callout',
          attrs: { tone: 'info', text: '' },
        })
        .run();
    },
  },
  {
    title: 'Pricing Table',
    description: 'Role / Qty / Rate / Duration / Total',
    icon: '$',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .insertContent({
          type: 'pricingTable',
          attrs: {
            rows: [
              {
                role: 'Engineer',
                qty: 1,
                rate: '$200/hr',
                duration: '4 weeks',
                total: '$32,000',
              },
            ],
          },
        })
        .run();
    },
  },
  {
    title: 'Timeline',
    description: 'Project milestones',
    icon: '◷',
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      (editor as Editor)
        .chain()
        .focus()
        .deleteRange(range as Range)
        .insertContent({
          type: 'timeline',
          attrs: {
            milestones: [
              {
                date: 'Week 1',
                title: 'Kickoff',
                description: 'Project initiation and setup',
              },
              {
                date: 'Week 2',
                title: 'Development',
                description: 'Core implementation',
              },
              {
                date: 'Week 3',
                title: 'Review',
                description: 'Testing and review',
              },
            ],
          },
        })
        .run();
    },
  },
];

const suggestion: Omit<SuggestionOptions<SlashMenuItem>, 'editor'> = {
  char: '/',
  command: ({ editor, range, props: item }: { editor: Editor; range: Range; props: SlashMenuItem }) => {
    item.command({ editor, range });
  },
  items: ({ query }: { query: string }) => {
    return SLASH_ITEMS.filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase()),
    );
  },

  render: () => {
    let component: ReactRenderer<SlashCommandMenuRef> | null = null;
    let popup: HTMLDivElement | null = null;

    return {
      onStart: (props) => {
        component = new ReactRenderer(SlashCommandMenu, {
          props: {
            items: props.items,
            command: (item: SlashMenuItem) => {
              props.command(item);
            },
          },
          editor: props.editor,
        });

        popup = document.createElement('div');
        popup.className = 'slash-menu-wrapper';
        popup.appendChild(component.element);

        const rect = props.clientRect?.();
        if (rect) {
          popup.style.position = 'absolute';
          popup.style.left = `${rect.left}px`;
          popup.style.top = `${rect.bottom + window.scrollY}px`;
          popup.style.zIndex = '1000';
        }

        document.body.appendChild(popup);
      },

      onUpdate: (props) => {
        component?.updateProps({
          items: props.items,
          command: (item: SlashMenuItem) => {
            props.command(item);
          },
        });

        if (popup) {
          const rect = props.clientRect?.();
          if (rect) {
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${rect.bottom + window.scrollY}px`;
          }
        }
      },

      onKeyDown: (props) => {
        if (props.event.key === 'Escape') {
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
          return true;
        }

        return component?.ref?.onKeyDown(props) ?? false;
      },

      onExit: () => {
        popup?.remove();
        popup = null;
        component?.destroy();
        component = null;
      },
    };
  },
};

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return { suggestion };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
