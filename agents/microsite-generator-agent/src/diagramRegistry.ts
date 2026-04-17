/**
 * diagramRegistry.ts
 *
 * Pure, side-effect-free definitions for 18 Gamma-quality diagram types.
 * Each entry drives:
 *   - keyword / bigram / pattern scoring in diagramDetector.ts
 *   - per-type Mermaid prompt templates in buildGammaDiagramPrompt
 */

export type SectionType =
  | 'hero' | 'challenge' | 'approach' | 'deliverables' | 'timeline'
  | 'pricing' | 'whyus' | 'nextsteps' | 'testimonials' | 'showcase'
  | 'benefits' | 'problem' | 'stats' | 'metrics' | 'security'
  | 'techstack' | 'testing' | 'faq' | 'team' | 'comparison' | 'casestudy' | 'chart' | 'approval' | 'generic';

export type DiagramTypeId =
  | 'process-flow' | 'decision-tree' | 'data-flow'
  | 'system-architecture' | 'network-topology' | 'api-sequence'
  | 'gantt-chart' | 'sequence-steps'
  | 'entity-relationship' | 'org-chart' | 'dependency-map'
  | 'pie-chart' | 'quadrant-matrix' | 'trend-chart'
  | 'user-journey' | 'state-machine' | 'class-structure' | 'mind-map'
  | 'orbital' | 'puzzle'
  | 'steps-flow' | 'timeline-bar' | 'donut-chart' | 'bar-chart'
  | 'stat-grid' | 'tree-diagram' | 'journey-map' | 'comparison-table';

export type DiagramCategory =
  | 'flow' | 'architecture' | 'timeline' | 'relationship' | 'metric' | 'specialized'
  | 'process' | 'chart';

export interface DiagramType {
  id: DiagramTypeId;
  label: string;
  mermaidDirective: string;
  category: DiagramCategory;
  keywords: string[];
  bigrams: string[];
  dataPatterns: RegExp[];
  sectionTypes: SectionType[];
  minScore: number;
  maxNodes: number;
  isCustomSvg?: boolean;
  gammaStyle: {
    useSubgraphs: boolean;
    useEdgeLabels: boolean;
    useNodeSubtitles: boolean;
    useEmojiPrefixes: boolean;
    colorGroups: string[];
    useMilestones?: boolean;
    useSections?: boolean;
    notes?: boolean;
  };
}

