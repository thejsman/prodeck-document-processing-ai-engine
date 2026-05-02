export function genericPrompt(content: string): string {
  return `You are analyzing a business document. Extract the key topics, facts, decisions,
and action items. Group related information by topic.

Note: if the document references a client and a service being provided, distinguish between
clientIndustry (the client's business domain) and projectType (the service being delivered).
These are usually different — e.g. a fintech company hiring for IT consulting means clientIndustry = "fintech", projectType = "IT consulting".

Document:
---
${content}
---

Respond with ONLY this JSON:
{
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
