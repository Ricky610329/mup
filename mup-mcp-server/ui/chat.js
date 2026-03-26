// ---- Built-in Chat Widget ----
const CHAT_MAX_HISTORY = 20;
let chatMessages = [];
let chatHistory = [];
let chatRenderedCount = 0;
let chatWidget = null;
let _chatDataLoaded = false;

function chatFormatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function chatFormatDate(ts) {
  return new Date(ts).toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}
function chatAutoLink(text) {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function chatArchiveCurrent() {
  if (chatMessages.length === 0) return;
  const first = chatMessages[0];
  chatHistory.unshift({
    id: String(first.timestamp),
    date: new Date(first.timestamp).toISOString(),
    preview: first.text.slice(0, 50),
    messageCount: chatMessages.length,
    messages: [...chatMessages]
  });
  if (chatHistory.length > CHAT_MAX_HISTORY) chatHistory.length = CHAT_MAX_HISTORY;
}

const CHAT_STORAGE_KEY = 'mup-chat-data';
function chatSyncState() {
  try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ _v: 1, messages: chatMessages, history: chatHistory })); } catch {}
  const last = chatMessages[chatMessages.length - 1];
  const summary = chatMessages.length === 0
    ? 'Chat: empty'
    : `Chat: ${chatMessages.length} messages, last: ${last.role} — ${last.text.slice(0, 60)}`;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "state", mupId: "mup-chat", summary }));
  }
}

function chatNotifyInteraction(action, summary, data) {
  addEventBadge("Chat", summary);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "interaction", mupId: "mup-chat", action, summary, data }));
  }
}

function chatCreateMsgEl(m) {
  const row = document.createElement('div');
  row.className = `chat-msg-row ${m.role}`;
  const bubble = document.createElement('div');
  bubble.className = `chat-msg ${m.role}`;
  if (m.image) {
    const img = document.createElement('img');
    img.src = m.image;
    img.alt = m.text || 'image';
    img.addEventListener('click', () => window.open(m.image, '_blank'));
    bubble.appendChild(img);
    if (m.text) {
      const caption = document.createElement('div');
      caption.style.marginTop = '4px';
      if (m.role === 'assistant') {
        try { caption.innerHTML = marked.parse(m.text); } catch { caption.textContent = m.text; }
      } else {
        caption.innerHTML = chatAutoLink(escapeHtml(m.text));
      }
      bubble.appendChild(caption);
    }
  } else if (m.role === 'assistant') {
    const content = document.createElement('div');
    try { content.innerHTML = marked.parse(m.text); } catch { content.textContent = m.text; }
    content.querySelectorAll('a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); });
    bubble.appendChild(content);
  } else {
    const content = document.createElement('div');
    content.innerHTML = chatAutoLink(escapeHtml(m.text));
    content.querySelectorAll('a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); });
    bubble.appendChild(content);
  }
  row.appendChild(bubble);
  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  meta.textContent = chatFormatTime(m.timestamp);
  row.appendChild(meta);
  return row;
}

function chatRenderIncremental() {
  if (!chatWidget) return;
  const msgsEl = chatWidget.querySelector('#chatMessages');
  const emptyEl = chatWidget.querySelector('#chatEmpty');
  if (!msgsEl) return;
  if (emptyEl) emptyEl.style.display = chatMessages.length === 0 ? 'flex' : 'none';
  for (let i = chatRenderedCount; i < chatMessages.length; i++) {
    msgsEl.appendChild(chatCreateMsgEl(chatMessages[i]));
  }
  chatRenderedCount = chatMessages.length;
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function chatRenderFull() {
  if (!chatWidget) return;
  const msgsEl = chatWidget.querySelector('#chatMessages');
  if (!msgsEl) return;
  msgsEl.querySelectorAll('.chat-msg-row').forEach(el => el.remove());
  chatRenderedCount = 0;
  chatRenderIncremental();
}

function chatRenderHistoryPanel() {
  if (!chatWidget) return;
  const listEl = chatWidget.querySelector('#chatHistoryList');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (chatHistory.length === 0) {
    listEl.innerHTML = '<div class="chat-history-empty">No archived sessions</div>';
    return;
  }
  chatHistory.forEach((session, idx) => {
    const item = document.createElement('div');
    item.className = 'chat-history-item';
    item.innerHTML = `
      <div class="chat-history-item-info">
        <div class="chat-history-item-date">${chatFormatDate(new Date(session.date).getTime())}</div>
        <div class="chat-history-item-preview">${escapeHtml(session.preview)}</div>
        <div class="chat-history-item-count">${session.messageCount} messages</div>
      </div>
      <button class="chat-history-delete" title="Delete">&times;</button>
    `;
    item.querySelector('.chat-history-item-info').addEventListener('click', () => {
      chatMessages = [...session.messages];
      chatRenderFull();
      chatSyncState();
      chatWidget.querySelector('#chatHistoryPanel').classList.remove('open');
    });
    item.querySelector('.chat-history-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      chatHistory.splice(idx, 1);
      chatSyncState();
      chatRenderHistoryPanel();
    });
    listEl.appendChild(item);
  });
}

let chatStagedImage = null;

function chatStageImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    chatStagedImage = { dataUrl: reader.result, fileName: file.name };
    chatRenderImagePreview();
  };
  reader.readAsDataURL(file);
}

