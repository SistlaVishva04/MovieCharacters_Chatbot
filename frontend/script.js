const CHAT_API_BASE_URL = window.MOVIE_CHARACTER_CHAT_CONFIG?.apiBaseUrl;
if (typeof CHAT_API_BASE_URL !== "string" || !CHAT_API_BASE_URL.trim()) {
    throw new Error("Missing apiBaseUrl in frontend/config.js.");
}
const CHAT_API_URL = `${CHAT_API_BASE_URL.replace(/\/+$/, "")}/chat`;
const CHAT_REQUEST_TIMEOUT_MS = 90000;
const MAX_CONTEXT_MESSAGES = 16;
const MAX_CONVERSATIONS = 50;
const MAX_STORED_MESSAGES = 80;
const MAX_STORAGE_CHARACTERS = 1500000;
const HISTORY_STORAGE_KEY = "movie-character-chatbot:conversations:v1";
const HISTORY_VERSION = 1;
const NEW_CONVERSATION_TITLE = "New conversation";
const HOLLYWOOD_CHARACTERS = new Set([
    "spiderman", "iron man", "captain america", "jack sparrow", "deadpool",
    "batman", "superman", "doctor strange", "thor", "harry potter",
    "john wick", "mufasa"
]);

let conversations = [];
let currentConversation = null;
let currentCharacter = null;
let isSending = false;
let storageWritable = true;
let storageNoticeMessage = "";
let manageAction = null;

class ChatRequestError extends Error {
    constructor(status, code) {
        super(code || "chat_request_failed");
        this.status = status;
        this.code = code;
    }
}

function getSelectedCharacter() {
    return new URLSearchParams(window.location.search).get("character");
}

function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function makeCharacterFromCard(card) {
    return {
        id: card.dataset.name,
        displayName: card.querySelector("h2").textContent.trim(),
        description: card.querySelector("p").textContent.trim(),
        image: card.querySelector("img").getAttribute("src")
    };
}

function navigateToCharacter(character) {
    const params = new URLSearchParams({
        character: character.id,
        name: character.displayName,
        description: character.description,
        image: character.image
    });
    window.location.href = `chat.html?${params.toString()}`;
}

function startChat(card) {
    navigateToCharacter(makeCharacterFromCard(card));
}

function resolveCharacterImage(path) {
    if (typeof path !== "string" || !path.trim()) return "";
    try {
        const imageUrl = new URL(path, window.location.href);
        const imagesPath = new URL("images/", window.location.href).pathname;
        if (imageUrl.origin === window.location.origin && imageUrl.pathname.startsWith(imagesPath)) {
            return imageUrl.href;
        }
    } catch (_error) {
        return "";
    }
    return "";
}

function normalizeMessages(messages) {
    if (!Array.isArray(messages) || messages.length > MAX_STORED_MESSAGES || messages.length % 2 !== 0) {
        return null;
    }

    const normalized = [];
    for (let index = 0; index < messages.length; index += 1) {
        const item = messages[index];
        const expectedRole = index % 2 === 0 ? "user" : "assistant";
        if (
            !item ||
            item.role !== expectedRole ||
            typeof item.content !== "string" ||
            !item.content.trim()
        ) {
            return null;
        }
        normalized.push({ role: expectedRole, content: item.content });
    }
    return normalized;
}

function normalizeConversation(item) {
    if (!item || typeof item !== "object") return null;
    const requiredStringFields = ["id", "characterId", "characterName", "title", "createdAt", "updatedAt"];
    if (requiredStringFields.some((field) => typeof item[field] !== "string" || !item[field].trim())) {
        return null;
    }
    if (
        typeof item.characterDescription !== "string" ||
        typeof item.characterImage !== "string"
    ) {
        return null;
    }
    if (!Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))) {
        return null;
    }
    if (item.characterId.length > 80 || item.characterName.length > 80 || item.characterDescription.length > 600) {
        return null;
    }
    const messages = normalizeMessages(item.messages);
    if (!messages) return null;
    return {
        id: item.id,
        characterId: item.characterId,
        characterName: item.characterName,
        characterDescription: item.characterDescription,
        characterImage: item.characterImage,
        title: item.title.slice(0, 70),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messages
    };
}

