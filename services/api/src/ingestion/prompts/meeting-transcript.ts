export function meetingTranscriptPrompt(content: string): string {
  return `You are analyzing a raw meeting transcript — likely a client discovery or sales call.

READ THE ENTIRE TRANSCRIPT before writing any output. Do not base your response only on the first few minutes.

IGNORE completely:
- Audio/video technical issues at the start (delays, echo, connection problems)
- Small talk, personal stories, weather, sports, family, commute
- Greetings and goodbye sequences
- Scheduling logistics (unless a specific deadline was set)

EXTRACT and preserve:
1. CLIENT PRIORITIES — if the client explicitly ranks or numbers their priorities, capture every one of them verbatim in separate sections. Phrases like "priority number one", "the most important thing", "first thing I need" are signals.
2. STATED REQUIREMENTS — anything the client says they need, want, or must have. Include specific details (quantities, formats, outcomes).
3. BUSINESS METRICS — every number mentioned: budgets, lead counts, conversion rates, traffic numbers, team headcount, project counts, revenue figures, competitor data.
4. CLIENT CONTEXT — who the client is, what their company does, their current situation, their team size, their pain points with previous vendors.
   Pay special attention to TWO distinct dimensions:
   - What business the CLIENT is in (clientIndustry: their market/domain, e.g. "real estate", "landscaping")
   - What SERVICES are being discussed or proposed (projectType: the work scope, e.g. "digital marketing", "web development")
   These are usually DIFFERENT — a landscaping company discussing marketing means clientIndustry = "landscaping", projectType = "digital marketing".
5. AGENCY/VENDOR CAPABILITIES — what the other party presented about their services, approach, or portfolio.
6. COMMITMENTS — what each party agreed to deliver after this meeting, with deadlines if stated.
7. OPEN QUESTIONS — anything explicitly left unresolved.
8. ENGAGEMENT MODEL — any discussion of phased approach, crawl-walk-run, retainer vs project, pricing structure. If discussed, give it a dedicated section.

IMPORTANT FOR participants:
- For each participant, the "organization" field is the company they represent.
- The client is the party asking for services; the agency/vendor is the party offering services.
- Use the "inferredFrom" field to note which side they're on (e.g. "client side — CEO of the company seeking services" vs "agency side — partner at the vendor firm").

IMPORTANT FOR keyFacts:
- Include specific numbers with their context (e.g. "$3,000–$3,500 per project site for content capture")
- Include each stated priority with its rank and detail
- Include competitor intelligence mentioned (e.g. "competitor X gets 6,300 monthly organic visits")
- Include team composition and company scale details
- Do NOT summarize into vague statements — preserve specifics

IMPORTANT FOR sections:
- Create one section per major topic discussed (client background, each priority, agency pitch, next steps, etc.)
- A 60-minute discovery call should typically produce 5–10 sections
- Do not collapse everything into 1–2 generic sections

Transcript:
---
${content}
---

Respond with ONLY this JSON (no markdown, no explanation):
{
  "participants": [
    { "name": "...", "role": "CEO / Founder / etc.", "organization": "Company name", "inferredFrom": "introduced themselves as..." }
  ],
  "sections": [
    {
      "topic": "Client Background and Company Overview",
      "summary": "Jake Walker, CEO of Next Level Parks, explained the company builds trampoline parks and soft play centers. Started 2 years ago with 3 founders; Jake stepped into CEO role at Christmas. Currently has 11 installers, 2 project managers, and a financial controller.",
      "keyFacts": [
        "Next Level Parks builds and installs trampoline parks and soft play centers",
        "Company started ~2 years ago; Jake became CEO around Christmas",
        "Team: 11 installers, 2 project managers, 1 financial controller",
        "Cancelled previous marketing agency contract due to poor experience"
      ],
      "decisions": [],
      "openQuestions": [],
      "sentiment": "neutral",
      "relevantQuotes": ["everything feels like you're just holding on to a moving train"]
    },
    {
      "topic": "Priority 1: Content Capture Program",
      "summary": "Jake identified content capture as his top priority. Previously paid $3,000–$3,500 per project site for an on-site shoot producing a video edit, client testimonial, and 20–30 HD photos. The output was used internally and given to the client as a marketing package.",
      "keyFacts": [
        "Priority 1 (explicitly stated): On-site content capture per installed project",
        "Previous cost: $3,000–$3,500 per project site",
        "Deliverables per shoot: video edit, client testimonial, 20–30 HD photos",
        "Output doubles as a marketing package delivered to Jake's customer",
        "Approximately 10 projects per year in scope"
      ],
      "decisions": ["Start with content capture before scaling to other priorities"],
      "openQuestions": ["Who will provide the content capture team?"],
      "sentiment": "positive",
      "relevantQuotes": ["that to me is like number one, like priority"]
    }
  ],
  "actionItems": [
    { "owner": "KM Digital", "action": "Deliver SEO/competitor audit", "deadline": "within 2 weeks", "status": "open" },
    { "owner": "KM Digital", "action": "Send phased engagement proposal with crawl-walk-run plan and pricing options", "deadline": "within 2 weeks", "status": "open" }
  ]
}`;
}
