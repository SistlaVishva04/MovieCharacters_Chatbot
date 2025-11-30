// -------------------------
// Get Selected Character from URL
// -------------------------
function getSelectedCharacter() {
    const params = new URLSearchParams(window.location.search);
    return params.get("character");
}

// -------------------------
// Navigate to Chat Page
// -------------------------
function startChat(character) {
    window.location.href = `chat.html?character=${character}`;
}

// -------------------------
// Send Message to Backend
// -------------------------
async function sendMessageToBackend(userMessage) {
    const character = getSelectedCharacter();
    if (!character) {
        console.error("Character not found!");
        addMessageToChat("Error: Character not found!", false);
        return;
    }

    try {
        console.log("📨 Sending request to backend...");

        const response = await fetch("https://moviecharacters-chattt.onrender.com/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                character: { 
                    name: character, 
                    description: "A famous movie character with a unique personality."
                },
                message: userMessage
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Response received:", data);

        if (data.reply) {
            addMessageToChat(data.reply, false);
        } else {
            addMessageToChat("Sorry, an error occurred.", false);
        }
    } catch (error) {
        console.error("Network error:", error);
        addMessageToChat("Connection issue. Try again later.", false);
    }
}

// -------------------------
// Add Message to Chat UI
// -------------------------
function addMessageToChat(text, isUser) {
    const chatContainer = document.getElementById("chat-container");
    if (!chatContainer) return;

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", isUser ? "user-message" : "bot-message");
    messageDiv.textContent = text;
    chatContainer.appendChild(messageDiv);

    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// -------------------------
// DOM Loaded (Chat Page Only)
// -------------------------
document.addEventListener("DOMContentLoaded", () => {
    
    const isChatPage = window.location.pathname.includes("chat.html");

    if (isChatPage) {
        const character = getSelectedCharacter();

        // Set name
        const nameBox = document.getElementById("characterName");
        if (nameBox && character) {
            nameBox.textContent = character;
        }

        // Set image
        const img = document.getElementById("characterImage");
        if (img && character) {
            img.src = `images/${character}.jpeg`;
        }

        // First welcome message
        addMessageToChat(`Hey! I'm ${character}. Let's chat!`, false);

        // Setup send button
        const sendButton = document.getElementById("send-btn");
        const messageInput = document.getElementById("message-input");

        sendButton.addEventListener("click", () => {
            const userMessage = messageInput.value.trim();
            if (userMessage !== "") {
                addMessageToChat(userMessage, true);
                sendMessageToBackend(userMessage);
                messageInput.value = "";
            }
        });

        messageInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") sendButton.click();
        });
    }

});

// -------------------------
// Index Page Handling - Character Cards
// -------------------------
document.addEventListener("DOMContentLoaded", () => {

    // Only run this on index.html
    const isIndex = window.location.pathname.includes("index.html") || window.location.pathname === "/";
    if (!isIndex) return;

    const buttons = document.querySelectorAll('.talk-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();

            const parentCard = event.target.closest('.character');
            const characterName = parentCard.getAttribute('data-name');

            startChat(characterName);
        });
    });
});
