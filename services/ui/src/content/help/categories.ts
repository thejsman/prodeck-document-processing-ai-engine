import {
  Rocket,
  MessagesSquare,
  FileText,
  LayoutTemplate,
  Database,
  Sparkles,
  Share2,
  BarChart3,
  Settings,
  UserCog,
} from 'lucide-react';
import type { HelpCategory } from '@/lib/help/help-types';

/**
 * Ordered help categories shown in the Help Center nav and used to group the
 * global FAQ. Keep `order` contiguous and unique.
 */
export const HELP_CATEGORIES: HelpCategory[] = [
  { id: 'getting-started', label: 'Getting Started', order: 1, icon: Rocket },
  { id: 'super-client', label: 'Super-Client Workspace', order: 2, icon: MessagesSquare },
  { id: 'proposals', label: 'Proposals', order: 3, icon: FileText },
  { id: 'microsites', label: 'Microsites & Presentations', order: 4, icon: LayoutTemplate },
  { id: 'content-knowledge', label: 'Content & Knowledge', order: 5, icon: Database },
  { id: 'inspiration-skills', label: 'Brand & Inspiration', order: 6, icon: Sparkles },
  { id: 'publishing-export', label: 'Publishing & Export', order: 7, icon: Share2 },
  { id: 'insights', label: 'Insights & Monitoring', order: 8, icon: BarChart3 },
  { id: 'admin', label: 'Administration', order: 9, icon: Settings },
  { id: 'account', label: 'Account & Settings', order: 10, icon: UserCog },
];
