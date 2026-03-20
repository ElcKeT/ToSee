import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'stepfun/step-3.5-flash:free',
  messages: [
    {
      role: 'user',
      content: '请输出一个JSON对象，包含title、narrative、options数组，且不附加解释。',
    },
  ],
  reasoning: { enabled: true },
  response_format: { type: 'json_object' },
});

console.log(response.choices?.[0]?.message?.content || '{}');
