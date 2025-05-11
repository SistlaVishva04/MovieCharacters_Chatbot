// Function to Get the Selected Character from URL
function getSelectedCharacter() {
    const params = new URLSearchParams(window.location.search);
    return params.get("character"); // Get character name
}

// Function to Start Chat with Selected Character (from "Talk to Him" button click)
function startChat(character) {
    window.location.href = `chat.html?character=${character}`; // Navigate to chat page with character in the URL
}

// Function to Send Message to Backend
async function sendMessageToBackend(userMessage) {
    const character = getSelectedCharacter();
    if (!character) {
        console.error("Character not found!");
        addMessageToChat("Error: Character not found!", false);
        return;
    }

    try {
        console.log("📨 Sending request to backend...");

        const response = await fetch("http://127.0.0.1:5000/chat", {
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
            addMessageToChat(data.reply, false); // Show chatbot response
        } else {
            console.error("Error from server:", data.error || "Invalid response");
            addMessageToChat("Sorry, an error occurred.", false);
        }
    } catch (error) {
        console.error("Network error:", error);
        addMessageToChat("Connection issue. Try again later.", false);
    }
}

// Function to Add Messages to Chat UI
function addMessageToChat(text, isUser) {
    const chatContainer = document.getElementById("chat-container");
    if (!chatContainer) return;

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", isUser ? "user-message" : "bot-message");
    messageDiv.textContent = text;
    chatContainer.appendChild(messageDiv);

    // Scroll to the latest message
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Event Listener for Sending Messages
document.addEventListener("DOMContentLoaded", () => {
    const sendButton = document.getElementById("send-btn");
    const messageInput = document.getElementById("message-input");

    sendButton.addEventListener("click", () => {
        const userMessage = messageInput.value.trim();
        if (userMessage !== "") {
            addMessageToChat(userMessage, true); // Show user message
            sendMessageToBackend(userMessage); // Send to backend
            messageInput.value = ""; // Clear input field
        }
    });

    messageInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            sendButton.click(); // Simulate button click
        }
    });

    // Check for character in URL and start the chat automatically if character exists
    const character = getSelectedCharacter();
    if (character) {
        document.getElementById("chatHeader").innerText = `Chatting with ${character}`;
        // Automatically start the conversation if character is found
        addMessageToChat(`Hello ${character}, how can I help you today?`, false);
    }
});

// Character Grid Interaction - Start Conversation on "Talk to Him" Button Click
const characters = document.querySelectorAll('.character');
characters.forEach(character => {
    const button = character.querySelector('.overlay button');

    // Add event listener to the "Talk to Him" button
    button.addEventListener('click', function () {
        const characterName = character.getAttribute('data-name'); // Or use img alt/text

        // Start the chat by redirecting to chat page
        startChat(characterName);

        // Optionally hide overlay or provide feedback
        character.querySelector('.overlay').style.display = 'none';
    });
});
