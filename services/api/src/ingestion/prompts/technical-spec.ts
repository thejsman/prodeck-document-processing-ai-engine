export function technicalSpecPrompt(content: string): string {
  return `You are analyzing a technical specification or architecture document.

Extract:
1. System architecture overview
2. Technology stack and platform choices
3. Integration requirements (APIs, third-party services)
4. Performance requirements (latency, throughput, uptime)
5. Security and compliance requirements
6. Data model or schema requirements
7. Infrastructure requirements
8. Non-functional requirements

Technical Document:
---
${content}
---

Respond with ONLY this JSON:
{
  "sections": [
    {
      "topic": "Architecture Overview",
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
