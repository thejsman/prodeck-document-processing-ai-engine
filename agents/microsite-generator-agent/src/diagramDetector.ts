/**
 * diagramDetector.ts
 *
 * Synchronous, pure keyword/pattern scoring engine that selects the best
 * Mermaid diagram type for a given section and generates a Gamma-quality
 * diagram prompt for the LLM.
 *
 * No I/O, no side effects — safe to call before async LLM calls.
 */

import { DIAGRAM_REGISTRY, type DiagramType, type SectionType } from './diagramRegistry.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface DiagramSelection {
  diagramType: DiagramType;
  score: number;
  matchedKeywords: string[];
  matchedBigrams: string[];
  matchedPatterns: string[];
  confidence: 'high' | 'medium' | 'low';
}

// ── Tokenisation ─────────────────────────────────────────────────────────────

function tokenize(text: string): { words: string[]; bigrams: string[] } {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return { words, bigrams };
}

// ── Per-type scoring ─────────────────────────────────────────────────────────

function scoreType(
  text: string,
  heading: string,
  sectionType: SectionType,
  dt: DiagramType,
): { score: number; matchedKeywords: string[]; matchedBigrams: string[]; matchedPatterns: string[] } {
  const { words, bigrams } = tokenize(text);
  const headingWords = tokenize(heading).words;

  // Keyword matches (2 pts each)
  const matchedKeywords = dt.keywords.filter(kw => words.includes(kw));
  // Bigram matches (4 pts each — stronger signal)
  const matchedBigrams = dt.bigrams.filter(bg => bigrams.includes(bg));
  // Pattern matches (3 pts each)
  const matchedPatterns: string[] = [];
  for (const pattern of dt.dataPatterns) {
    const re = new RegExp(pattern.source, (pattern.flags.replace(/g/g, '') + 'g'));
    if (re.test(text)) matchedPatterns.push(pattern.source);
  }
  // Section type bonus (5 pts)
  const sectionBonus = dt.sectionTypes.includes(sectionType) ? 5 : 0;
  // Heading keyword bonus (3 pts per match)
  const headingBonus = dt.keywords.filter(kw => headingWords.includes(kw)).length * 3;

  const score =
    matchedKeywords.length * 2 +
    matchedBigrams.length * 4 +
    matchedPatterns.length * 3 +
    sectionBonus +
    headingBonus;

  return { score, matchedKeywords, matchedBigrams, matchedPatterns };
}

// ── Public: select best diagram ───────────────────────────────────────────────

export function selectBestDiagram(
  text: string,
  heading: string,
  sectionType: SectionType,
): DiagramSelection | null {
  // Testimonials never get diagrams
  if (sectionType === 'testimonials') return null;

  type Scored = { dt: DiagramType; score: number; matchedKeywords: string[]; matchedBigrams: string[]; matchedPatterns: string[] };
  const scored: Scored[] = DIAGRAM_REGISTRY.map(dt => ({
    dt,
    ...scoreType(text, heading, sectionType, dt),
  })).sort((a, b) => b.score - a.score);

  const top = scored[0];

  // Lowered thresholds: high ≥5, medium ≥2, low ≥1
  if (top && top.score >= 1) {
    const confidence: 'high' | 'medium' | 'low' =
      top.score >= 5 ? 'high' :
      top.score >= 2 ? 'medium' :
      'low';

    // If top meets its own minScore, return it
    if (top.score >= top.dt.minScore || top.score >= 2) {
      return {
        diagramType: top.dt,
        score: top.score,
        matchedKeywords: top.matchedKeywords,
        matchedBigrams: top.matchedBigrams,
        matchedPatterns: top.matchedPatterns,
        confidence,
      };
    }
  }

  // Section-type fallback when score is 0 or below threshold — prefer custom SVG types
  const sectionTypeFallback: Record<string, string | undefined> = {
    hero:         'steps-flow',
    problem:      'comparison-table',
    challenge:    'comparison-table',
    approach:     'steps-flow',
    deliverables: 'tree-diagram',
    timeline:     'timeline-bar',
    pricing:      'donut-chart',
    whyus:        'stat-grid',
    benefits:     'stat-grid',
    stats:        'stat-grid',
    metrics:      'stat-grid',
    showcase:     'orbital',
    security:     'tree-diagram',
    techstack:    'orbital',
    testing:      'steps-flow',
    faq:          'comparison-table',
    team:         'tree-diagram',
    comparison:   'comparison-table',
    casestudy:    'journey-map',
    chart:        'bar-chart',
    testimonials: undefined,
    nextsteps:    'steps-flow',
    generic:      'steps-flow',
  };

  const fallbackTypeId = sectionTypeFallback[sectionType];
  if (fallbackTypeId) {
    const fallbackType = DIAGRAM_REGISTRY.find(d => d.id === fallbackTypeId);
    if (fallbackType) {
      return {
        diagramType: fallbackType,
        score: 0,
        confidence: 'low' as const,
        matchedKeywords: [],
        matchedBigrams: [],
        matchedPatterns: [],
      };
    }
  }

  return null;
}