function readConversations() {
    let storage;
    try {
        storage = window.localStorage;
        const saved = storage.getItem(HISTORY_STORAGE_KEY);
        if (saved === null) return [];

        const data = JSON.parse(saved);
        if (!data || data.version !== HISTORY_VERSION || !Array.isArray(data.conversations)) {
            storageWritable = false;
            storageNoticeMessage = "Saved conversations use an unsupported format. This session will not overwrite them.";
            return [];
        }

        const seen = new Set();
        return data.conversations
            .map(normalizeConversation)
            .filter((conversation) => {
                if (!conversation || seen.has(conversation.id)) return false;
                seen.add(conversation.id);
                return true;
            })
            .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
            .slice(0, MAX_CONVERSATIONS);
    } catch (error) {
        storageWritable = false;
        storageNoticeMessage = error instanceof SyntaxError
            ? "Saved conversation data could not be read. It has been left untouched."
            : "Local storage is unavailable. Conversations will remain in this tab only.";
        console.warn("Conversation history could not be loaded.");
        return [];
    }
}

function showStorageNotice(message) {
    storageNoticeMessage = message;
    const notice = document.getElementById("storageNotice");
    if (notice) notice.textContent = message;
}

function persistConversations() {
    if (!storageWritable) {
        showStorageNotice(storageNoticeMessage);
        return false;
    }

    let pending = [...conversations]
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, MAX_CONVERSATIONS);
    const activeId = currentConversation ? currentConversation.id : null;
    let pruned = pending.length < conversations.length;

    while (true) {
        const serialized = JSON.stringify({ version: HISTORY_VERSION, conversations: pending });
        if (serialized.length > MAX_STORAGE_CHARACTERS) {
            const oldestIndex = pending.findLastIndex
                ? pending.findLastIndex((item) => item.id !== activeId)
                : findOldestPrunableIndex(pending, activeId);
            if (oldestIndex < 0) {
                showStorageNotice("This conversation is too large to save. Older chats were kept.");
                return false;
            }
            pending.splice(oldestIndex, 1);
            pruned = true;
            continue;
        }

        try {
            window.localStorage.setItem(HISTORY_STORAGE_KEY, serialized);
            conversations = pending;
            showStorageNotice(pruned ? "Older conversations were removed to keep local history within its storage limit." : "");
            renderConversationList();
            return true;
        } catch (_error) {
            const oldestIndex = findOldestPrunableIndex(pending, activeId);
            if (oldestIndex >= 0) {
                pending.splice(oldestIndex, 1);
                pruned = true;
                continue;
            }
            showStorageNotice("Local storage is full or unavailable. This conversation is only available until this tab closes.");
            return false;
        }
    }
}

function findOldestPrunableIndex(items, activeId) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index].id !== activeId) return index;
    }
    return -1;
}

function createConversation(character) {
    const timestamp = new Date().toISOString();
    currentCharacter = { ...character };
    currentConversation = {
        id: makeId(),
        characterId: character.id,
        characterName: character.displayName,
        characterDescription: character.description,
        characterImage: character.image,
        title: NEW_CONVERSATION_TITLE,
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
    };
    conversations.push(currentConversation);
    persistConversations();
    updateConversationUrl(currentConversation.id);
    renderConversationList();
    renderChatTranscript();
    updateChatStatus(`Ready to chat with ${currentCharacter.displayName}.`, "idle");
}

