"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, Mic, Paperclip, Send, User, Volume2, VolumeX, X } from "lucide-react";

type AttachmentDraft = {
  id: string;
  file: File;
  preview: string;
};

type PersistedAttachment = {
  id: string;
  name: string;
  type: string;
  url: string;
};

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  attachments?: PersistedAttachment[];
};

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const MAX_ATTACHMENTS = 4;

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: generateId(),
      role: "assistant",
      content:
        "Hi, I'm Chatify—your friendly AI co-pilot for everyday challenges. Ask me anything, speak to me, or share images and files so we can tackle it together!",
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentDraft[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [speechSupported, setSpeechSupported] = useState({ input: false, output: false });
  const [speakQueue, setSpeakQueue] = useState<string | null>(null);
  const pendingRef = useRef<AttachmentDraft[]>([]);

  useEffect(() => {
    pendingRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.preview));
    };
  }, []);

  useEffect(() => {
    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;
    const supportsSpeechInput = Boolean(SpeechRecognition);
    const supportsSpeechOutput = typeof window !== "undefined" && "speechSynthesis" in window;
    setSpeechSupported({ input: supportsSpeechInput, output: supportsSpeechOutput });

    if (SpeechRecognition && !recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.continuous = false;

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results as SpeechRecognitionResultList)
          .map((result: SpeechRecognitionResult) => result[0]?.transcript ?? "")
          .join(" ");
        setInput((prev) => (prev ? `${prev.trim()} ${transcript}`.trim() : transcript));
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!autoSpeak || !speechSupported.output || typeof window === "undefined") {
      return;
    }
    if (!speakQueue) {
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(speakQueue);
    utterance.rate = 1;
    utterance.pitch = 1;
    synth.speak(utterance);
    setSpeakQueue(null);
  }, [autoSpeak, speakQueue, speechSupported.output]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const toggleListening = () => {
    if (!speechSupported.input || !recognitionRef.current) {
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    setPendingAttachments((prev) => {
      const availableSlots = MAX_ATTACHMENTS - prev.length;
      if (availableSlots <= 0) {
        return prev;
      }
      const nextFiles = files.slice(0, availableSlots).map((file) => ({
        id: generateId(),
        file,
        preview: URL.createObjectURL(file),
      }));
      return [...prev, ...nextFiles];
    });

    event.target.value = "";
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const next = prev.filter((item) => item.id !== id);
      const removed = prev.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.preview);
      }
      return next;
    });
  };

  const serializeMessagesForRequest = (conversation: ChatMessage[]) => {
    return conversation.map((message) => ({
      role: message.role,
      content: message.content,
      attachments: message.attachments?.map((attachment) => ({
        name: attachment.name,
        type: attachment.type,
      })),
    }));
  };

  const handleSend = async () => {
    if (!input.trim() && pendingAttachments.length === 0) {
      return;
    }
    setIsThinking(true);

    const attachmentsSnapshot = [...pendingAttachments];
    const conversionResults = await Promise.allSettled(
      attachmentsSnapshot.map(async (item): Promise<PersistedAttachment> => ({
        id: item.id,
        name: item.file.name,
        type: item.file.type || "application/octet-stream",
        url: await fileToDataUrl(item.file),
      }))
    );

    const attachmentSnapshots = conversionResults
      .filter((result): result is PromiseFulfilledResult<PersistedAttachment> => result.status === "fulfilled")
      .map((result) => result.value);

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: input.trim(),
      attachments: attachmentSnapshots,
      createdAt: Date.now(),
    };

    setInput("");
    attachmentsSnapshot.forEach((attachment) => URL.revokeObjectURL(attachment.preview));
    setPendingAttachments([]);

    const nextConversation = [...messages, userMessage];
    setMessages(nextConversation);

    const formData = new FormData();
    formData.append("messages", JSON.stringify(serializeMessagesForRequest(nextConversation)));
    attachmentsSnapshot.forEach((attachment, index) => {
      formData.append(`attachment-${index}`, attachment.file, attachment.file.name);
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to reach Chatify");
      }

      const payload = await response.json();
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: payload.reply ?? "I'm here, but I couldn't understand the request just yet.",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      if (speechSupported.output && autoSpeak) {
        setSpeakQueue(assistantMessage.content);
      }
    } catch (error: unknown) {
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content:
          error instanceof Error
            ? `I ran into an issue: ${error.message}. Please try again.`
            : "Something unexpected happened. Let's try again!",
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (speechSupported.output && autoSpeak) {
        setSpeakQueue(assistantMessage.content);
      }
    } finally {
      setIsThinking(false);
    }
  };

  const preventDefault = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isThinking) {
      handleSend();
    }
  };

  const canSend = useMemo(() => {
    return Boolean(input.trim()) || pendingAttachments.length > 0;
  }, [input, pendingAttachments]);

  return (
    <div className="flex min-h-screen w-full justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black p-4 text-white">
      <main className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
        <header className="flex flex-col gap-4 border-b border-white/10 bg-white/10 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-lg font-semibold">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                <Bot className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xl font-bold text-white">Chatify</p>
                <p className="text-sm text-slate-200/70">Real-world problem solver with voice, vision & files.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-200/70">
            <button
              onClick={() => setAutoSpeak((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:bg-white/10"
            >
              {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span className="hidden sm:inline">Voice replies</span>
            </button>
            {speechSupported.input ? (
              <button
                onClick={toggleListening}
                className={`inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 transition ${
                  isListening ? "bg-emerald-500/20 text-emerald-200" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                <Mic className="h-4 w-4" />
                <span className="hidden sm:inline">{isListening ? "Listening" : "Tap to talk"}</span>
              </button>
            ) : (
              <span className="rounded-full border border-dashed border-white/15 px-4 py-2 text-xs text-slate-300/60">
                Voice input unavailable in this browser
              </span>
            )}
          </div>
        </header>

        <section className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`flex gap-3 ${message.role === "assistant" ? "flex-row" : "flex-row-reverse"}`}
            >
              <span className={`mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                message.role === "assistant" ? "bg-emerald-400/10 text-emerald-200" : "bg-white/10 text-slate-200"
              }`}>
                {message.role === "assistant" ? <Bot className="h-5 w-5" /> : <User className="h-5 w-5" />}
              </span>
              <div
                className={`max-w-3xl rounded-2xl border border-white/10 p-4 shadow-xl ${
                  message.role === "assistant" ? "bg-slate-900/60" : "bg-emerald-500/15"
                }`}
              >
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-100">{message.content}</p>
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {message.attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="group relative w-32 overflow-hidden rounded-xl border border-white/15 bg-black/40"
                      >
                        {attachment.type.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={attachment.url}
                            alt={attachment.name}
                            className="h-24 w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center text-xs text-slate-300/80">
                            <span>{attachment.name}</span>
                          </div>
                        )}
                        <div className="border-t border-white/5 px-3 py-2 text-[10px] text-slate-300/70">
                          {attachment.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}

          {isThinking && (
            <div className="flex items-center gap-3 text-sm text-slate-300/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Chatify is thinking...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </section>

        {pendingAttachments.length > 0 && (
          <div className="mx-4 mb-4 flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:mx-6">
            {pendingAttachments.map((attachment) => (
              <div key={attachment.id} className="relative w-28 overflow-hidden rounded-xl border border-white/10">
                {attachment.file.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attachment.preview} alt={attachment.file.name} className="h-20 w-full object-cover" />
                ) : (
                  <div className="flex h-20 items-center justify-center bg-black/40 text-[11px] text-slate-200">
                    {attachment.file.name}
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white transition hover:bg-black"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={preventDefault} className="border-t border-white/10 bg-white/10 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex items-center gap-2">
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,.doc,.docx,.txt"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Add attachments"
                disabled={pendingAttachments.length >= MAX_ATTACHMENTS}
              />
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 transition ${
                pendingAttachments.length >= MAX_ATTACHMENTS ? "cursor-not-allowed opacity-40" : "bg-white/10 hover:bg-white/20"
              }`}>
                <Paperclip className="h-5 w-5" />
              </span>
            </label>
            <div className="flex-1">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  pendingAttachments.length
                    ? "Describe the attachments or ask Chatify what to do with them..."
                    : "Describe your challenge. You can talk, type, or add files/images."
                }
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
              />
            </div>
            <button
              type="submit"
              disabled={!canSend || isThinking}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold transition ${
                !canSend || isThinking
                  ? "cursor-not-allowed bg-white/10 text-slate-300/60"
                  : "bg-emerald-400 text-slate-900 hover:bg-emerald-300"
              }`}
            >
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-5 w-5" />}
              <span>{isThinking ? "Thinking" : "Send"}</span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