export const DIAGRAM_REGISTRY: DiagramType[] = [
  // ── FLOW ──────────────────────────────────────────────────────────────────
  {
    id: 'process-flow',
    label: 'Process Flow',
    mermaidDirective: 'graph TD',
    category: 'flow',
    keywords: [
      'process','flow','step','workflow','pipeline','procedure','sequence',
      'lifecycle','journey','funnel','stage','phase','execute','run',
      'trigger','automate','iterate',
    ],
    bigrams: [
      'step by step','end to end','continuous delivery','release cycle',
      'approval process','review process',
    ],
    dataPatterns: [
      /step\s*\d+/gi, /phase\s*\d+/gi, /^\d+\.\s+\w/gm,
      /first.*then.*finally/gi, /before.*after/gi,
    ],
    sectionTypes: ['approach','timeline','deliverables','generic','nextsteps'],
    minScore: 4,
    maxNodes: 7,
    gammaStyle: {
      useSubgraphs: true, useEdgeLabels: true, useNodeSubtitles: true,
      useEmojiPrefixes: false,
      colorGroups: ['initiation','execution','validation','completion'],
    },
  },
  {
    id: 'decision-tree',
    label: 'Decision Tree',
    mermaidDirective: 'graph TD',
    category: 'flow',
    keywords: [
      'decision','criteria','evaluate','assess','choose','qualify',
      'condition','branch','route','gate','check','validate',
      'approve','reject','escalate','fallback',
    ],
    bigrams: [
      'decision point','approval gate','quality gate',
      'go no-go','pass fail','yes no',
    ],
    dataPatterns: [
      /if\s+\w+.*then/gi, /approved|rejected/gi,
      /yes.*no/gi, /qualify.*disqualify/gi,
    ],
    sectionTypes: ['approach','challenge','generic'],
    minScore: 5,
    maxNodes: 9,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: ['decision','positive','negative'],
    },
  },
  {
    id: 'data-flow',
    label: 'Data Flow',
    mermaidDirective: 'graph LR',
    category: 'flow',
    keywords: [
      'data','integration','sync','pipeline','stream','transfer',
      'api','etl','ingestion','migration','extract','transform',
      'load','consume','publish','subscribe','webhook','feed',
    ],
    bigrams: [
      'data pipeline','event stream','real-time sync','api integration',
      'data transfer','message queue',
    ],
    dataPatterns: [
      /\b(REST|GraphQL|gRPC|SOAP)\b/gi, /source.*destination/gi,
      /input.*output/gi, /\b(Kafka|Kinesis|RabbitMQ|SQS)\b/gi,
    ],
    sectionTypes: ['approach','deliverables','generic','techstack'],
    minScore: 5,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: true, useEdgeLabels: true, useNodeSubtitles: true,
      useEmojiPrefixes: true,
      colorGroups: ['sources','processing','destinations'],
    },
  },
  // ── ARCHITECTURE ─────────────────────────────────────────────────────────
  {
    id: 'system-architecture',
    label: 'System Architecture',
    mermaidDirective: 'graph TB',
    category: 'architecture',
    keywords: [
      'architecture','system','infrastructure','microservice','component',
      'service','layer','stack','platform','cloud','module','subsystem',
      'container','runtime','cluster','node',
    ],
    bigrams: [
      'system design','cloud native','microservices architecture',
      'service mesh','event driven','distributed system',
    ],
    dataPatterns: [
      /\b(AWS|Azure|GCP|Kubernetes|Docker|K8s)\b/gi,
      /\b(microservice|monolith|serverless)\b/gi,
      /\blayer\b.*\blayer\b/gi,
    ],
    sectionTypes: ['approach','deliverables','generic','techstack','showcase'],
    minScore: 5,
    maxNodes: 10,
    gammaStyle: {
      useSubgraphs: true, useEdgeLabels: true, useNodeSubtitles: true,
      useEmojiPrefixes: true,
      colorGroups: ['client','gateway','services','data'],
    },
  },
  {
    id: 'network-topology',
    label: 'Network Topology',
    mermaidDirective: 'graph TB',
    category: 'architecture',
    keywords: [
      'network','firewall','vpc','subnet','load balancer','cdn',
      'dns','gateway','proxy','cluster','dmz','waf','ingress',
      'egress','peering','transit','route','bandwidth',
    ],
    bigrams: [
      'network topology','load balancer','security group',
      'traffic routing','network layer','private subnet',
    ],
    dataPatterns: [
      /\b(VPC|CIDR|IP|TCP|UDP|HTTP|HTTPS|TLS|SSL)\b/gi,
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    ],
    sectionTypes: ['approach','generic','security'],
    minScore: 5,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: true, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: true,
      colorGroups: ['internet','dmz','private','data'],
    },
  },
  {
    id: 'api-sequence',
    label: 'API Sequence',
    mermaidDirective: 'sequenceDiagram',
    category: 'architecture',
    keywords: [
      'api','rest','graphql','endpoint','request','response',
      'webhook','oauth','token','authentication','call','invoke',
      'consume','integrate','handshake','handoff','exchange',
    ],
    bigrams: [
      'api call','rest api','api gateway','token refresh',
      'oauth flow','request response','api contract',
    ],
    dataPatterns: [
      /\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/g,
      /\b(200|201|400|401|403|404|500)\b/g,
      /\/api\/[\w/]+/g,
      /Bearer\s+token/gi,
    ],
    sectionTypes: ['approach','deliverables','generic','techstack'],
    minScore: 5,
    maxNodes: 6,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [], notes: true,
    },
  },
  // ── TIMELINE ─────────────────────────────────────────────────────────────
  {
    id: 'gantt-chart',
    label: 'Project Gantt',
    mermaidDirective: 'gantt',
    category: 'timeline',
    keywords: [
      'timeline','schedule','phase','week','month','sprint',
      'milestone','deadline','delivery','roadmap','plan',
      'kickoff','release','launch','deploy','go-live',
    ],
    bigrams: [
      'project timeline','delivery schedule','release plan',
      'sprint plan','milestone plan','project roadmap',
      'week 1','week 2','weeks 1-2','weeks 3-7',
    ],
    dataPatterns: [
      /\d+\s*weeks?/gi, /\d+\s*months?/gi, /week\s*\d+/gi,
      /phase\s*\d+/gi, /Q[1-4]\s*20\d\d/gi, /milestone/gi,
    ],
    sectionTypes: ['timeline'],
    minScore: 3,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [], useSections: true, useMilestones: true,
    },
  },
  {
    id: 'sequence-steps',
    label: 'Step Sequence',
    mermaidDirective: 'sequenceDiagram',
    category: 'timeline',
    keywords: [
      'sequence','order','handoff','handover','iteration',
      'sprint','cycle','version','deployment','release',
      'pass','submit','review','approve','notify',
    ],
    bigrams: [
      'step sequence','ordered steps','handoff process',
      'review cycle','approval sequence',
    ],
    dataPatterns: [
      /first.*second.*third/gi,
    ],
    sectionTypes: ['timeline','approach','nextsteps'],
    minScore: 4,
    maxNodes: 5,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  // ── RELATIONSHIP ─────────────────────────────────────────────────────────
  {
    id: 'entity-relationship',
    label: 'Entity Relationship',
    mermaidDirective: 'erDiagram',
    category: 'relationship',
    keywords: [
      'entity','relationship','database','schema','table',
      'record','model','object','field','attribute',
      'join','reference','link','association',
    ],
    bigrams: [
      'data model','entity relationship','database schema',
      'data structure','object model','domain model',
      'foreign key','primary key','many to many',
    ],
    dataPatterns: [
      /\b(has many|belongs to|has one|many to many)\b/gi,
      /\b(FK|PK|UUID|INT|VARCHAR|TIMESTAMP)\b/g,
      /\btable\b.*\bcolumn\b/gi,
    ],
    sectionTypes: ['approach','deliverables','generic'],
    minScore: 5,
    maxNodes: 6,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'org-chart',
    label: 'Team Structure',
    mermaidDirective: 'graph TD',
    category: 'relationship',
    keywords: [
      'team','organization','structure','hierarchy','role',
      'report','department','lead','manager','stakeholder',
      'sponsor','owner','responsible','accountable','raci',
    ],
    bigrams: [
      'team structure','org chart','reporting structure',
      'raci matrix','stakeholder map','project team',
    ],
    dataPatterns: [
      /\b(CEO|CTO|CPO|CFO|VP|Director|Manager|Lead|Engineer|Analyst|Consultant)\b/g,
      /reports to/gi, /managed by/gi,
    ],
    sectionTypes: ['whyus','generic'],
    minScore: 4,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: true, useEdgeLabels: true, useNodeSubtitles: true,
      useEmojiPrefixes: false,
      colorGroups: ['executive','management','delivery'],
    },
  },
  {
    id: 'dependency-map',
    label: 'Dependency Map',
    mermaidDirective: 'graph LR',
    category: 'relationship',
    keywords: [
      'dependency','depend','require','need','prerequisite',
      'block','enable','trigger','upstream','downstream',
      'before','after','requires','enables',
    ],
    bigrams: [
      'depends on','blocked by','upstream dependency',
      'downstream impact','prerequisite for','enables next',
    ],
    dataPatterns: [
      /\b\w+\s+depends\s+on\s+\w+/gi,
      /\bblocked\s+by\b/gi,
      /\bprerequisite\b/gi,
    ],
    sectionTypes: ['approach','timeline','deliverables'],
    minScore: 5,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: true, useEdgeLabels: true, useNodeSubtitles: true,
      useEmojiPrefixes: false,
      colorGroups: ['external','internal'],
    },
  },
  // ── METRIC ───────────────────────────────────────────────────────────────
  {
    id: 'pie-chart',
    label: 'Distribution Chart',
    mermaidDirective: 'pie',
    category: 'metric',
    keywords: [
      'percentage','distribution','breakdown','proportion',
      'share','split','allocation','budget','composition',
      'portion','ratio','mix','weightage','spread',
    ],
    bigrams: [
      'budget breakdown','resource allocation','cost split',
      'time allocation','effort distribution','work split',
    ],
    dataPatterns: [
      /\d+(\.\d+)?%/g,
      /out of 100/gi,
      /\d+\s*percent/gi,
    ],
    sectionTypes: ['stats','pricing','whyus'],
    minScore: 3,
    maxNodes: 6,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'quadrant-matrix',
    label: 'Priority Matrix',
    mermaidDirective: 'quadrantChart',
    category: 'metric',
    keywords: [
      'priority','impact','effort','risk','matrix','quadrant',
      'compare','evaluate','rank','assess','map',
      'position','classify','categorize',
    ],
    bigrams: [
      'priority matrix','impact effort','risk matrix',
      'effort impact','value vs effort','risk vs reward',
      'high impact','low effort','quick win',
    ],
    dataPatterns: [
      /high.*low/gi, /effort.*impact/gi,
      /risk.*reward/gi, /priority.*matrix/gi, /quadrant/gi,
    ],
    sectionTypes: ['challenge','approach','generic','problem'],
    minScore: 4,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'trend-chart',
    label: 'Trend Chart',
    mermaidDirective: 'xychart-beta',
    category: 'metric',
    keywords: [
      'growth','trend','increase','decrease','performance',
      'metric','kpi','revenue','conversion','rate','velocity',
      'improvement','benchmark','target','goal',
    ],
    bigrams: [
      'growth rate','performance trend','kpi trend',
      'revenue growth','conversion rate','improvement over time',
      'year over year','quarter over quarter',
    ],
    dataPatterns: [
      /\d+%.*\d+%/g,
      /from \d+.*to \d+/gi,
      /increased by \d+/gi,
      /reduced by \d+/gi,
      /Q[1-4]/gi,
    ],
    sectionTypes: ['stats','hero','whyus','metrics'],
    minScore: 4,
    maxNodes: 6,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  // ── SPECIALIZED ──────────────────────────────────────────────────────────
  {
    id: 'user-journey',
    label: 'User Journey',
    mermaidDirective: 'journey',
    category: 'specialized',
    keywords: [
      'user','customer','journey','experience','touchpoint',
      'interaction','onboarding','adoption','engagement',
      'satisfaction','nps','friction','delight',
      'awareness','consideration','decision','retention',
    ],
    bigrams: [
      'user journey','customer experience','user flow',
      'customer lifecycle','adoption journey','onboarding flow',
      'end user','user persona',
    ],
    dataPatterns: [
      /user.*experience/gi,
      /customer.*journey/gi,
      /onboarding/gi,
      /satisfaction score/gi,
    ],
    sectionTypes: ['approach','benefits','challenge'],
    minScore: 4,
    maxNodes: 7,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'state-machine',
    label: 'State Diagram',
    mermaidDirective: 'stateDiagram-v2',
    category: 'specialized',
    keywords: [
      'state','status','transition','active','inactive',
      'pending','approved','rejected','trigger','event',
      'idle','running','paused','completed','failed',
      'draft','published','archived','locked','expired',
    ],
    bigrams: [
      'state machine','state transition','status flow',
      'lifecycle states','approval states','workflow states',
    ],
    dataPatterns: [
      /\b(pending|approved|rejected|active|inactive|draft|published|archived)\b/gi,
      /transitions?\s+to/gi,
      /state\s+change/gi,
    ],
    sectionTypes: ['approach','deliverables','generic'],
    minScore: 5,
    maxNodes: 8,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'class-structure',
    label: 'Class Diagram',
    mermaidDirective: 'classDiagram',
    category: 'specialized',
    keywords: [
      'class','object','interface','inherit','extend',
      'implement','method','property','module','abstract',
      'concrete','polymorphism','encapsulation',
      'inheritance','composition','aggregation','association',
    ],
    bigrams: [
      'class diagram','object model','inheritance chain',
      'interface contract','abstract class','design pattern',
    ],
    dataPatterns: [
      /\b(extends|implements|abstract|interface|class)\b/gi,
      /\b(constructor|method|property|attribute)\b/gi,
    ],
    sectionTypes: ['approach','deliverables','generic'],
    minScore: 5,
    maxNodes: 6,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: true, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'mind-map',
    label: 'Mind Map',
    mermaidDirective: 'mindmap',
    category: 'specialized',
    keywords: [
      'overview','summary','concept','idea','explore',
      'discover','map','topic','theme','area','domain',
      'category','pillar','dimension','aspect','element',
      'factor','consideration','component','feature',
    ],
    bigrams: [
      'key areas','main topics','core concepts',
      'strategic pillars','focus areas','key components',
      'solution overview','capability map',
    ],
    dataPatterns: [
      /\d+\s+(key|main|core|primary)\s+(area|topic|concept|pillar)/gi,
      /includes?:.*,.*,/gi,
    ],
    sectionTypes: ['hero','benefits','generic','showcase'],
    minScore: 3,
    maxNodes: 12,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  // ── CUSTOM SVG ────────────────────────────────────────────────────────────
  {
    id: 'steps-flow',
    label: 'Steps Flow',
    mermaidDirective: 'custom-svg',
    category: 'process',
    keywords: [
      'step', 'phase', 'stage', 'approach', 'methodology', 'process',
      'first', 'second', 'third', 'then', 'next', 'workflow',
      'implementation', 'rollout', 'execution', 'delivery',
    ],
    bigrams: [
      'step by step', 'phased approach', 'key steps', 'our approach',
      'implementation approach', 'delivery process', 'engagement model',
      'how we work', 'our process', 'work process',
    ],
    dataPatterns: [
      /\b(step|phase|stage)\s+\d+/gi,
      /\b(first|second|third|fourth|fifth)\b/gi,
      /\d+[\.\)]\s+\w+/g,
    ],
    sectionTypes: ['approach', 'deliverables', 'nextsteps', 'testing', 'security', 'techstack', 'challenge', 'problem', 'hero', 'generic'],
    minScore: 2,
    maxNodes: 6,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'timeline-bar',
    label: 'Timeline Bar',
    mermaidDirective: 'custom-svg',
    category: 'timeline',
    keywords: [
      'week', 'month', 'duration', 'schedule', 'timeline', 'gantt',
      'sprint', 'milestone', 'delivery', 'phase', 'roadmap',
    ],
    bigrams: [
      'project timeline', 'delivery schedule', 'project phases',
      'implementation timeline', 'project roadmap', 'engagement timeline',
    ],
    dataPatterns: [
      /\bweek\s*\d+/gi,
      /\b\d+\s+weeks?\b/gi,
      /\b(month|sprint)\s*\d+/gi,
    ],
    sectionTypes: ['timeline', 'approach', 'nextsteps', 'deliverables', 'pricing', 'generic'],
    minScore: 2,
    maxNodes: 8,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'donut-chart',
    label: 'Donut Chart',
    mermaidDirective: 'custom-svg',
    category: 'chart',
    keywords: [
      'budget', 'allocation', 'percentage', 'breakdown', 'distribution',
      'split', 'portion', 'share', 'composition', 'proportion',
    ],
    bigrams: [
      'budget breakdown', 'cost breakdown', 'budget allocation',
      'resource allocation', 'time breakdown', 'effort split',
    ],
    dataPatterns: [
      /\d+\s*%/g,
      /\b(budget|cost|allocation)\b/gi,
    ],
    sectionTypes: ['pricing', 'stats', 'metrics', 'whyus', 'benefits', 'generic'],
    minScore: 2,
    maxNodes: 8,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'bar-chart',
    label: 'Bar Chart',
    mermaidDirective: 'custom-svg',
    category: 'chart',
    keywords: [
      'comparison', 'before', 'after', 'versus', 'benchmark', 'metric',
      'performance', 'improvement', 'reduction', 'increase',
    ],
    bigrams: [
      'before and after', 'current vs target', 'performance comparison',
      'metric comparison', 'improvement metrics', 'key metrics',
    ],
    dataPatterns: [
      /\bbefore\b.*\bafter\b/gi,
      /\bcurrent\b.*\btarget\b/gi,
      /\bvs\.?\b/gi,
    ],
    sectionTypes: ['stats', 'metrics', 'benefits', 'challenge', 'problem', 'casestudy', 'generic'],
    minScore: 2,
    maxNodes: 8,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'stat-grid',
    label: 'Stat Grid',
    mermaidDirective: 'custom-svg',
    category: 'chart',
    keywords: [
      'statistic', 'number', 'figure', 'result', 'outcome', 'impact',
      'achieve', 'deliver', 'reduce', 'increase', 'improve', 'save',
    ],
    bigrams: [
      'key results', 'key outcomes', 'key metrics', 'key statistics',
      'impact metrics', 'proven results', 'measurable results',
    ],
    dataPatterns: [
      /\d+\s*%/g,
      /\$[\d,]+/g,
      /\b\d+x\b/gi,
    ],
    sectionTypes: ['stats', 'metrics', 'benefits', 'whyus', 'casestudy', 'showcase', 'challenge', 'problem', 'security', 'generic'],
    minScore: 2,
    maxNodes: 6,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'tree-diagram',
    label: 'Tree Diagram',
    mermaidDirective: 'custom-svg',
    category: 'architecture',
    keywords: [
      'hierarchy', 'org chart', 'team structure', 'reporting', 'department',
      'parent', 'child', 'subordinate', 'breakdown structure',
    ],
    bigrams: [
      'org chart', 'team structure', 'reporting structure', 'work breakdown',
      'hierarchy structure', 'organization chart',
    ],
    dataPatterns: [
      /\breport(s|ing)?\s+to\b/gi,
      /\bheaded\s+by\b/gi,
      /\b(VP|Director|Manager|Lead)\s+of\b/gi,
    ],
    sectionTypes: ['team', 'approach', 'deliverables', 'security', 'techstack', 'testing', 'faq', 'generic'],
    minScore: 2,
    maxNodes: 12,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'journey-map',
    label: 'Journey Map',
    mermaidDirective: 'custom-svg',
    category: 'process',
    keywords: [
      'journey', 'experience', 'customer', 'user', 'touchpoint', 'stage',
      'awareness', 'consideration', 'decision', 'onboard', 'adoption',
    ],
    bigrams: [
      'customer journey', 'user journey', 'customer experience',
      'buyer journey', 'user experience', 'engagement journey',
    ],
    dataPatterns: [
      /\b(awareness|consideration|decision|onboarding|adoption)\b/gi,
      /\bcustomer\s+(journey|experience|lifecycle)\b/gi,
    ],
    sectionTypes: ['approach', 'casestudy', 'nextsteps', 'challenge', 'problem', 'showcase', 'generic'],
    minScore: 2,
    maxNodes: 6,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'comparison-table',
    label: 'Comparison Table',
    mermaidDirective: 'custom-svg',
    category: 'chart',
    keywords: [
      'compare', 'versus', 'alternative', 'option', 'feature', 'capability',
      'include', 'support', 'available', 'tier', 'plan',
    ],
    bigrams: [
      'feature comparison', 'option comparison', 'plan comparison',
      'tier comparison', 'vs table', 'comparison matrix',
    ],
    dataPatterns: [
      /\bvs\.?\b/gi,
      /\b(option|tier|plan)\s+(A|B|C|1|2|3)\b/gi,
    ],
    sectionTypes: ['comparison', 'pricing', 'whyus', 'faq', 'benefits', 'security', 'generic'],
    minScore: 2,
    maxNodes: 10,
    isCustomSvg: true,
    gammaStyle: { useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false, useEmojiPrefixes: false, colorGroups: [] },
  },
  {
    id: 'orbital',
    label: 'Orbital Diagram',
    mermaidDirective: 'custom-svg',
    category: 'architecture',
    keywords: [
      'central', 'hub', 'core', 'integrate', 'connect', 'ecosystem',
      'platform', 'orbit', 'satellite', 'banking', 'CRM', 'payment',
      'gateway', 'API contract', 'integration hub', 'core platform',
      'connected systems', 'seamless connectivity',
    ],
    bigrams: [
      'core banking', 'central system', 'hub and spoke',
      'API contracts', 'system integration', 'connected services',
      'integration architecture', 'core platform', 'ecosystem integration',
    ],
    dataPatterns: [
      /\b(core|central|hub)\b.*\b(system|platform|service)\b/gi,
      /connects?\s+(to|with)\b/gi,
      /\b(CRM|ERP|banking|payment|gateway)\b/gi,
    ],
    sectionTypes: ['approach', 'generic', 'showcase', 'techstack', 'security', 'whyus', 'benefits'],
    minScore: 3,
    maxNodes: 4,
    isCustomSvg: true,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
  {
    id: 'puzzle',
    label: 'Puzzle Diagram',
    mermaidDirective: 'custom-svg',
    category: 'architecture',
    keywords: [
      'component', 'piece', 'fit together', 'building block', 'module',
      'microservice', 'event stream', 'API gateway', 'monitoring',
      'data storage', 'four components', 'core component',
      'architecture component', 'proposed architecture',
    ],
    bigrams: [
      'key components', 'core components', 'building blocks',
      'four components', 'API gateway', 'event stream', 'data storage',
      'centralized monitoring', 'microservices architecture', 'proposed architecture',
    ],
    dataPatterns: [
      /\b4\s+(key|core|main|primary)\s+(component|service|piece|module)\b/gi,
      /\b(microservice|event.stream|API.gateway|monitoring|storage)\b/gi,
      /\barchitecture\b.*\bcomponent\b/gi,
    ],
    sectionTypes: ['approach', 'showcase', 'deliverables', 'techstack', 'security', 'testing', 'generic'],
    minScore: 3,
    maxNodes: 4,
    isCustomSvg: true,
    gammaStyle: {
      useSubgraphs: false, useEdgeLabels: false, useNodeSubtitles: false,
      useEmojiPrefixes: false,
      colorGroups: [],
    },
  },
];
