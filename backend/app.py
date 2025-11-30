import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv

# Load .env file
load_dotenv()

app = Flask(__name__)
CORS(app)
print("🔥 Running UPDATED app.py")
# print("🔥 Running app.py from:", os.path.abspath(__file__))

# Load API key
API_KEY = os.environ.get("GEMINI_API_KEY")

if not API_KEY:
    print("❌ ERROR: GEMINI_API_KEY is missing in environment variables!")
else:
    print("✅ GEMINI_API_KEY loaded successfully!")

genai.configure(api_key=API_KEY)

model = genai.GenerativeModel("gemini-2.0-flash")


# ------------------------
# Gemini Chat Function
# ------------------------
def chat_with_gemini(character_name, description, user_message):
    

    prompt = f"You are {character_name}. {description}. Stay in character ALWAYS.\nUser: {user_message}"

    try:
        

        response = model.generate_content(prompt)

        

        if getattr(response, "text", None):
            return response.text

        if response.candidates:
            parts = response.candidates[0].content.parts
            if parts and hasattr(parts[0], "text"):
                return parts[0].text

        return "I couldn't generate a response."

    except Exception as e:
        import traceback
        print("❌ Gemini ERROR:", str(e))
        traceback.print_exc()
        return "I'm having trouble responding. Try again."



# ------------------------
# POST /chat → Main endpoint
# ------------------------
@app.route("/chat", methods=["POST"])
def chat():
    

    try:

        data = request.json
        character = data.get("character", {})
        character_name = character.get("name", "Unknown Character")
        description = character.get("description", "")
        user_message = data.get("message", "").strip()

        if not user_message:
            return jsonify({"error": "Empty message"}), 400

        bot_reply = chat_with_gemini(character_name, description, user_message)
        return jsonify({"reply": bot_reply})

    except Exception as e:
        print("❌ Server Error:", str(e))
        return jsonify({"error": "Internal server error"}), 500


# ------------------------
# Home route
# ------------------------
@app.route("/")
def home():
    return "Server is live!", 200


# Run
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
