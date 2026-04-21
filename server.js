const http = require("http");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT) || 8787;
const ROOT_DIR = __dirname;

loadLocalEnvFile();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const systemMessage = {
  role: "system",
  content:
    "You are a L'Oreal beauty assistant. You may answer only questions about L'Oreal products, beauty routines, recommendations, ingredients, shades, skin concerns, hair concerns, product usage, and other beauty-related topics connected to L'Oreal. If a user asks about anything unrelated to L'Oreal or unrelated to beauty, politely refuse in 1 to 2 sentences and invite them to ask a L'Oreal beauty question instead.",
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api") {
    await handleApiRequest(request, response);
    return;
  }

  await serveStaticFile(requestUrl.pathname, response);
});

server.listen(PORT, () => {
  console.log(`Local chat server running at http://localhost:${PORT}`);
});

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const envFile = fs.readFileSync(envPath, "utf8");
  const lines = envFile.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmedLine.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, equalsIndex).trim();
    const value = trimmedLine
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^'|'$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function handleApiRequest(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  let bodyText = "";

  try {
    bodyText = await readRequestBody(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  let userInput;

  try {
    userInput = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!Array.isArray(userInput.messages)) {
    sendJson(response, 400, {
      error: "Invalid request: messages must be an array.",
    });
    return;
  }

  const latestUserMessage = getLatestUserMessage(userInput.messages);

  if (!isLorealRelatedQuestion(latestUserMessage)) {
    sendJson(
      response,
      200,
      buildAssistantShape("Please keep questions related to L'Oreal."),
    );
    return;
  }

  const openAiKey = normalizeApiKey(
    process.env.OPENAI_API_KEY ||
      process.env.OPENAI_KEY ||
      process.env.OPENAI_TOKEN ||
      "",
  );

  if (!openAiKey) {
    sendJson(
      response,
      200,
      buildFallbackOpenAiShape(
        latestUserMessage,
        "OpenAI key is missing locally. Add OPENAI_API_KEY and restart the server.",
      ),
    );
    return;
  }

  const requestBody = {
    model: "gpt-4o",
    messages: [systemMessage, ...userInput.messages],
    max_tokens: 300,
  };

  let openAiResponse;

  try {
    openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    sendJson(
      response,
      200,
      buildFallbackOpenAiShape(
        latestUserMessage,
        "Could not reach OpenAI. Returning a local L'Oreal helper response.",
      ),
    );
    return;
  }

  let data;

  try {
    data = await openAiResponse.json();
  } catch {
    sendJson(
      response,
      200,
      buildFallbackOpenAiShape(
        latestUserMessage,
        "OpenAI returned an invalid response. Returning a local L'Oreal helper response.",
      ),
    );
    return;
  }

  if (!openAiResponse.ok) {
    if (openAiResponse.status === 401) {
      sendJson(
        response,
        200,
        buildFallbackOpenAiShape(
          latestUserMessage,
          "OpenAI authentication failed (401). Update OPENAI_API_KEY and restart the server.",
        ),
      );
      return;
    }

    sendJson(
      response,
      200,
      buildFallbackOpenAiShape(
        latestUserMessage,
        data?.error?.message ||
          `OpenAI request failed with status ${openAiResponse.status}`,
      ),
    );
    return;
  }

  const assistantReply = data?.choices?.[0]?.message?.content;

  if (!assistantReply) {
    sendJson(
      response,
      200,
      buildFallbackOpenAiShape(
        latestUserMessage,
        "No assistant message returned by OpenAI. Returning a local L'Oreal helper response.",
      ),
    );
    return;
  }

  sendJson(response, 200, data);
}

async function serveStaticFile(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(ROOT_DIR, safePath));

  if (!filePath.startsWith(ROOT_DIR)) {
    sendPlainText(response, 400, "Bad request");
    return;
  }

  try {
    const fileData = await fsPromises.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";

    response.writeHead(200, { "Content-Type": contentType });
    response.end(fileData);
  } catch {
    sendPlainText(response, 404, "File not found");
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeApiKey(rawKey) {
  return String(rawKey || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^"|"$/g, "")
    .replace(/^'|'$/g, "");
}

function getLatestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (
      messages[index]?.role === "user" &&
      typeof messages[index]?.content === "string"
    ) {
      return messages[index].content;
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

function sendJson(response, statusCode, bodyObject) {
  response.writeHead(statusCode, corsHeaders);
  response.end(JSON.stringify(bodyObject));
}

function sendPlainText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}