// ── Public: build Gamma-quality diagram prompt ────────────────────────────────

export function buildGammaDiagramPrompt(
  selection: DiagramSelection,
  heading: string,
  rawBody: string,
  brief: string,
): string {
  const { diagramType: dt } = selection;
  // Limit content to avoid token overload
  const content = (rawBody.trim() || brief).slice(0, 1000);
  const n = dt.maxNodes;

  switch (dt.id) {
    case 'process-flow':
      return `Generate a graph TD process flow diagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE must be: graph TD
- Comment: %% ${heading} Process Flow
- Use subgraph for each logical phase group (max 3 subgraphs)
- Every node: NodeId["Step Name\\nBrief action description"]
- Every arrow has a label: A -->|"triggers"| B
- Diamond decision nodes where conditions exist: D{"Decision?\\nCriteria"}
- Start/End: S(["▶ Start"]) and E(["✓ Complete"])
- Max ${n} nodes total. Color comments: %% @color:teal initiation, %% @color:blue execution, %% @color:green completion
Content: ${content}`;

    case 'decision-tree':
      return `Generate a graph TD decision tree — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph TD
- Comment: %% ${heading} Decision Tree
- Top node is primary decision in diamond: D{"Question?"}
- Every branch labeled Yes/No or condition: D -->|"Yes"| A, D -->|"No"| B
- Leaf outcome nodes: O(["✓ Approved"])
- Max ${n} nodes. No more than 3 levels deep
Content: ${content}`;

    case 'data-flow':
      return `Generate a graph LR data flow diagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph LR
- Comment: %% ${heading} Data Flow
- Subgraphs: SOURCES["📥 Data Sources"], PROCESSING["⚙ Processing"], DESTINATIONS["📤 Destinations"]
- Source nodes: S1[/"Source\\nData format"/]
- Processing nodes: P1["Processor\\nTransformation applied"]
- Destination nodes: D1[("Store\\nData type")]
- Every edge describes the data: S1 -->|"raw events"| P1
- Max ${n} nodes across all subgraphs
Content: ${content}`;

    case 'system-architecture':
      return `Generate a graph TB system architecture diagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph TB
- Comment: %% ${heading} Architecture
- Subgraphs for layers: CLIENT["🖥 Client Layer"], GATEWAY["🔀 API Gateway"], SERVICES["⚙ Business Services"], DATA["🗄 Data Layer"]
- Service nodes: SvcId["**ServiceName**\\nBrief responsibility"]
- Database nodes: DbId[("**DatabaseName**\\nData stored")]
- External systems: ExtId[/"**ExternalSystem**\\nIntegration type"/]
- Edge labels: A -->|"REST / JSON"| B
- Max ${n} nodes total across all subgraphs
Content: ${content}`;

    case 'network-topology':
      return `Generate a graph TB network topology — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph TB
- Comment: %% ${heading} Network Topology
- Zone subgraphs: INTERNET["🌐 Internet"], DMZ["🛡 DMZ"], PRIVATE["🔒 Private"], DATA["🗄 Data Tier"]
- Cylinders for databases, parallelograms for external
- Edge labels show protocol: A -->|"HTTPS:443"| B
- Encrypted connections: A -.->|"TLS"| B
- Max ${n} nodes
Content: ${content}`;

    case 'api-sequence':
      return `Generate a sequenceDiagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: sequenceDiagram
- Comment: %% ${heading} API Flow
- Participants: real system names (max 4)
- activate/deactivate for processing blocks
- Message labels include HTTP method: Client->>API: POST /api/resource
- Note annotations: Note over Actor: context description
- Use -x for failed calls, alt/else for error handling
- Max ${n} participants
Content: ${content}`;

    case 'gantt-chart':
      return `Generate a gantt chart — Gamma.ai quality standards.
Requirements:
- FIRST LINE: gantt
- title ${heading}
- dateFormat YYYY-MM-DD
- Real phase names and durations from content
- Each project phase = one gantt section
- At least one crit task per section
- Default start: 2026-04-01
- Task format: Task Name :taskId, startDate, duration (e.g. 14d, 1w, 21d)
- Dependency: Task Name :taskId, after prevId, duration
- Max 3 sections, max 3 tasks each
Content: ${content}`;

    case 'sequence-steps':
      return `Generate a sequenceDiagram for ordered steps — Gamma.ai quality standards.
Requirements:
- FIRST LINE: sequenceDiagram
- Comment: %% ${heading} Sequence
- Participants are actors/systems from content (max ${n})
- loop and alt blocks for repetitive/conditional steps
- Note annotations for key handoffs
- activate/deactivate for processing blocks
Content: ${content}`;

    case 'entity-relationship':
      return `Generate an erDiagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: erDiagram
- Comment: %% ${heading} Data Model
- Entity names in PascalCase, max ${n} entities
- Each entity: 3-5 typed attributes (string, int, uuid, timestamp, boolean) with PK/FK markers
- Every relationship has a verb label: USER ||--o{ ORDER : "places"
- Cardinality: ||--|| one-to-one, ||--o{ one-to-many, }o--o{ many-to-many
Content: ${content}`;

    case 'org-chart':
      return `Generate a graph TD org chart — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph TD
- Comment: %% ${heading} Team Structure
- Top node = sponsor/executive
- Node format: R1["**Role Title**\\nKey responsibility"]
- Edge labels: A -->|"manages"| B, A -->|"sponsors"| C
- Subgraph for external stakeholders if mentioned
- Max ${n} nodes
Content: ${content}`;

    case 'dependency-map':
      return `Generate a graph LR dependency map — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph LR
- Comment: %% ${heading} Dependencies
- Arrows from dependency TO dependent: A -->|"required by"| B
- Subgraphs: EXTERNAL["External Dependencies"], INTERNAL["Internal Components"]
- Node format: CompId["**Component**\\nVersion or type"]
- Mark critical/blocking dependencies: %% @critical
- Max ${n} nodes
Content: ${content}`;

    case 'pie-chart':
      return `Generate a pie chart — Gamma.ai quality standards.
Requirements:
- FIRST LINE: pie
- showData
- title ${heading} Distribution
- Extract REAL percentages from content — do NOT invent numbers
- If no percentages, derive from time/effort ratios mentioned
- Max ${n} slices, each label 2-4 words, Title Case
- Format: "Label" : value (number, not percentage sign)
Content: ${content}`;

    case 'quadrant-matrix':
      return `Generate a quadrantChart — Gamma.ai quality standards.
Requirements:
- FIRST LINE: quadrantChart
- Comment: %% ${heading} Priority Matrix
- x-axis: Low Effort --> High Effort (adapt axis names to content context)
- y-axis: Low Impact --> High Impact
- quadrant-1 Quick Wins
- quadrant-2 Major Projects
- quadrant-3 Fill Ins
- quadrant-4 Thankless Tasks
- Plot 4-8 items from content as data points: ItemName: [0.75, 0.85]
- Point coordinates 0.0–1.0, derived from content
Content: ${content}`;

    case 'trend-chart':
      return `Generate an xychart-beta — Gamma.ai quality standards.
Requirements:
- FIRST LINE: xychart-beta
- title "${heading} Performance"
- x-axis: time periods from content (quarters, months, weeks) as quoted labels
- y-axis: numeric range from actual values in content
- bar for primary metric
- line for target/benchmark if both present
- Extract REAL numbers from content — never fabricate metrics
Content: ${content}`;

    case 'user-journey':
      return `Generate a journey diagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: journey
- title ${heading}
- Max 3 sections (journey phases), max 3 tasks per section
- Satisfaction score 1-5 per task derived from content sentiment
- Multiple actors where applicable: User, System, Team
- Task names are action verbs: Visit site, Submit form, Receive approval
- Section names map to real journey phases from content
Content: ${content}`;

    case 'state-machine':
      return `Generate a stateDiagram-v2 — Gamma.ai quality standards.
Requirements:
- FIRST LINE: stateDiagram-v2
- Comment: %% ${heading} State Machine
- Start from [*], end to [*]
- State names in PascalCase: Pending, UnderReview, Approved, Rejected
- Every transition labeled with the trigger event: Pending --> Approved: review_passed
- Include error/failure transitions
- Max ${n} states
Content: ${content}`;

    case 'class-structure':
      return `Generate a classDiagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: classDiagram
- Comment: %% ${heading} Class Structure
- Each class: 2-3 typed attributes, 1-2 key methods
- Attribute format: +type attributeName
- Method format: +ReturnType methodName(params)
- Relationships: <|-- inheritance, *-- composition, o-- aggregation, --> association
- Relationship labels: ClassA "1" --> "many" ClassB : contains
- Use <<interface>> and <<abstract>> stereotypes where applicable
- Max ${n} classes
Content: ${content}`;

    case 'mind-map':
      return `Generate a mindmap — Gamma.ai quality standards.
Requirements:
- FIRST LINE: mindmap
- Root: root(("**${heading.split(' ').slice(0, 3).join(' ')}**"))
- Max 4 top-level branches, max 3 children per branch
- Branch names: 2-4 word noun phrases
- Leaf nodes: 1-3 words, specific and concrete
- Top-level branches map to main themes from content
Content: ${content}`;

    case 'orbital':
      return `Analyze the content and extract data for an ORBITAL integration diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract the central hub system and 3-4 connected satellite systems.

Output format (use REAL names from content):
__CUSTOM_SVG__{"type":"orbital","center":{"title":"Core System Name","subtitle":"Brief description max 6 words"},"satellites":[{"title":"System A","description":"What it does max 7 words","position":"top-left"},{"title":"System B","description":"What it does","position":"top-right"},{"title":"System C","description":"What it does","position":"bottom-left"}]}

Positions available: top-left, top-right, bottom-left, bottom-right
Min 2 satellites, max 4. Use real system names from content.
Content: ${content}`;

    case 'puzzle':
      return `Analyze the content and extract data for a PUZZLE architecture diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract exactly 4 key components/services from the content.

Output format (use REAL names from content):
__CUSTOM_SVG__{"type":"puzzle","pieces":[{"title":"Component A","iconType":"gateway","position":"top-left","labelSide":"left"},{"title":"Component B","iconType":"monitor","position":"top-right","labelSide":"right"},{"title":"Component C","iconType":"stream","position":"bottom-left","labelSide":"left"},{"title":"Component D","iconType":"storage","position":"bottom-right","labelSide":"right"}],"backgroundStyle":"gradient"}

Icon types: gateway, monitor, stream, storage, security, cloud, data, api, user, process, integrate, deploy
Always exactly 4 pieces. Use real component names from content.
Content: ${content}`;

    case 'steps-flow':
      return `Analyze the content and extract data for a STEPS FLOW diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract 3-6 sequential steps/phases from the content.

Output format (use REAL names from content):
__CUSTOM_SVG__{"type":"steps-flow","steps":[{"title":"Step One","description":"Brief description of what happens in this step"},{"title":"Step Two","description":"What this step delivers"},{"title":"Step Three","description":"Final outcome of this step"}]}

Rules:
- 3-6 steps maximum
- title: 2-4 words, exact name from content
- description: 6-12 words, specific to content
- Preserve original sequence order
Content: ${content}`;

    case 'timeline-bar':
      return `Analyze the content and extract data for a TIMELINE BAR (Gantt-style) diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract project phases with durations from the content.

Output format (use REAL phase names from content):
__CUSTOM_SVG__{"type":"timeline-bar","phases":[{"name":"Phase 1 Name","durationWeeks":3,"startWeek":0},{"name":"Phase 2 Name","durationWeeks":4,"startWeek":3},{"name":"Phase 3 Name","durationWeeks":2,"startWeek":7}]}

Rules:
- Use EXACT phase names from content
- durationWeeks: integer, estimate from content if not explicit (2-6 typical)
- startWeek: cumulative start (each phase starts where previous ends)
- 2-8 phases maximum
Content: ${content}`;

    case 'donut-chart':
      return `Analyze the content and extract data for a DONUT CHART diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract distribution/breakdown percentages from the content.

Output format (use REAL labels from content):
__CUSTOM_SVG__{"type":"donut-chart","title":"Budget Breakdown","total":"$150K","segments":[{"label":"Development","percentage":45},{"label":"Design","percentage":20},{"label":"Infrastructure","percentage":20},{"label":"Training","percentage":15}]}

Rules:
- Percentages must sum to 100
- Use exact labels from content
- title and total from content if present, otherwise omit
- 2-8 segments
Content: ${content}`;

    case 'bar-chart':
      return `Analyze the content and extract data for a BAR CHART diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract comparison metrics or before/after values from the content.

Output format (use REAL labels and values from content):
__CUSTOM_SVG__{"type":"bar-chart","title":"Performance Comparison","unit":"days","bars":[{"label":"Current","value":9,"sublabel":"Before"},{"label":"Target","value":3,"sublabel":"After","highlight":true}]}

Rules:
- Use ONLY values that appear verbatim in the content — NEVER invent numbers
- If no numeric values exist, do not use this diagram type
- highlight: true for the best/target value
- unit: the measurement unit from content
- 2-8 bars
Content: ${content}`;

    case 'stat-grid':
      return `Analyze the content and extract data for a STAT GRID diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract key statistics and metrics from the content.

Output format (use REAL values from content):
__CUSTOM_SVG__{"type":"stat-grid","stats":[{"value":"9 days","label":"Month-end close time","icon":"time","trend":"down"},{"value":"40%","label":"Manual effort reduction","icon":"growth","trend":"up"},{"value":"$2M","label":"Annual cost savings","icon":"money"}]}

Rules:
- ONLY include stats that appear verbatim in the content — NEVER invent numbers
- value: exact figure from content (e.g. "86%", "3x", "$1.2M", "9 days")
- label: exact description from content
- icon: time | money | growth | people | check | star | up | down | process | data
- trend: up | down | neutral (omit if not applicable)
- 2-6 stats maximum
Content: ${content}`;

    case 'tree-diagram':
      return `Analyze the content and extract data for a TREE / HIERARCHY diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract the hierarchical structure from the content.

Output format (use REAL names from content):
__CUSTOM_SVG__{"type":"tree-diagram","root":{"title":"Root Node","children":[{"title":"Child A","children":[{"title":"Leaf A1"},{"title":"Leaf A2"}]},{"title":"Child B"},{"title":"Child C"}]}}

Rules:
- Max 3 levels deep
- Max 4 children per node
- Use exact names from content
Content: ${content}`;

    case 'journey-map':
      return `Analyze the content and extract data for a CUSTOMER/USER JOURNEY MAP diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract journey stages and activities from the content.

Output format (use REAL stage names from content):
__CUSTOM_SVG__{"type":"journey-map","stages":[{"name":"Discovery","activities":["Research vendors","Review proposals"],"sentiment":"neutral"},{"name":"Evaluation","activities":["Demo sessions","Proof of concept"],"sentiment":"positive"},{"name":"Onboarding","activities":["Team training","Go-live"],"sentiment":"positive"}]}

Rules:
- 3-6 stages maximum
- 1-4 activities per stage
- sentiment: positive | neutral | negative
- Use exact stage/activity names from content
Content: ${content}`;

    case 'comparison-table':
      return `Analyze the content and extract data for a COMPARISON TABLE diagram.
CRITICAL: The diagram field value MUST start with exactly: __CUSTOM_SVG__
Followed immediately by valid JSON (no space, no newline).

Extract a feature comparison matrix from the content.

Output format (use REAL names from content):
__CUSTOM_SVG__{"type":"comparison-table","title":"Approach Comparison","features":["Real-time processing","Automated reporting","Custom dashboards","API integration"],"options":[{"name":"Current State","values":[false,false,false,false]},{"name":"Proposed Solution","values":[true,true,true,true]}]}

Rules:
- 2-4 options (columns)
- 3-10 features (rows)
- values: boolean true/false OR short string (e.g. "Partial", "Manual")
- Use exact feature and option names from content
Content: ${content}`;

    default:
      return `Generate a graph LR diagram — Gamma.ai quality standards.
Requirements:
- FIRST LINE: graph LR
- Comment: %% ${heading}
- Descriptive edge labels on every arrow
- Max ${n} nodes
Content: ${content}`;
  }
}