function chatRenderImagePreview() {
  if (!chatWidget) return;
  const preview = chatWidget.querySelector('#chatImgPreview');
  if (!chatStagedImage) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }
  preview.style.display = 'flex';
  preview.innerHTML = `
    <img src="${chatStagedImage.dataUrl}" alt="preview">
    <span class="chat-img-preview-name">${escapeHtml(chatStagedImage.fileName)}</span>
    <button class="chat-img-preview-remove" title="Remove">&times;</button>
  `;
  preview.querySelector('.chat-img-preview-remove').addEventListener('click', () => {
    chatStagedImage = null;
    chatRenderImagePreview();
  });
}

function chatSendUserMessage() {
  if (!chatWidget) return;
  const input = chatWidget.querySelector('#chatInput');
  const text = input.value.trim();
  if (!text && !chatStagedImage) return;
  input.value = '';
  chatAutoResize(input);

  if (chatStagedImage) {
    const msg = { role: 'user', text: text || chatStagedImage.fileName, image: chatStagedImage.dataUrl, timestamp: Date.now() };
    chatMessages.push(msg);
    chatRenderIncremental();
    chatSyncState();
    chatNotifyInteraction('image', text || `[image] ${chatStagedImage.fileName}`, { image: chatStagedImage.dataUrl, fileName: chatStagedImage.fileName, text });
    chatStagedImage = null;
    chatRenderImagePreview();
  } else {
    chatMessages.push({ role: 'user', text, timestamp: Date.now() });
    chatRenderIncremental();
    chatSyncState();
    chatNotifyInteraction('message', text, { text });
  }
}

function chatAutoResize(el) {
  el.style.height = 'auto';
  const maxH = 120;
  el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
}

