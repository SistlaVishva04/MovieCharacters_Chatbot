import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Allows frontend to access the API

# Configure Gemini AI
API_KEY = "AIzaSyDHecFV5LkBhrIpFrimXqZFwkIzS4DM7Vg"
genai.configure(api_key=API_KEY)
model = genai.GenerativeModel("models/gemini-2.0-flash")

def chat_with_gemini(character_name, description, user_message):
    """Sends a prompt to Gemini AI and returns a response."""
    prompt = f"You are {character_name}. {description}. Respond in your unique style.\nUser: {user_message}"

    try:
        response = model.generate_content(prompt)

        # ✅ Debugging: Print API response format
        print("Raw API Response:", response)

        # ✅ Check if response is valid
        if hasattr(response, "text") and response.text:
            return response.text  # Correct extraction for Gemini 2.0

        return "I couldn't generate a response. Try again."

    except Exception as e:
        print("Error in chat_with_gemini:", str(e))  # Log error for debugging
        return "I'm having trouble responding. Try again."

@app.route("/chat", methods=["POST"])
def chat():
    """Handles chat messages from frontend."""
    try:
        data = request.json
        character = data.get("character", {})  
        character_name = character.get("name", "Unknown Character")
        description = character.get("description", "No description available.")
        user_message = data.get("message", "").strip()

        if not user_message:
            return jsonify({"error": "Empty message"}), 400

        bot_response = chat_with_gemini(character_name, description, user_message)
        return jsonify({"reply": bot_response})

    except Exception as e:
        print("Error processing request:", str(e))  # ✅ Print detailed error in the console
        return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    app.run(debug=True)
