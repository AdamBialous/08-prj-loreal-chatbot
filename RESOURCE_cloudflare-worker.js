// Cloudflare Worker example:
// - POST /api -> forwards chat requests to OpenAI
// - all other routes -> serves your static site assets

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api") {
      return handleApiRequest(request, env);
    }

    // Requires an ASSETS binding in your Worker/Pages project.
    return env.ASSETS.fetch(request);
  },
};

async function handleApiRequest(request, env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const userInput = await request.json();

  const systemMessage = {
    role: "system",
    content:
      "You are a L'Oreal beauty assistant. You may answer only questions about L'Oreal products, beauty routines, recommendations, ingredients, shades, skin concerns, hair concerns, product usage, and other beauty-related topics connected to L'Oreal. If a user asks about anything unrelated to L'Oreal or unrelated to beauty, politely refuse in 1 to 2 sentences and invite them to ask a L'Oreal beauty question instead.",
  };

  const requestBody = {
    model: "gpt-4o",
    messages: [systemMessage, ...(userInput.messages || [])],
    max_completion_tokens: 300,
  };

  const openAiResponse = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );

  const data = await openAiResponse.json();

  return new Response(JSON.stringify(data), {
    status: openAiResponse.status,
    headers: corsHeaders,
  });
}
