export function rfpPrompt(content: string): string {
  return `You are analyzing a Request for Proposal (RFP) or similar solicitation document.
RFPs are already structured, so your job is to normalize the structure and
extract key fields.

Note: distinguish between (1) what industry the CLIENT is in (clientIndustry) and (2) what service/project is being requested (projectType). These are usually different — e.g. a healthcare company issuing an RFP for a website means clientIndustry = "healthcare", projectType = "web development".

Extract:
1. Client/issuing organization details
2. Project scope and objectives
3. Technical requirements
4. Budget constraints or range
5. Timeline and milestones
6. Evaluation criteria
7. Submission requirements
8. Compliance/regulatory requirements
9. Any specific deliverables listed

RFP Content:
---
${content}
---

Respond with ONLY this JSON:
{
  "participants": [
    { "name": "...", "role": "...", "organization": "...", "inferredFrom": "..." }
  ],
  "sections": [
    {
      "topic": "Project Scope",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": [],
      "openQuestions": [],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": [
    { "owner": "respondent", "action": "Submit proposal", "deadline": "...", "status": "open" }
  ]
}`;
}
