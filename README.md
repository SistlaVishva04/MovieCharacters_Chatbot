# Movie Character Chatbot

A static HTML/CSS/JavaScript frontend and Flask backend that lets users chat with movie characters using Google Gemini.

## Local development

### Backend

Python 3.10 or newer is recommended. Put the Gemini key in the **project-root** `.env` file:

```text
GEMINI_API_KEY=your_gemini_api_key
```

The root `.env` is ignored by Git. Never put this key in the frontend or commit it.

In a PowerShell terminal:

```powershell
cd D:\MovieCharacterBot\backend
python -m pip install -r requirements.txt
python app.py
```

The API listens on `http://127.0.0.1:5000` (and the health endpoint is `http://127.0.0.1:5000/`). If `GEMINI_API_KEY` is missing, the backend prints a clear startup error; the health endpoint still works, while chat requests return HTTP 503.

### Frontend

In a second PowerShell terminal:

```powershell
cd D:\MovieCharacterBot\frontend
python -m http.server 5500 --bind 127.0.0.1
```

Open `http://127.0.0.1:5500`. The frontend selects the local API automatically on `localhost` and `127.0.0.1`.

### Frontend API configuration

`frontend/config.js` is the public runtime configuration for this vanilla static site. It uses `http://127.0.0.1:5000` on local hosts and `https://moviecharacters-bot-pnst.onrender.com` on other hosts. Change the corresponding `defaultApiBaseUrl` there to point to a different backend; `script.js` does not need to change.

For Netlify, deploy the `frontend` directory as the publish directory. Netlify environment variables are not available directly to browser JavaScript on a static site, so set the public backend URL in `frontend/config.js` (or have a build step generate that file from a public URL variable). Backend secrets such as `GEMINI_API_KEY` must remain in the backend environment only.

## Conversation history

Chat history is stored only in this browser's `localStorage`; it is not sent to the backend for persistence or synchronized between browsers/devices. Each saved conversation keeps its character details, title, timestamps, and ordered successful user/assistant messages. The first successful user message becomes its title, and the history sidebar can rename, reopen, or delete individual conversations.

Storage is bounded to 50 conversations, 80 messages per conversation, and about 1.5 MB of serialized data. The oldest conversations are removed first when a limit is reached; a conversation currently being used is retained. The API still receives at most the latest 16 messages as context. If browser storage is disabled, malformed, or full, chat can continue in the current tab and the sidebar reports that history may not persist.

## Tests

From the project root:

```powershell
python -m unittest discover -s backend -p "test_*.py" -v
```

The backend tests mock Gemini and do not consume API quota. To verify the real Gemini integration, start both servers with a valid backend `.env` and send a normal message from the local frontend.
