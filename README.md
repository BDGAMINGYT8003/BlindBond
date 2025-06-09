# Anonymous Chat Bot for Telegram

This is a simple Telegram bot built with Node.js and Telegraf that anonymously connects two random users for one-on-one conversations.

## Features

*   **`/start`**: Displays a welcoming message and basic instructions on how to use the bot.
*   **`/new`**: Starts a search for a chat partner. If another user is also waiting, a session is established.
*   **`/end`**: Terminates the current chat session for both users.
*   **Anonymous Messaging**: Messages sent to the bot by one user in a session are forwarded to the other user.
*   **Share Username**: During an active chat, users are presented with an inline button ('✨ Offer to Share Username') to share their Telegram username with their chat partner. This involves a confirmation step. If confirmed, the user's clickable @username is sent to the partner.
*   **Conversation Summary**: At the end of each chat (whether ended by `/end` or due to an error like message delivery failure), both users receive a summary. This summary includes the chat duration and the total number of messages exchanged during the session.
*   **Command Blocking**: Messages starting with `/` are recognized as potential Telegram commands and are not forwarded to the chat partner. The sender is notified about this. This prevents accidental command invocation or confusion.
*   **Rate Limiting**: Prevents users from sending messages too quickly, helping to reduce spam.
*   **Message Length Cap**: Restricts the maximum length of messages.
*   **Basic Content Filtering**: Scans messages for a predefined list of prohibited keywords. If found, the message is blocked, and the sender is warned.
*   **Enhanced User Experience**: User-facing messages have been refined for clarity and consistently use Telegram's MarkdownV2 for better formatting and readability (e.g., bolding, italics, inline code for commands).

## Prerequisites

*   Node.js (v14 or later recommended)
*   npm (usually comes with Node.js)

## Setup and Running

1.  **Clone the repository (or download the files):**
    ```bash
    # If it were a git repo:
    # git clone <repository_url>
    # cd anonymous-chat-bot
    ```
    For now, just ensure you have the `bot.js` and `package.json` files in a directory.

2.  **Install dependencies:**
    Open your terminal in the project directory and run:
    ```bash
    npm install
    ```

3.  **Bot Token:**
    The Telegram Bot API token is currently hardcoded in `bot.js`.
    ```javascript
    const BOT_TOKEN = '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo'; // Directly in bot.js
    ```
    *Important Security Note:* In a production environment, never hardcode API tokens directly in the source code. Use environment variables (e.g., via a `.env` file and the `dotenv` package) or other secure configuration methods. For this specific project, hardcoding was requested.

4.  **Run the bot:**
    ```bash
    node bot.js
    ```

    You should see a log message indicating the bot has started:
    `Bot started successfully. Current sessions are ephemeral and will be lost on restart.`

## How it Works

*   Users send `/start` for a welcome message or `/new` to enter a waiting queue.
*   When two users are in the queue, they are paired, and a chat session begins. Session metadata like start time and message count is initialized.
*   Text messages sent to the bot (not starting with `/`) are forwarded to the paired user. The message count for the session is incremented.
*   Users can offer to share their username using an inline button.
*   The `/end` command terminates the session. A conversation summary is then displayed to both users.
*   User states (idle, waiting, chatting) and active sessions (linking user IDs and detailed metadata like start times, message counts, and usernames) are managed in memory. This means if the bot restarts, all active sessions and waiting users are lost.

## Safety Features

*   Users cannot start a new session if already in one or waiting.
*   Commands are generally rejected if used out of context (e.g., `/end` when not in a chat).
*   Messages starting with `/` are not forwarded during a chat.
*   Message rate limiting and length caps are in place to prevent spam.
*   A basic keyword filter checks messages for prohibited content. If found, the message is blocked, and the sender is warned.
*   The bot attempts to handle Telegram API errors gracefully (e.g., if a message can't be delivered to a partner, the session may be terminated, and a summary provided).
*   Communication is private between the two paired users during a session. Message contents are not stored long-term. User identifiers are used for session management but are not logged in a way that links them to message content beyond what's required for moderation of prohibited content or sharing usernames upon user consent.

## Future Enhancements (Not Implemented)

*   Persistent sessions across bot restarts (using a database or file storage).
*   More sophisticated content moderation and user reputation system (e.g., tracking warnings, temporary bans).
*   "Typing..." indicators.
*   Allowing users to report their chat partners for misconduct.
*   More granular user controls (e.g., blocking a partner after username share).
*   Localization/multi-language support.