function updateConversationUrl(id) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("conversation", id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function openConversation(id) {
    window.location.href = `chat.html?conversation=${encodeURIComponent(id)}`;
}

function startNewConversation() {
    if (currentCharacter) {
        navigateToCharacter(currentCharacter);
        return;
    }
    closeHistorySidebar();
    document.getElementById("characters")?.scrollIntoView({ behavior: "smooth" });
    document.getElementById("searchInput")?.focus({ preventScroll: true });
}

function formatActivity(timestamp) {
    const activity = Date.parse(timestamp);
    if (!Number.isFinite(activity)) return "Recently";
    const elapsed = Math.max(0, Date.now() - activity);
    if (elapsed < 24 * 60 * 60 * 1000) return "Today";
    if (elapsed < 48 * 60 * 60 * 1000) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(activity);
}

function makeHistoryButton(conversation) {
    const entry = document.createElement("article");
    entry.className = "conversation-entry";
    entry.setAttribute("role", "listitem");
    if (currentConversation && conversation.id === currentConversation.id) {
        entry.classList.add("is-current");
    }

    const openButton = document.createElement("button");
    openButton.className = "conversation-open";
    openButton.type = "button";
    openButton.dataset.openConversation = conversation.id;
    openButton.setAttribute("aria-label", `Open ${conversation.title} with ${conversation.characterName}`);
    if (currentConversation && conversation.id === currentConversation.id) {
        openButton.setAttribute("aria-current", "page");
    }

    const image = document.createElement("img");
    image.alt = "";
    image.width = 42;
    image.height = 42;
    image.loading = "lazy";
    const imageSrc = resolveCharacterImage(conversation.characterImage);
    if (imageSrc) image.src = imageSrc;

    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;

    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    const character = document.createElement("span");
    character.className = "conversation-character";
    character.textContent = conversation.characterName;
    const activity = document.createElement("time");
    activity.dateTime = conversation.updatedAt;
    activity.textContent = formatActivity(conversation.updatedAt);
    meta.append(character, activity);
    copy.append(title, meta);
    openButton.append(image, copy);

    const actions = document.createElement("div");
    actions.className = "conversation-actions";
    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.dataset.renameConversation = conversation.id;
    renameButton.setAttribute("aria-label", `Rename ${conversation.title}`);
    renameButton.textContent = "Rename";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.dataset.deleteConversation = conversation.id;
    deleteButton.setAttribute("aria-label", `Delete ${conversation.title}`);
    deleteButton.textContent = "Delete";
    actions.append(renameButton, deleteButton);
    entry.append(openButton, actions);
    return entry;
}

function renderConversationList() {
    const list = document.getElementById("conversationList");
    const empty = document.getElementById("historyEmpty");
    const notice = document.getElementById("storageNotice");
    if (!list) return;

    list.replaceChildren();
    conversations
        .slice()
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .forEach((conversation) => list.appendChild(makeHistoryButton(conversation)));

    if (empty) empty.hidden = conversations.length > 0;
    if (notice) notice.textContent = storageNoticeMessage;
}

function setHistorySidebarOpen(open) {
    const sidebar = document.getElementById("historySidebar");
    const backdrop = document.getElementById("historyBackdrop");
    const toggle = document.getElementById("historyToggle");
    if (!sidebar) return;

    sidebar.classList.toggle("is-open", open);
    sidebar.setAttribute("aria-hidden", String(!open));
    if (backdrop) backdrop.hidden = !open;
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
    if (open) document.getElementById("historyCloseButton")?.focus();
    else toggle?.focus();
}

function isMobileHistoryDrawer() {
    return Boolean(
        document.querySelector(".history-drawer") ||
        (window.matchMedia && window.matchMedia("(max-width: 900px)").matches)
    );
}

function closeHistorySidebar() {
    const sidebar = document.getElementById("historySidebar");
    if (!sidebar) return;
    if (isMobileHistoryDrawer()) {
        setHistorySidebarOpen(false);
    } else {
        const shell = document.querySelector(".chat-shell");
        const toggle = document.getElementById("historyToggle");
        if (shell) shell.classList.add("is-collapsed");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
}

function syncHistoryLayout() {
    const sidebar = document.getElementById("historySidebar");
    const shell = document.querySelector(".chat-shell");
    const backdrop = document.getElementById("historyBackdrop");
    const toggle = document.getElementById("historyToggle");
    if (!sidebar || !shell) return;

    if (isMobileHistoryDrawer()) {
        const isOpen = sidebar.classList.contains("is-open");
        sidebar.setAttribute("aria-hidden", String(!isOpen));
        if (backdrop) backdrop.hidden = !isOpen;
        if (toggle) toggle.setAttribute("aria-expanded", String(isOpen));
        return;
    }

    sidebar.classList.remove("is-open");
    sidebar.setAttribute("aria-hidden", "false");
    if (backdrop) backdrop.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", String(!shell.classList.contains("is-collapsed")));
}

function initializeHistoryControls() {
    const sidebar = document.getElementById("historySidebar");
    const toggle = document.getElementById("historyToggle");
    const closeButton = document.getElementById("historyCloseButton");
    const backdrop = document.getElementById("historyBackdrop");
    const newChat = document.getElementById("newConversationButton");
    const headerNewChat = document.getElementById("headerNewChat");
    const list = document.getElementById("conversationList");
    const shell = document.querySelector(".chat-shell");

    if (toggle) {
        if (sidebar?.classList.contains("history-drawer")) {
            sidebar.setAttribute("aria-hidden", "true");
            toggle.setAttribute("aria-expanded", "false");
        } else if (isMobileHistoryDrawer()) {
            sidebar?.setAttribute("aria-hidden", "true");
            toggle.setAttribute("aria-expanded", "false");
        }
        toggle.addEventListener("click", () => {
            if (isMobileHistoryDrawer()) {
                setHistorySidebarOpen(sidebar?.getAttribute("aria-hidden") === "true");
                return;
            }
            shell?.classList.toggle("is-collapsed");
            toggle.setAttribute("aria-expanded", String(!shell?.classList.contains("is-collapsed")));
        });
    }
    closeButton?.addEventListener("click", closeHistorySidebar);
    backdrop?.addEventListener("click", closeHistorySidebar);
    newChat?.addEventListener("click", startNewConversation);
    headerNewChat?.addEventListener("click", startNewConversation);

    list?.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("button") : null;
        if (!target) return;
        if (target.dataset.openConversation) {
            openConversation(target.dataset.openConversation);
        } else if (target.dataset.renameConversation) {
            showConversationDialog("rename", target.dataset.renameConversation);
        } else if (target.dataset.deleteConversation) {
            showConversationDialog("delete", target.dataset.deleteConversation);
        }
    });

    window.addEventListener("resize", syncHistoryLayout);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && sidebar?.classList.contains("is-open")) {
            closeHistorySidebar();
        }
    });
}

