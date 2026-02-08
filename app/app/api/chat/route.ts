import { NextResponse } from "next/server";

type RequestMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; type: string }[];
};

const SYSTEM_PROMPT = `You are Chatify, an upbeat and deeply practical AI guide. You:
- treat every question as a real-life problem to solve with empathy.
- break answers into clear, actionable steps and highlight pros/cons when useful.
- keep explanations concise but thorough, and propose creative ideas when helpful.
- reference any shared files or images to inform your answer. If details are limited, infer possibilities and state assumptions.`;

const fallbackAssistant = (latestUserMessage: string, attachmentSummary: string) =>
  `I couldn't reach my reasoning engine just now, but here's a quick take based on what you shared:\n\n${latestUserMessage}\n\n${attachmentSummary}\n\nLet's retry in a moment if you need a deeper dive.`;

const buildAttachmentSummary = (items: AttachmentDetail[]) => {
  if (!items.length) {
    return "No attachments were included.";
  }

  return `Attachments provided:\n${items
    .map((item) => `• ${item.name} (${item.type}, ~${Math.max(1, Math.round(item.bytes / 1024))}KB)${item.preview}`)
    .join("\n")}`;
};

type AttachmentDetail = {
  name: string;
  type: string;
  bytes: number;
  preview: string;
};

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ reply: "Invalid payload format." }, { status: 400 });
    }

    const formData = await request.formData();
    const rawMessages = formData.get("messages");

    if (typeof rawMessages !== "string") {
      return NextResponse.json({ reply: "Missing conversation context." }, { status: 400 });
    }

    let messages: RequestMessage[] = [];
    try {
      messages = JSON.parse(rawMessages) as RequestMessage[];
    } catch (error) {
      return NextResponse.json({ reply: "The conversation payload could not be parsed." }, { status: 400 });
    }

    const attachments: AttachmentDetail[] = [];

    for (const entry of formData.values()) {
      if (entry instanceof File) {
        const buffer = Buffer.from(await entry.arrayBuffer());
        const snippet = entry.type.startsWith("image/")
          ? `\n   • Visual preview (base64, truncated): ${buffer.toString("base64").slice(0, 800)}...`
          : "";
        attachments.push({
          name: entry.name,
          type: entry.type || "application/octet-stream",
          bytes: buffer.byteLength,
          preview: snippet,
        });
      }
    }

    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const attachmentSummary = buildAttachmentSummary(attachments);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ reply: fallbackAssistant(latestUserMessage, attachmentSummary) });
    }

    const enrichedMessages = messages.map((message, index) => {
      if (message.role === "user" && index === messages.length - 1 && attachments.length) {
        return {
          role: message.role,
          content: `${message.content}\n\n${attachmentSummary}`,
        } satisfies RequestMessage;
      }
      return message;
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...enrichedMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    });

    if (!response.ok) {
      const responder = await response.text();
      return NextResponse.json(
        {
          reply: fallbackAssistant(
            latestUserMessage,
            `${attachmentSummary}\n(Reason: ${responder.slice(0, 200)})`
          ),
        },
        { status: 200 }
      );
    }

    const completion = await response.json();
    const replyText =
      completion?.choices?.[0]?.message?.content?.trim() ??
      fallbackAssistant(latestUserMessage, attachmentSummary);

    return NextResponse.json({ reply: replyText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        reply: `I had trouble completing that request (${message}). Let's try again in a moment.`,
      },
      { status: 200 }
    );
  }
}
