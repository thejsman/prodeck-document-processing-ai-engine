'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react';

import type { Editor, Range } from '@tiptap/core';

export interface SlashMenuItem {
  title: string;
  description: string;
  icon: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashMenuItem[];
  command: (item: SlashMenuItem) => void;
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuRef, Props>(
  function SlashCommandMenu({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command],
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) =>
            prev <= 0 ? items.length - 1 : prev - 1,
          );
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) =>
            prev >= items.length - 1 ? 0 : prev + 1,
          );
          return true;
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-menu">
          <div className="slash-menu__empty">No matching commands</div>
        </div>
      );
    }

    return (
      <div className="slash-menu">
        {items.map((item, index) => (
          <button
            key={item.title}
            className={`slash-menu__item${index === selectedIndex ? ' slash-menu__item--active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
            type="button"
          >
            <span className="slash-menu__icon">{item.icon}</span>
            <div className="slash-menu__text">
              <span className="slash-menu__title">{item.title}</span>
              <span className="slash-menu__description">
                {item.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    );
  },
);