function showConversationDialog(action, id) {
    const dialog = document.getElementById("manageDialog");
    const title = document.getElementById("dialogTitle");
    const message = document.getElementById("dialogMessage");
    const input = document.getElementById("dialogInput");
    const inputLabel = document.getElementById("dialogInputLabel");
    const confirmButton = document.getElementById("dialogConfirm");
    const conversation = conversations.find((item) => item.id === id);
    if (!dialog || !title || !message || !input || !inputLabel || !confirmButton || !conversation) return;

    manageAction = { action, id };
    input.hidden = action !== "rename";
    inputLabel.hidden = action !== "rename";
    input.required = action === "rename";
    confirmButton.textContent = action === "rename" ? "Save title" : "Delete conversation";
    confirmButton.classList.toggle("danger-button", action === "delete");

    if (action === "rename") {
        title.textContent = "Rename conversation";
        message.textContent = "Choose a title you will recognize in your history.";
        input.value = conversation.title;
    } else {
        title.textContent = "Delete this conversation?";
        message.textContent = `“${conversation.title}” will be removed from this browser. Other conversations will stay saved.`;
        input.value = "";
    }

    dialog.showModal();
    if (action === "rename") input.focus();
    else confirmButton.focus();
}

function initializeManageDialog() {
    const dialog = document.getElementById("manageDialog");
    const form = document.getElementById("manageForm");
    if (!dialog || !form) return;

    dialog.querySelectorAll("[data-dialog-cancel]").forEach((button) => {
        button.addEventListener("click", () => dialog.close());
    });
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!manageAction) return;

        if (manageAction.action === "rename") {
            const input = document.getElementById("dialogInput");
            const newTitle = input.value.trim();
            if (!newTitle) {
                input.focus();
                return;
            }
            const conversation = conversations.find((item) => item.id === manageAction.id);
            if (conversation) {
                conversation.title = newTitle.slice(0, 70);
                persistConversations();
                renderConversationList();
            }
        } else {
            const deletingCurrent = currentConversation && currentConversation.id === manageAction.id;
            conversations = conversations.filter((item) => item.id !== manageAction.id);
            if (deletingCurrent) currentConversation = null;
            persistConversations();
            renderConversationList();
            dialog.close();
            manageAction = null;
            if (deletingCurrent) {
                window.location.href = "index.html";
                return;
            }
            return;
        }

        dialog.close();
        manageAction = null;
    });
}

