# Anonymous Chat Bot for Telegram (Refactored)

This Telegram bot, built with Node.js and Telegraf, anonymously connects two random users for one-on-one conversations. It features user onboarding, profile management, persistent sessions, content moderation, and a user reporting system.

## Core Features

*   **User Onboarding:** New users go through an onboarding process, providing gender, age, location (optional), and gender interest for matching.
*   **Persistent User Profiles:** User information (including onboarding state, profile details, chat state, reputation, warnings, and ban status) is stored in `data/users.json`.
*   **Profile Management:** Users can view their profile (`/myprofile`) and update their information (`/update` command with options for gender, age, location, interest).
*   **Intelligent Matching:**
    *   Users are added to a waiting queue via `/find`.
    *   Matching is based on mutual gender interest (e.g., User A interested in User B's gender, and User B interested in User A's gender).
    *   The waiting queue is restored from persistent user states on bot startup.
*   **Persistent Chat Sessions:** Active chat sessions are stored in `data/sessions.json`, allowing chats to potentially resume or be correctly handled even after bot restarts (though active connections are still subject to Telegram's behavior).
*   **Anonymous Messaging:** Messages, photos, videos, voice messages, stickers, documents, and animations are forwarded between connected users.
    *   **Chat Actions:** "Typing...", "uploading photo...", etc., indicators are sent to the recipient before the message arrives.
    *   Commands and keyboard button texts are not forwarded.
*   **Content Moderation:**
    *   **Keyword Filtering:** Text messages are scanned for a predefined list of prohibited keywords. Offending messages are blocked, the sender is warned, and the incident is logged.
*   **User Reporting System:**
    *   Users in an active chat can report their partner using the `/report` command.
    *   A confirmation step is involved.
    *   Reports lead to:
        *   Decrementing the reported user's reputation.
        *   Adding a warning to the reported user's profile.
        *   Incrementing `reportsMade` for the reporter and `reportsReceived` for the reported user.
        *   Ending the chat session.
        *   Logging the report in `data/moderation_log.json`.
    *   Users receive a formal warning message from the bot if their warning count reaches a certain threshold.
*   **Ban System:**
    *   Users can be manually banned by an admin setting `isBanned: true` and `banUntil: <timestamp>` in `users.json`.
    *   Banned users are prevented from using features like `/find` or `/update`.
    *   If a ban duration has expired, the user is automatically unbanned when they next attempt a restricted command.
*   **Graceful Startup & Shutdown:** The bot initializes necessary states (like the waiting queue) on startup and handles `SIGINT`/`SIGTERM` for graceful shutdown.
*   **Rate Limiting (Basic):** A simple mechanism (`messageTimestamps` map) exists to control message frequency, though not fully integrated into all message types yet.

## Project Structure

```
.
├── bot.js                  # Main entry point for the bot
├── package.json            # Project dependencies and scripts
├── data/                   # Directory for persistent data
│   ├── users.json          # Stores user profiles and states
│   ├── sessions.json       # Stores active chat session details
│   └── moderation_log.json # Logs keyword violations and user reports
└── src/                    # Source code directory
    ├── handlers/           # Modules for handling specific bot logic
    │   ├── actionHandler.js    # Handles callback queries from inline keyboards (e.g., report confirmation)
    │   ├── commandHandler.js   # Handles specific Telegram commands (e.g., /start, /myprofile, /update, /report)
    │   ├── matchingHandler.js  # Manages the user matching queue, session creation, and chat lifecycle commands (/find, /endchat, /cancelsearch)
    │   ├── onboardingHandler.js# Manages the new user onboarding flow
    │   └── updateHandler.js    # Manages the user profile update flow
    ├── models/             # Data models
    │   └── user.js           # User class representing user profiles and data logic
    └── utils/              # Utility modules
        ├── constants.js      # Defines application-wide constants (e.g., keyboards, keywords, thresholds)
        ├── helpers.js        # Helper functions (e.g., markdown escaping, duration formatting)
        └── storage.js        # Utility functions for reading from and writing to JSON data files
```

## Prerequisites

*   Node.js (v16 or later recommended)
*   npm (usually comes with Node.js)

## Setup and Running

1.  **Clone the repository (or download the files):**
    Ensure all files, especially `bot.js`, `package.json`, and the `src/` and `data/` directories, are in your project folder.

2.  **Install dependencies:**
    Open your terminal in the project directory and run:
    ```bash
    npm install
    ```
    This will install `telegraf` and `uuid` (used for session IDs).

3.  **Bot Token:**
    The Telegram Bot API token is sourced from an environment variable `BOT_TOKEN`. Create a `.env` file in the root of your project (and ensure it's in your `.gitignore` if using Git):
    ```
    BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE
    ```
    Replace `YOUR_TELEGRAM_BOT_TOKEN_HERE` with your actual bot token. If the environment variable is not found, the bot will fall back to a hardcoded token in `bot.js` (intended for development only).

4.  **Initialize Data Files:**
    Ensure the `data/` directory exists. Create empty JSON files if they are not present:
    *   `data/users.json`: `[]`
    *   `data/sessions.json`: `[]`
    *   `data/moderation_log.json`: `[]`

5.  **Run the bot:**
    ```bash
    node bot.js
    ```
    You should see log messages indicating the bot has started, including the restoration of any users to the waiting queue.

## How it Works (High-Level)

1.  **Initialization (`bot.js`):**
    *   The bot starts, connects to Telegram, and registers all command, action, and message handlers.
    *   `initializeMatchingState()` in `matchingHandler.js` is called to load users from `users.json` and repopulate the in-memory `waitingQueue` with users whose `chatState` was 'waiting'. It also performs some cleanup of inconsistent session data.
2.  **User Interaction:**
    *   **New User (`/start`):** `commandHandler.js` detects a new user. `User.create()` in `user.js` creates a profile (saved to `users.json`). `onboardingHandler.js` takes over to guide the user through gender, age, location, and interest questions. Each step updates the user's `onboardingState` and profile in `users.json`.
    *   **Existing User (`/start`):** If onboarded, they get a welcome message. If onboarding was incomplete, `onboardingHandler.js` resumes it.
    *   **Finding a Match (`/find`):** `matchingHandler.js` handles this. The user's `chatState` becomes 'waiting'. `tryMatchUsers()` attempts to pair them based on mutual gender interest with others in the `waitingQueue`.
    *   **Connection:** If a match is found, `connectUsers()` creates a session (saved to `sessions.json`), updates both users' `chatState` to 'chatting' and `currentSessionId`, and notifies them.
    *   **Chatting:** The main message handler in `bot.js` forwards messages between connected users, sending chat actions (typing, uploading) first. It also filters text messages for prohibited keywords.
    *   **Ending Chat (`/endchat` or buttons):** `matchingHandler.js` handles ending the chat, clearing session data, and resetting user states.
    *   **Updating Profile (`/update`, `/myprofile`):** `commandHandler.js` routes to `updateHandler.js`, which allows users to modify their profile details, saving changes to `users.json`.
    *   **Reporting (`/report`):** `commandHandler.js` initiates, and `actionHandler.js` processes the report, updating user stats, logging, and ending the chat.

## Safety & Moderation

*   **Anonymity:** Usernames are not automatically shared. (Future: A "Share Username" feature could be re-added with the new structure).
*   **Keyword Filtering:** Blocks messages with predefined prohibited words.
*   **User Reporting:** Allows users to report their chat partners, impacting reputation and issuing warnings.
*   **Ban System:** Admins can manually ban users. Banned users cannot use matching or update features. Automatic unbanning occurs if a ban duration expires.
*   **Rate Limiting:** A basic structure for rate limiting is present but needs full integration.
*   **Logging:** Moderation actions (keyword violations, reports) are logged in `data/moderation_log.json`.

## Future Enhancements (Ideas)

*   More sophisticated content moderation (e.g., AI for images/text, anti-spam).
*   Advanced reputation system with more granular levels and consequences.
*   Admin panel/commands for managing users, bans, and reviewing logs.
*   "Share Username" feature within the new session structure.
*   User blocking feature after a chat.
*   Localization/multi-language support.
*   More detailed conversation summaries.
*   Storing `waitingQueue` persistently (e.g., in Redis or a database) for extreme robustness, though current file-based user state handles the core need.
```
