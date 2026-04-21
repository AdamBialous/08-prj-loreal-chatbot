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
  let userInput;

  try {
    userInput = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const latestUserMessage = getLatestUserMessage(userInput.messages || []);

  if (!isLorealRelatedQuestion(latestUserMessage)) {
    return successResponse(
      buildAssistantShape("Please keep questions related to L'Oreal."),
      corsHeaders,
    );
  }

  if (!apiKey) {
    return successResponse(
      buildFallbackOpenAiShape(
        latestUserMessage,
        "OpenAI key is missing in Cloudflare. Add OPENAI_API_KEY and redeploy.",
      ),
      corsHeaders,
    );
  }

  const systemMessage = {
    role: "system",
    content:
      "You are a L'Oreal beauty assistant. You may answer only questions about L'Oreal products, beauty routines, recommendations, ingredients, shades, skin concerns, hair concerns, product usage, and other beauty-related topics connected to L'Oreal. If a user asks about anything unrelated to L'Oreal or unrelated to beauty, politely refuse in 1 to 2 sentences and invite them to ask a L'Oreal beauty question instead.",
  };

  const requestBody = {
    model: "gpt-4o",
    messages: [systemMessage, ...(userInput.messages || [])],
    max_tokens: 300,
  };

  let openAiResponse;

  try {
    openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return successResponse(
      buildFallbackOpenAiShape(
        latestUserMessage,
        "Could not reach OpenAI. Returning a local L'Oreal helper response.",
      ),
      corsHeaders,
    );
  }

  let data;

  try {
    data = await openAiResponse.json();
  } catch {
    return successResponse(
      buildFallbackOpenAiShape(
        latestUserMessage,
        "OpenAI returned an invalid response. Returning a local L'Oreal helper response.",
      ),
      corsHeaders,
    );
  }

  if (!openAiResponse.ok) {
    if (openAiResponse.status === 401) {
      return successResponse(
        buildFallbackOpenAiShape(
          latestUserMessage,
          "OpenAI authentication failed (401). Update OPENAI_API_KEY in Cloudflare and redeploy.",
        ),
        corsHeaders,
      );
    }

    return successResponse(
      buildFallbackOpenAiShape(
        latestUserMessage,
        data?.error?.message ||
          `OpenAI request failed with status ${openAiResponse.status}`,
      ),
      corsHeaders,
    );
  }

  if (!data?.choices?.[0]?.message?.content) {
    return successResponse(
      buildFallbackOpenAiShape(
        latestUserMessage,
        "No assistant message returned by OpenAI. Returning a local L'Oreal helper response.",
      ),
      corsHeaders,
    );
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: corsHeaders,
  });
}

function getLatestUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (
      messages[i]?.role === "user" &&
      typeof messages[i]?.content === "string"
    ) {
      return messages[i].content;
    }
  }

  return "";
}

function isLorealRelatedQuestion(userQuestion) {
  const text = String(userQuestion || "").toLowerCase();

  if (!text.trim()) {
    return true;
  }

  const lorealKeywords = [
    "l'oreal",
    "loreal",
    "beauty",
    "skincare",
    "skin care",
    "haircare",
    "hair care",
    "makeup",
    "foundation",
    "concealer",
    "mascara",
    "lipstick",
    "serum",
    "moisturizer",
    "shampoo",
    "conditioner",
    "fragrance",
    "routine",
    "shade",
    "ingredient",
    "acne",
    "dry skin",
    "oily skin",
    "hair",
    "product",
  ];

  return lorealKeywords.some((keyword) => text.includes(keyword));
}

function buildAssistantShape(content) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
        },
      },
    ],
  };
}

function buildFallbackOpenAiShape(userQuestion, reason) {
  const fallbackText = buildLorealFallbackReply(userQuestion);

  return buildAssistantShape(
    `${fallbackText}\n\n(Temporary fallback: ${reason})`,
  );
}

function buildLorealFallbackReply(userQuestion) {
  const question = String(userQuestion || "").toLowerCase();

  if (question.includes("dry") && question.includes("hair")) {
    return "For dry hair, look for L'Oreal nourishing lines such as Elvive Hyaluron Plump or Extraordinary Oil. A simple routine is: hydrating shampoo, nourishing conditioner, then a leave-in serum on damp hair.";
  }

  if (
    question.includes("acne") ||
    question.includes("oily") ||
    question.includes("skin")
  ) {
    return "For oily or acne-prone skin, choose gentle, non-comedogenic L'Oreal skincare and lightweight hydration. Use a simple routine: cleanser, treatment/serum, moisturizer, and daytime SPF.";
  }

  if (question.includes("foundation") || question.includes("shade")) {
    return "For L'Oreal foundation matching, pick undertone first (cool, warm, neutral), then test along jawline in daylight. Infallible Fresh Wear and True Match are good starting points for shade matching.";
  }

  return "I can help with L'Oreal product recommendations for skincare, haircare, makeup, routines, ingredients, and shade selection. Share your skin or hair type plus your goal, and I will suggest a personalized routine.";
}

function successResponse(bodyObject, corsHeaders) {
  return new Response(JSON.stringify(bodyObject), {
    status: 200,
    headers: corsHeaders,
  });
}
