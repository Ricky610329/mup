export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

type SendHandler = (message: string) => void;
type FileHandler = (file: File) => void;
type ResetHandler = () => void;

/** Simple markdown: **bold**, `code`, ```codeblock```, newlines */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Line breaks: collapse double newlines into a single break
  html = html.replace(/\n{2,}/g, "<br>");
  html = html.replace(/\n/g, "<br>");

  return html;
}

export class ChatPanel {
  private container: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private onSend: SendHandler | null = null;
  private onFile: FileHandler | null = null;
  private onResetHandler: ResetHandler | null = null;
  private messages: ChatMessage[] = [];
  private eventBadgeArea: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add("chat-panel");

    // Header
    const header = document.createElement("div");
    header.className = "chat-header";
    header.innerHTML = `
      <div class="chat-header-brand">
        <div class="chat-header-logo">M</div>
        <span>Model UI Protocol</span>
      </div>
    `;

    const resetBtn = document.createElement("button");
    resetBtn.className = "chat-reset-btn";
    resetBtn.title = "Reset conversation";
    resetBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;
    resetBtn.addEventListener("click", () => this.handleReset());
    header.appendChild(resetBtn);

    this.container.appendChild(header);

    // Messages
    this.messagesEl = document.createElement("div");
    this.messagesEl.className = "chat-messages";
    this.container.appendChild(this.messagesEl);

    // Input area
    const inputArea = document.createElement("div");
    inputArea.className = "chat-input-area";

    // + button
    const addBtn = document.createElement("button");
    addBtn.className = "chat-add-btn";
    addBtn.title = "Load a MUP (.html file)";
    addBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".html,.htm";
    fileInput.style.display = "none";

    addBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file && this.onFile) this.onFile(file);
      fileInput.value = "";
    });

    // Input wrapper
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "chat-input-wrapper";

    this.inputEl = document.createElement("textarea");
    this.inputEl.className = "chat-input";
    this.inputEl.placeholder = "Message MUP...";
    this.inputEl.rows = 1;

    this.sendBtn = document.createElement("button");
    this.sendBtn.className = "chat-send-btn";
    this.sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;

    inputWrapper.appendChild(this.inputEl);
    inputWrapper.appendChild(this.sendBtn);

    inputArea.appendChild(addBtn);
    inputArea.appendChild(fileInput);
    inputArea.appendChild(inputWrapper);

    // Event badge area — between messages and input
    this.eventBadgeArea = document.createElement("div");
    this.eventBadgeArea.className = "event-badge-area";
    this.container.appendChild(this.eventBadgeArea);

    this.container.appendChild(inputArea);

    // Auto-resize
    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + "px";
    });

    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  onMessage(handler: SendHandler): void { this.onSend = handler; }
  onFileUpload(handler: FileHandler): void { this.onFile = handler; }
  onReset(handler: ResetHandler): void { this.onResetHandler = handler; }

  clearMessages(): void {
    this.messages = [];
    this.messagesEl.innerHTML = "";
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);

    if (message.role === "user") {
      const divider = document.createElement("div");
      divider.className = "chat-divider";
      this.messagesEl.appendChild(divider);
    }

    const msgEl = document.createElement("div");
    msgEl.className = `chat-message chat-message--${message.role}`;

    if (message.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "chat-avatar";
      avatar.textContent = "M";
      msgEl.appendChild(avatar);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "chat-message-content";

    if (message.role === "assistant") {
      contentEl.innerHTML = renderMarkdown(message.content);
    } else {
      contentEl.textContent = message.content;
    }

    msgEl.appendChild(contentEl);
    this.messagesEl.appendChild(msgEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Show a dismissible event badge + store hidden message for LLM context */
  addEventBadge(sourceName: string, summary: string): void {
    // Store in messages so LLM sees it via getMessages()
    this.messages.push({
      role: "system",
      content: `[${sourceName}] User: ${summary}`,
      timestamp: Date.now(),
    });
    // Replace existing badge from same source (avoid stacking)
    const existing = this.eventBadgeArea.querySelector(`[data-source="${sourceName}"]`);
    if (existing) existing.remove();

    const badge = document.createElement("div");
    badge.className = "event-badge";
    badge.dataset.source = sourceName;
    badge.innerHTML = `<span class="event-badge-name">${sourceName}</span><span class="event-badge-text">${summary}</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "event-badge-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => badge.remove());
    badge.appendChild(closeBtn);

    this.eventBadgeArea.appendChild(badge);

    // Auto-dismiss after 5 seconds
    setTimeout(() => badge.remove(), 5000);
  }

  getMessages(): ChatMessage[] { return [...this.messages]; }

  setLoading(loading: boolean): void {
    if (loading) {
      const el = document.createElement("div");
      el.className = "chat-message chat-message--assistant";
      el.id = "chat-loading";
      const av = document.createElement("div");
      av.className = "chat-avatar";
      av.textContent = "M";
      const dots = document.createElement("div");
      dots.className = "chat-loading-dots";
      dots.innerHTML = "<span></span><span></span><span></span>";
      el.appendChild(av);
      el.appendChild(dots);
      this.messagesEl.appendChild(el);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    } else {
      this.messagesEl.querySelector("#chat-loading")?.remove();
    }
  }

  private handleReset(): void {
    this.clearMessages();
    if (this.onResetHandler) this.onResetHandler();
  }

  private handleSend(): void {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.addMessage({ role: "user", content: text, timestamp: Date.now() });
    if (this.onSend) this.onSend(text);
  }
}