function updateChatStatus(message, state) {
    const status = document.getElementById("chat-status");
    const form = document.getElementById("chat-form");
    const sendButton = document.getElementById("send-btn");
    const messageInput = document.getElementById("message-input");
    if (!status || !form || !sendButton || !messageInput) return;

    status.textContent = message;
    status.dataset.state = state;
    form.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    sendButton.disabled = state === "loading" || !messageInput.value.trim();
    sendButton.setAttribute("aria-label", state === "loading" ? "Waiting for character response" : "Send message");
    sendButton.querySelector("span").textContent = state === "loading" ? "Waiting…" : "Send";
}

function addMessageToChat(text, isUser, className = "") {
    const chatContainer = document.getElementById("chat-container");
    if (!chatContainer) return null;

    const message = document.createElement("div");
    message.classList.add("message", isUser ? "user-message" : "bot-message");
    if (className) message.classList.add(className);
    message.textContent = text;
    chatContainer.appendChild(message);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return message;
}

function addTypingIndicator(characterName) {
    const indicator = addMessageToChat("", false, "typing-message");
    if (!indicator) return null;
    indicator.setAttribute("aria-label", `${characterName} is thinking`);
    indicator.setAttribute("role", "status");
    for (let index = 0; index < 3; index += 1) {
        const dot = document.createElement("span");
        dot.setAttribute("aria-hidden", "true");
        indicator.appendChild(dot);
    }
    return indicator;
}

function renderChatTranscript() {
    const chatContainer = document.getElementById("chat-container");
    const characterName = document.getElementById("characterName");
    const characterImage = document.getElementById("characterImage");
    if (!chatContainer || !characterName || !characterImage || !currentCharacter) return;

    characterName.textContent = currentCharacter.displayName;
    characterImage.alt = `${currentCharacter.displayName} portrait`;
    const imageSrc = resolveCharacterImage(currentCharacter.image);
    if (imageSrc) {
        characterImage.src = imageSrc;
        characterImage.hidden = false;
    } else {
        characterImage.hidden = true;
    }

    chatContainer.replaceChildren();
    if (currentConversation.messages.length === 0) {
        addMessageToChat(`Hey! I'm ${currentCharacter.displayName}. Let's chat!`, false, "welcome-message");
        return;
    }
    currentConversation.messages.forEach((item) => {
        addMessageToChat(item.content, item.role === "user");
    });
}

function setChatUnavailable(message) {
    const input = document.getElementById("message-input");
    const button = document.getElementById("send-btn");
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    updateChatStatus(message, "error");
}

