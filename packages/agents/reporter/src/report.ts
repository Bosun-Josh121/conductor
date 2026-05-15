import Anthropic from '@anthropic-ai/sdk';

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export async function generateReport(input: string): Promise<string> {
  if (!input.trim()) {
    return '**Report unavailable** — no data was provided.';
  }

  const prompt = `You are a professional report writer. Format the following data into a clear, structured report.

Data:
${input}

Requirements:
- Use clear markdown headings and sections
- Include an executive summary at the top
- Report only on data that was actually provided — do not invent missing sections
- Highlight key findings and actionable insights
- Format numbers and data clearly

Produce a well-formatted markdown report:`;

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : 'Report generation unavailable';
}
