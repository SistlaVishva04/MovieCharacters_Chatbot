(() => {
    const config = window.MOVIE_CHARACTER_CHAT_CONFIG || {};
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const defaultApiBaseUrl = isLocal
        ? "http://127.0.0.1:5000"
        : "https://moviecharacters-bot-pnst.onrender.com";
    const apiBaseUrl = typeof config.apiBaseUrl === "string" && config.apiBaseUrl.trim()
        ? config.apiBaseUrl.trim()
        : defaultApiBaseUrl;

    window.MOVIE_CHARACTER_CHAT_CONFIG = {
        ...config,
        apiBaseUrl: apiBaseUrl.replace(/\/+$/, "")
    };
})();
