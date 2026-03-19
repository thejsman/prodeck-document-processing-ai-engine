export interface PricingRow {
  role: string;
  qty: number;
  rate: string;
  duration: string;
  total: string;
}

export interface TimelineItem {
  date: string;
  title: string;
  description: string;
}

export type CalloutTone = 'info' | 'warning' | 'success';

export type ProposalBlock =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'heading'; level: number; text: string }
  | { id: string; type: 'bullet'; items: string[] }
  | { id: string; type: 'numbered'; items: string[] }
  | { id: string; type: 'table'; columns: string[]; rows: string[][] }
  | {
      id: string;
      type: 'callout';
      tone: CalloutTone;
      text: string;
    }
  | { id: string; type: 'pricing_table'; rows: PricingRow[] }
  | { id: string; type: 'timeline'; milestones: TimelineItem[] };

export interface ProposalSectionState {
  id: string;
  title: string;
  blocks: ProposalBlock[];
}

let counter = 0;

export function generateBlockId(): string {
  counter += 1;
  return `block-${Date.now()}-${counter}`;
}