function initializeChatPage() {
    const chatContainer = document.getElementById("chat-container");
    const messageInput = document.getElementById("message-input");
    const sendButton = document.getElementById("send-btn");
    const chatForm = document.getElementById("chat-form");
    if (!chatContainer || !messageInput || !sendButton || !chatForm) return;

    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("conversation");
    const savedConversation = conversationId
        ? conversations.find((item) => item.id === conversationId)
        : null;

    if (savedConversation) {
        currentConversation = savedConversation;
        currentCharacter = {
            id: savedConversation.characterId,
            displayName: savedConversation.characterName,
            description: savedConversation.characterDescription,
            image: savedConversation.characterImage
        };
        renderChatTranscript();
        updateChatStatus(`Conversation with ${currentCharacter.displayName}.`, "idle");
    } else {
        const characterId = getSelectedCharacter();
        if (!characterId) {
            setChatUnavailable(conversationId
                ? "This saved conversation is unavailable. Choose a character to begin a new one."
                : "Choose a character from the home page to start chatting.");
            return;
        }

        const character = {
            id: characterId,
            displayName: params.get("name") || characterId,
            description: params.get("description") || "",
            image: params.get("image") || ""
        };
        createConversation(character);
    }

    messageInput.disabled = false;
    sendButton.disabled = true;
    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 160)}px`;
        if (!isSending) sendButton.disabled = !messageInput.value.trim();
    });
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            if (messageInput.value.trim() && !isSending) chatForm.requestSubmit();
        }
    });
    chatForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (isSending || !currentCharacter || !currentConversation) return;

        const userMessage = messageInput.value.trim();
        if (!userMessage) return;
        const userBubble = addMessageToChat(userMessage, true);
        messageInput.value = "";
        messageInput.style.height = "auto";
        isSending = true;
        updateChatStatus(
            `Waiting for ${currentCharacter.displayName}. The service may take a moment to wake up.`,
            "loading"
        );
        const typingIndicator = addTypingIndicator(currentCharacter.displayName);

        try {
            const history = currentConversation.messages.slice(-MAX_CONTEXT_MESSAGES);
            const reply = await sendMessageToBackend(userMessage, currentCharacter, history);
            currentConversation.messages.push(
                { role: "user", content: userMessage },
                { role: "assistant", content: reply }
            );
            currentConversation.messages = currentConversation.messages.slice(-MAX_STORED_MESSAGES);
            currentConversation.updatedAt = new Date().toISOString();
            if (currentConversation.title === NEW_CONVERSATION_TITLE) {
                currentConversation.title = userMessage.replace(/\s+/g, " ").slice(0, 70) || NEW_CONVERSATION_TITLE;
            }
            typingIndicator?.remove();
            addMessageToChat(reply, false);
            persistConversations();
            renderConversationList();
            updateChatStatus("Reply received.", "success");
        } catch (error) {
            console.error("Chat request failed:", error);
            typingIndicator?.remove();
            userBubble?.classList.add("message-unsent");
            const errorMessage = getChatErrorMessage(error);
            addMessageToChat(errorMessage, false, "error-message");
            updateChatStatus(errorMessage, "error");
        } finally {
            isSending = false;
            sendButton.disabled = !messageInput.value.trim();
            sendButton.setAttribute("aria-label", "Send message");
            sendButton.querySelector("span").textContent = "Send";
            chatForm.setAttribute("aria-busy", "false");
        }
    });
}

async function sendMessageToBackend(userMessage, character, history) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
        () => controller.abort(),
        CHAT_REQUEST_TIMEOUT_MS
    );

    try {
        const response = await fetch(CHAT_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                character: {
                    name: character.id,
                    description: character.description
                },
                message: userMessage,
                history
            }),
            signal: controller.signal
        });

        let data;
        try {
            data = await response.json();
        } catch (_error) {
            throw new ChatRequestError(response.status, "invalid_response");
        }

        if (!response.ok) {
            throw new ChatRequestError(response.status, data.code);
        }
        if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
            throw new ChatRequestError(response.status, "invalid_response");
        }
        return data.reply.trim();
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function getChatErrorMessage(error) {
    if (error.name === "AbortError") {
        return "The service is taking longer than expected to wake up. Please try again.";
    }
    const messages = {
        rate_limited: "Too many messages too quickly. Please wait a moment and try again.",
        ai_quota_exceeded: "The chat service is at capacity. Please try again later.",
        ai_timeout: "The character took too long to respond. Please try again.",
        ai_unavailable: "The chat service is temporarily unavailable. Please try again shortly.",
        ai_provider_error: "The character could not respond just now. Please try again.",
        empty_ai_response: "The character could not respond just now. Please try again.",
        invalid_payload: "The message could not be sent. Please reload the chat and try again.",
        invalid_response: "The chat service returned an unexpected response. Please try again."
    };
    if (error instanceof ChatRequestError) {
        return messages[error.code] || "The character could not respond just now. Please try again.";
    }
    return "Could not connect to the chat service. Please check your connection and try again.";
}

function filterCharacters() {
    const searchInput = document.getElementById("searchInput");
    const notFound = document.getElementById("notFound");
    const searchStatus = document.getElementById("searchStatus");
    const characterCount = document.getElementById("characterCount");
    if (!searchInput || !notFound) return;

    const query = searchInput.value.trim().toLocaleLowerCase();
    const activeFilter = document.querySelector(".filter-chip.is-selected")?.dataset.filter || "all";
    const cards = document.querySelectorAll(".character");
    let matchCount = 0;
    cards.forEach((card) => {
        const searchableText = [
            card.dataset.name,
            card.querySelector("h2")?.textContent,
            card.querySelector("p")?.textContent
        ].filter(Boolean).join(" ").toLocaleLowerCase();
        const category = card.dataset.category || "indian";
        const matches = searchableText.includes(query) && (activeFilter === "all" || category === activeFilter);
        card.hidden = !matches;
        if (matches) matchCount += 1;
    });

    notFound.hidden = matchCount > 0;
    if (characterCount) {
        characterCount.textContent = `${matchCount} character${matchCount === 1 ? "" : "s"}`;
    }
    if (searchStatus) {
        searchStatus.textContent = query || activeFilter !== "all"
            ? `${matchCount} character${matchCount === 1 ? "" : "s"} found.`
            : "";
    }
    const clearSearch = document.getElementById("clearSearch");
    if (clearSearch) clearSearch.hidden = !searchInput.value;
}

function initializeCataloguePage() {
    const searchInput = document.getElementById("searchInput");
    const clearSearch = document.getElementById("clearSearch");
    if (!searchInput) return;

    document.querySelectorAll(".character").forEach((card) => {
        const id = card.dataset.name;
        card.dataset.category = HOLLYWOOD_CHARACTERS.has(id) ? "hollywood" : "indian";
        const image = card.querySelector("img");
        if (image) {
            image.loading = "lazy";
            image.decoding = "async";
            image.width = 600;
            image.height = 750;
        }
        const button = card.querySelector(".talk-btn");
        button?.addEventListener("click", (event) => {
            event.stopPropagation();
            startChat(card);
        });
    });
    searchInput.addEventListener("input", filterCharacters);
    clearSearch?.addEventListener("click", () => {
        searchInput.value = "";
        filterCharacters();
        searchInput.focus();
    });
    document.querySelectorAll(".filter-chip").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".filter-chip").forEach((chip) => {
                chip.classList.toggle("is-selected", chip === button);
                chip.setAttribute("aria-pressed", String(chip === button));
            });
            filterCharacters();
        });
    });
    filterCharacters();
}

function initializeConversationState() {
    conversations = readConversations();
    renderConversationList();
    initializeHistoryControls();
    initializeManageDialog();
}

document.addEventListener("DOMContentLoaded", () => {
    initializeConversationState();
    initializeCataloguePage();
    initializeChatPage();
});
