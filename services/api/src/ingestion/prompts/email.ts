export function emailPrompt(content: string): string {
  return `You are analyzing a business email or email thread.

Note: distinguish between (1) what industry the CLIENT is in (clientIndustry) and (2) what service is being requested (projectType). These are usually different — e.g. a restaurant asking for brand work means clientIndustry = "restaurant", projectType = "brand strategy".

Extract:
1. Sender and recipients (names/roles)
2. Key requests or asks
3. Decisions communicated
4. Deadlines mentioned
5. Any project requirements or constraints stated
6. Action items and their owners

IGNORE email signatures, disclaimers, forwarded headers, and auto-replies.

Email Content:
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
      "topic": "...",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": ["..."],
      "openQuestions": ["..."],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": []
}`;
}
