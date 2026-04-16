/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

/*
  API setting:
  - Set API_URL to your deployed Cloudflare Worker endpoint URL.
*/
const API_URL = window.API_URL || "";

// This system message keeps the chatbot focused on L'Oreal help only.
const systemMessage = {
  role: "system",
  content:
    "You are a L'Oreal beauty assistant. You may answer only questions about L'Oreal products, beauty routines, recommendations, ingredients, shades, skin concerns, hair concerns, product usage, and other beauty-related topics connected to L'Oreal. If a user asks about anything unrelated to L'Oreal or unrelated to beauty, politely refuse in 1 to 2 sentences and invite them to ask a L'Oreal beauty question instead.",
};

// We keep conversation history so the assistant remembers context.
const messages = [systemMessage];

// We also store small user details for more natural multi-turn replies.
const conversationMemory = {
  userName: "",
  pastQuestions: [],
};

// Set initial message in the chat window.
appendMessage(
  "ai",
  "Hello! Ask me anything about L'Oreal products, beauty routines, or personalized recommendations.",
);

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const prompt = userInput.value.trim();
  if (!prompt) {
    return;
  }

  appendMessage("user", prompt);
  showLatestQuestion(prompt);
  userInput.value = "";

  updateConversationMemory(prompt);
  messages.push({ role: "user", content: prompt });
  const thinkingElement = appendMessage("ai", "Thinking...");

  try {
    if (!API_URL) {
      throw new Error("Missing API_URL. Set your Cloudflare Worker URL first.");
    }

    const memoryMessage = {
      role: "system",
      content: buildMemoryContext(),
    };

    // Keep the original system message first, then memory context, then chat history.
    const requestMessages = [messages[0], memoryMessage, ...messages.slice(1)];

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: requestMessages,
        max_completion_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const assistantReply = data.choices?.[0]?.message?.content;

    if (!assistantReply) {
      throw new Error("No assistant message returned by the API");
    }

    messages.push({ role: "assistant", content: assistantReply });
    thinkingElement.remove();
    appendMessage("ai", assistantReply);
  } catch (error) {
    thinkingElement.remove();
    appendMessage(
      "ai",
      `Sorry, I couldn't connect right now. ${error.message}`,
    );
  }
});

function appendMessage(role, text) {
  const messageElement = document.createElement("div");
  messageElement.className = `msg ${role}`;
  messageElement.textContent = text;
  chatWindow.appendChild(messageElement);

  // Auto-scroll so the latest message is always visible.
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return messageElement;
}

function showLatestQuestion(questionText) {
  const previousQuestion = document.getElementById("latestQuestion");
  if (previousQuestion) {
    previousQuestion.remove();
  }

  const questionElement = document.createElement("div");
  questionElement.id = "latestQuestion";
  questionElement.className = "latest-question";
  questionElement.textContent = `Latest question: ${questionText}`;
  chatWindow.appendChild(questionElement);

  // Keep the latest question visible before the assistant response.
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function updateConversationMemory(userText) {
  // Try to capture the user's name from common intro patterns.
  const nameMatch = userText.match(
    /(?:my name is|i am|i'm)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
  );

  if (nameMatch && nameMatch[1]) {
    conversationMemory.userName = nameMatch[1].trim();
  }

  // Track user questions so the model can reference earlier asks.
  if (userText.includes("?")) {
    conversationMemory.pastQuestions.push(userText.trim());
  }

  // Keep memory short to avoid sending too much text every request.
  if (conversationMemory.pastQuestions.length > 8) {
    conversationMemory.pastQuestions =
      conversationMemory.pastQuestions.slice(-8);
  }
}

function buildMemoryContext() {
  const nameLine = conversationMemory.userName
    ? `User name: ${conversationMemory.userName}.`
    : "User name: unknown.";

  const questionLine = conversationMemory.pastQuestions.length
    ? `Past user questions: ${conversationMemory.pastQuestions.join(" | ")}`
    : "Past user questions: none yet.";

  return `${nameLine} ${questionLine} Use this memory naturally when helpful, and do not invent details.`;
}