// Chat function implementation — manifest defined in src/index.ts (registerSystemMup).
function handleChatFunctionCall(fn, args) {
  switch (fn) {
    case 'sendMessage': {
      chatMessages.push({ role: 'assistant', text: args.text, timestamp: Date.now() });
      chatRenderIncremental();
      chatSyncState();
      return { content: [{ type: 'text', text: `Message sent: ${args.text.slice(0, 100)}` }], isError: false };
    }
    case 'getHistory': {
      const content = [];
      if (chatMessages.length === 0) {
        content.push({ type: 'text', text: 'No messages yet.' });
      } else {
        content.push({ type: 'text', text: chatMessages.map(m => `[${m.role}] ${m.text}`).join('\n') });
        for (const m of chatMessages) {
          if (m.image) {
            const match = m.image.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (match) {
              content.push({ type: 'text', text: `[image from ${m.role}: ${m.text}]` });
              content.push({ type: 'image', data: match[2], mimeType: match[1] });
            }
          }
        }
      }
      return { content, isError: false };
    }
    case 'clearHistory': {
      const count = chatMessages.length;
      chatArchiveCurrent();
      chatMessages = [];
      chatRenderFull();
      chatSyncState();
      return { content: [{ type: 'text', text: count > 0 ? `Archived and cleared ${count} messages.` : 'Chat already empty.' }], isError: false };
    }
    case 'resume': {
      if (chatHistory.length === 0) return { content: [{ type: 'text', text: 'No archived sessions to resume.' }], isError: false };
      const session = chatHistory[0];
      chatMessages = [...session.messages];
      chatRenderFull();
      chatSyncState();
      return { content: [{ type: 'text', text: `Resumed session from ${chatFormatDate(new Date(session.date).getTime())} with ${session.messageCount} messages.` }], isError: false };
    }
    case 'listHistory': {
      if (chatHistory.length === 0) return { content: [{ type: 'text', text: 'No archived sessions.' }], isError: false };
      const list = chatHistory.map(s =>
        `[${s.id}] ${chatFormatDate(new Date(s.date).getTime())} — ${s.messageCount} msgs — ${s.preview}`
      ).join('\n');
      return { content: [{ type: 'text', text: list }, { type: 'data', data: { sessions: chatHistory.map(({ messages: _, ...rest }) => rest) } }], isError: false };
    }
    case 'loadSession': {
      const session = chatHistory.find(s => s.id === args.id);
      if (!session) return { content: [{ type: 'text', text: `Session ${args.id} not found.` }], isError: true };
      chatMessages = [...session.messages];
      chatRenderFull();
      chatSyncState();
      return { content: [{ type: 'text', text: `Loaded session from ${chatFormatDate(new Date(session.date).getTime())} with ${session.messageCount} messages.` }], isError: false };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown function: ${fn}` }], isError: true };
  }
}

function renderChatCard() {
  if (!grid || chatWidget) return;
  const el = document.createElement('div');
  el.classList.add('grid-stack-item');
  el.setAttribute('gs-w', '1');
  el.setAttribute('gs-h', '1');
  el.setAttribute('gs-x', '1');
  el.setAttribute('gs-y', '0');
  el.setAttribute('gs-id', 'mup-chat');

  el.innerHTML = `
    <div class="grid-stack-item-content">
      <div class="mup-card-header" style="cursor:grab;">
        <span class="mup-name">Chat</span>
        <button class="mup-close-btn" id="chatHistoryBtn" title="Chat history" style="color:var(--text-secondary);font-size:14px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
      </div>
      <div class="chat-history-panel" id="chatHistoryPanel">
        <div class="mup-card-header" style="cursor:default;">
          <span class="mup-name">History</span>
          <button class="mup-close-btn" id="chatHistoryCloseBtn" title="Close" style="color:var(--text-secondary);">&times;</button>
        </div>
        <div class="chat-history-list" id="chatHistoryList"></div>
      </div>
      <div class="chat-messages" id="chatMessages">
        <div class="chat-empty" id="chatEmpty">Send a message to start chatting</div>
      </div>
      <div class="chat-img-preview" id="chatImgPreview" style="display:none;"></div>
      <div class="chat-input-bar">
        <button class="chat-img-btn" id="chatImgBtn" title="Send image"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></button>
        <input type="file" id="chatImgInput" accept="image/*" style="display:none">
        <textarea id="chatInput" placeholder="Type a message..." rows="1" autocomplete="off"></textarea>
        <button id="chatSendBtn">Send</button>
      </div>
    </div>`;

  chatWidget = grid.makeWidget(el);
  applyPendingLayout('mup-chat', chatWidget);

  const input = chatWidget.querySelector('#chatInput');
  const sendBtn = chatWidget.querySelector('#chatSendBtn');
  const histBtn = chatWidget.querySelector('#chatHistoryBtn');
  const histCloseBtn = chatWidget.querySelector('#chatHistoryCloseBtn');
  const histPanel = chatWidget.querySelector('#chatHistoryPanel');
  const imgBtn = chatWidget.querySelector('#chatImgBtn');
  const imgInput = chatWidget.querySelector('#chatImgInput');

  input.addEventListener('input', () => chatAutoResize(input));

  imgBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  imgBtn.addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', () => {
    for (const file of imgInput.files) chatStageImage(file);
    imgInput.value = '';
  });

  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });

  sendBtn.addEventListener('click', chatSendUserMessage);
  sendBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !composing && !e.isComposing) {
      e.preventDefault();
      chatSendUserMessage();
    }
  });

  input.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        chatStageImage(item.getAsFile());
        return;
      }
    }
  });

  const msgsEl = chatWidget.querySelector('#chatMessages');
  msgsEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  msgsEl.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith('image/')) chatStageImage(file);
    }
  });

  histBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  histBtn.addEventListener('click', () => {
    const isOpen = histPanel.classList.toggle('open');
    if (isOpen) chatRenderHistoryPanel();
  });
  histCloseBtn.addEventListener('click', () => histPanel.classList.remove('open'));
}

function initChatWidget() {
  if (!_chatDataLoaded) {
    _chatDataLoaded = true;
    try {
      const stored = localStorage.getItem(CHAT_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data._v === 1) {
          if (data.history) chatHistory = data.history;
          if (data.messages?.length > 0) {
            chatMessages = data.messages;
            chatArchiveCurrent();
            chatMessages = [];
          }
        }
      }
    } catch {}
  }
  if (!chatWidget) renderChatCard();
  chatRenderFull();
  chatSyncState();
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "mup-loaded", mupId: "mup-chat" }));
}

// ---- Permission Relay ----

function showPermissionRequest(requestId, toolName, description, inputPreview) {
  // Ensure chat widget exists
  if (!chatWidget) initChatWidget();
  if (!chatWidget) return;

  const msgsEl = chatWidget.querySelector('#chatMessages');
  const emptyEl = chatWidget.querySelector('#chatEmpty');
  if (!msgsEl) return;
  if (emptyEl) emptyEl.style.display = 'none';

  const row = document.createElement('div');
  row.className = 'chat-msg-row assistant';
  row.setAttribute('data-permission-id', requestId);
  row.innerHTML = `
    <div class="chat-msg assistant chat-permission">
      <div class="chat-permission-header">Permission Request</div>
      <div class="chat-permission-tool">${escapeHtml(toolName)}</div>
      <div class="chat-permission-desc">${escapeHtml(description)}</div>
      ${inputPreview ? `<pre class="chat-permission-preview">${escapeHtml(inputPreview)}</pre>` : ''}
      <div class="chat-permission-actions">
        <button class="chat-permission-btn allow" data-request-id="${escapeHtml(requestId)}">Allow</button>
        <button class="chat-permission-btn deny" data-request-id="${escapeHtml(requestId)}">Deny</button>
      </div>
    </div>`;

  row.querySelector('.chat-permission-btn.allow').addEventListener('click', (e) => {
    e.stopPropagation();
    sendPermissionVerdict(requestId, 'allow');
    resolvePermissionUI(row, 'Allowed');
  });
  row.querySelector('.chat-permission-btn.deny').addEventListener('click', (e) => {
    e.stopPropagation();
    sendPermissionVerdict(requestId, 'deny');
    resolvePermissionUI(row, 'Denied');
  });

  msgsEl.appendChild(row);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  addEventBadge("Permission", `${toolName}: ${description.slice(0, 60)}`);
}

function sendPermissionVerdict(requestId, behavior) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "permission-verdict", requestId, behavior }));
  }
}

function resolvePermissionUI(row, label) {
  const actions = row.querySelector('.chat-permission-actions');
  if (actions) {
    const isAllow = label === 'Allowed';
    actions.innerHTML = `<span class="chat-permission-resolved ${isAllow ? 'allow' : 'deny'}">${label}</span>`;
  }
}
