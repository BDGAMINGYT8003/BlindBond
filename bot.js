const { Telegraf, Markup } = require('telegraf');

// Hardcoded API key (replace with environment variable in production)
const BOT_TOKEN = '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo';

// Utility function to escape MarkdownV2 special characters
const escapeMarkdownV2 = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
};

// Inline Keyboards for Share Username feature
const offerShareUsernameKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('✨ Offer to Share Username', 'share_username_prompt')
]);
const confirmShareUsernameKeyboard = Markup.inlineKeyboard([
  Markup.button.callback('✅ Yes, share it', 'share_username_yes'),
  Markup.button.callback('🚫 No, keep private', 'share_username_no')
]);

console.log("Bot starting..."); // Log bot starting
// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// Data structures
const users = new Map(); // Stores user objects: userId -> { state: 'idle'/'waiting'/'chatting', userObject: ctx.from }
const waitingQueue = []; // Holds user IDs waiting for a chat partner
const sessions = new Map(); // Stores active chat sessions: userId -> partnerId (for quick lookup)
const sessionDetails = new Map(); // Stores session metadata: sessionId -> { startTime, messageCount, user1Id, user2Id, user1Username, user2Username }

// Basic error handling
bot.catch((err, ctx) => {
  console.error(`Telegraf error for ${ctx.updateType || 'unknown_type'} update ${ctx.update?.update_id || 'unknown_id'}`, err);
  // Ensure user object is stored on any interaction if not present
  if (ctx.from && !users.has(ctx.from.id)) {
    users.set(ctx.from.id, { state: 'idle', userObject: ctx.from });
    console.log(`User ${ctx.from.id} (${ctx.from.username || 'no_username'}) initialized on error.`);
  }
});

// Helper to ensure user exists and has userObject
function ensureUserInitialized(ctx) {
  if (ctx.from) {
    if (!users.has(ctx.from.id)) {
      users.set(ctx.from.id, { state: 'idle', userObject: ctx.from });
      console.log(`User ${ctx.from.id} (${ctx.from.username || 'no_username'}) initialized on first command/message.`);
    } else {
      // Update userObject if it was missing or changed (e.g. username update)
      const existingUser = users.get(ctx.from.id);
      if (!existingUser.userObject || existingUser.userObject.username !== ctx.from.username) {
        existingUser.userObject = ctx.from;
        users.set(ctx.from.id, existingUser);
      }
    }
    return users.get(ctx.from.id);
  }
  return null;
}

// Helper function to format duration
function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);

  if (totalSeconds < 1) {
    return '< 1 second';
  }
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }
  if (totalSeconds < 3600) { // Less than 1 hour
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (seconds === 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  // 1 hour or more
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} and ${minutes} minute${minutes === 1 ? '' : 's'}`;
}


// /new command handler
bot.command('new', (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return ctx.reply("Could not identify user."); // Should not happen with Telegraf

  const userId = userCtx.userObject.id;

  // Check user state
  if (sessions.has(userId)) { // sessions still stores partnerId directly
    // Enhanced message with MarkdownV2
    return ctx.replyWithMarkdownV2("❗️*You are already in a chat\\.* Use the \\`/end\\` command to finish your current chat before starting a new one\\.");
  }

  if (waitingQueue.includes(userId)) {
    // Enhanced message with MarkdownV2
    return ctx.replyWithMarkdownV2("⏳ _You are already searching for a partner\\. Please wait\\._");
  }

  // Add to waiting queue and attempt pairing
  userCtx.state = 'waiting'; // users map stores { state, userObject }
  users.set(userId, userCtx); // Re-set the updated user object
  if (!waitingQueue.includes(userId)) { // Ensure not added twice if logic error elsewhere
    waitingQueue.push(userId);
  }
  console.log(`User ${userId} (${userCtx.userObject.username || 'no_username'}) entered waiting queue.`);
  // Enhanced message with MarkdownV2
  ctx.replyWithMarkdownV2("⏳ _Searching for a partner\\.\\.\\. Please wait_");

  // Pairing logic
  if (waitingQueue.length >= 2) {
    const user1Id = waitingQueue.shift();
    const user2Id = waitingQueue.shift();

    const user1Data = users.get(user1Id);
    const user2Data = users.get(user2Id);

    if (!user1Data || !user2Data) {
      console.error("Critical: User data not found during pairing. Returning users to queue if possible.");
      if (user1Id && !user1Data) waitingQueue.unshift(user1Id); // try to put back if data missing
      if (user2Id && !user2Data) waitingQueue.unshift(user2Id);
      // Potentially notify users something went wrong if they were in queue
      if(user1Id) bot.telegram.sendMessage(user1Id, "Something went wrong while pairing. Please try /new again shortly.").catch(e => console.error("Failed to notify user1 about pairing error", e));
      if(user2Id) bot.telegram.sendMessage(user2Id, "Something went wrong while pairing. Please try /new again shortly.").catch(e => console.error("Failed to notify user2 about pairing error", e));
      return;
    }

    // Create a session
    sessions.set(user1Id, user2Id);
    sessions.set(user2Id, user1Id);

    // Update user states
    user1Data.state = 'chatting';
    user2Data.state = 'chatting';
    users.set(user1Id, user1Data);
    users.set(user2Id, user2Data);

    // Create session details
    const sessionId = [user1Id, user2Id].sort().join('-');
    const sessionStartTime = new Date();
    sessionDetails.set(sessionId, {
      startTime: sessionStartTime,
      messageCount: 0,
      user1Id: user1Id,
      user2Id: user2Id,
      user1Username: user1Data.userObject.username || null,
      user2Username: user2Data.userObject.username || null,
    });

    console.log(`Session started: User ${user1Id} and User ${user2Id}. Session ID: ${sessionId}`);
    // Notify both users with offer to share username
    const connectMessage = "You are now connected with a random stranger\\! Say hi\\. Type a message, or use the button below if you'd like to offer sharing your Telegram username\\.";

    bot.telegram.sendMessage(user1Id, connectMessage, {
      reply_markup: offerShareUsernameKeyboard.reply_markup,
      parse_mode: 'MarkdownV2'
    }).catch(e => console.error(`Error sending connect message to ${user1Id}: `, e));

    bot.telegram.sendMessage(user2Id, connectMessage, {
      reply_markup: offerShareUsernameKeyboard.reply_markup,
      parse_mode: 'MarkdownV2'
    }).catch(e => console.error(`Error sending connect message to ${user2Id}: `, e));
  }
});

// /end command handler
bot.command('end', (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return ctx.reply("Could not identify user.");
  const userId = userCtx.userObject.id;
  const userData = users.get(userId); // Get the full user object { state, userObject }

  if (userData && userData.state === 'chatting' && sessions.has(userId)) {
    const partnerId = sessions.get(userId); // partnerId is still directly in sessions

    // Log session metadata & send summary FIRST
    const sessionId = [userId, partnerId].sort().join('-');
    console.log(`Session ended by User ${userId} (partner was ${partnerId}). Session ID: ${sessionId}`);

    if (sessionDetails.has(sessionId)) {
      const details = sessionDetails.get(sessionId);
      const durationMs = new Date() - details.startTime;
      const formattedDuration = formatDuration(durationMs);
      const messagesExchanged = details.messageCount;
      const summaryMessage = `🔚 *The conversation has officially concluded\\.*\n\n⏳ Duration: \`${formattedDuration}\`\n💬 Total messages exchanged: \`${messagesExchanged}\``;

      console.log(`Session details for ${sessionId}: Started at ${details.startTime}, ${messagesExchanged} messages exchanged. Duration: ${formattedDuration}.`);

      // Notify both users with summary. No direct ctx.reply needed for the user initiating /end, summary is enough.
      bot.telegram.sendMessage(userId, summaryMessage, { parse_mode: 'MarkdownV2' })
        .catch(err => console.error(`Error sending summary to User ${userId}: `, err));
      bot.telegram.sendMessage(partnerId, summaryMessage, { parse_mode: 'MarkdownV2' })
        .catch(err => console.error(`Error sending summary to Partner ${partnerId}: `, err));

      sessionDetails.delete(sessionId); // Clean up session details
    } else {
      // Fallback if details somehow missing but session existed
      // Use replyWithMarkdownV2 and escape static text if needed (though escapeMarkdownV2 is safer for general text)
      ctx.replyWithMarkdownV2(escapeMarkdownV2("You have ended the chat."));
      bot.telegram.sendMessage(partnerId, escapeMarkdownV2("The other user has ended the chat."))
        .catch(err => console.error(`Error notifying partner ${partnerId} (User ${userId}'s partner) about chat end (no details):`, err));
    }

    // Clean up session and user states
    sessions.delete(userId);
    sessions.delete(partnerId);

    const user1Data = users.get(userId);
    if(user1Data) {
      user1Data.state = 'idle';
      users.set(userId, user1Data);
    }

    const user2Data = users.get(partnerId);
     if(user2Data) {
      user2Data.state = 'idle';
      users.set(partnerId, user2Data);
    }

  } else {
    // Enhanced message with MarkdownV2
    ctx.replyWithMarkdownV2("ℹ️ You are not currently in a chat\\. There is no session to end\\.");
  }
});

// Message forwarding
const MAX_MESSAGE_LENGTH = 500;
const prohibitedKeywords = ['badword1', 'badword2', 'spamlink.com']; // Basic keyword filter
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const MAX_MESSAGES_IN_WINDOW = 3;
const messageTimestamps = new Map(); // userId => [timestamp1, timestamp2, ...]

bot.on('text', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return; // Silently ignore if user cannot be identified

  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  const originalMessageText = ctx.message.text;

  if (userData && userData.state === 'chatting' && sessions.has(userId)) {
    const recipientId = sessions.get(userId); // partnerId is still directly in sessions
    const messageText = originalMessageText;

    // Check for commands
    if (messageText.startsWith('/')) {
      console.log(`Command-like message from user ${userId} blocked: ${messageText}`);
      // Enhanced message with MarkdownV2
      ctx.replyWithMarkdownV2("Messages starting with `/` are treated as commands and cannot be forwarded\\. If you meant to end the chat, please use the \\`/end\\` command\\.");
      return; // Stop processing this message
    }

    // Content Scanning (Basic Keyword Filter)
    const lowerCaseMessage = messageText.toLowerCase();
    for (const keyword of prohibitedKeywords) {
      if (lowerCaseMessage.includes(keyword)) {
        console.warn(`Prohibited content warning: User ${userId} message blocked. Content snippet: "${messageText.substring(0, 50)}..."`);
        // Enhanced message with MarkdownV2
        ctx.replyWithMarkdownV2("🚫 *Your message appears to violate our content policy and was not sent\\.* Please be respectful\\. Repeated violations may lead to temporary restrictions\\.");
        return; // Stop processing this message
      }
    }

    // Message Length Cap
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      console.log(`Message from user ${userId} exceeded length cap (${messageText.length}/${MAX_MESSAGE_LENGTH} chars).`);
      // Enhanced message with MarkdownV2
      return ctx.replyWithMarkdownV2(`⚠️ Your message is too long \\(\`${messageText.length}/${MAX_MESSAGE_LENGTH}\` characters\\)\\. Please keep it under \`${MAX_MESSAGE_LENGTH}\` characters\\. Shorten your message and try sending again\\.`);
    }

    // Rate Limiting
    const now = Date.now();
    const userTimestamps = messageTimestamps.get(userId) || [];
    const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);

    if (recentTimestamps.length >= MAX_MESSAGES_IN_WINDOW) {
      console.log(`Rate limit exceeded for user ${userId}.`);
      // Enhanced message with MarkdownV2
      return ctx.replyWithMarkdownV2("⏱️ _You are sending messages too quickly\\. Please wait a moment before sending more\\._");
    }

    recentTimestamps.push(now);
    messageTimestamps.set(userId, recentTimestamps);

    // Forward the message
    try {
      await bot.telegram.sendMessage(recipientId, messageText);
      // Increment message count
      const currentSessionId = [userId, recipientId].sort().join('-');
      const details = sessionDetails.get(currentSessionId);
      if (details) {
        details.messageCount++;
        sessionDetails.set(currentSessionId, details); // Update the map with new count
         // console.log(`Message count for session ${currentSessionId} is now ${details.messageCount}`); // Optional: for debugging
      }
      // console.log(`Message forwarded from ${userId} to ${recipientId}.`); // Optional: too verbose for now
    } catch (error) {
      console.error(`Message delivery to ${recipientId} (from ${userId}) failed. Ending session. Error: `, error);

      const partnerId = sessions.get(userId); // This is the recipientId
      const currentSessionId = [userId, recipientId].sort().join('-'); // userId is sender, recipientId is partner

      console.log(`Session automatically ended between ${userId} and ${recipientId} due to message delivery error. Session ID: ${currentSessionId}`);

      // Enhanced message with MarkdownV2 for the initial notification to the sender
      ctx.replyWithMarkdownV2("⚠️ _Could not deliver your message\\. The other user may have ended the chat or blocked the bot\\._")
        .catch(e => console.error("Error sending delivery failure notice to sender:", e));

      if (sessionDetails.has(currentSessionId)) {
          const details = sessionDetails.get(currentSessionId);
          const durationMs = new Date() - details.startTime;
          const formattedDuration = formatDuration(durationMs);
          const messagesExchanged = details.messageCount;
          const summaryMessageForSender = `🔚 *The conversation has concluded due to a message delivery issue to your partner\\.*\n\n⏳ Duration: \`${formattedDuration}\`\n💬 Total messages exchanged: \`${messagesExchanged}\``;
          const summaryMessageForRecipient = `🔚 *The conversation has concluded due to a message delivery issue\\.*\n\n⏳ Duration: \`${formattedDuration}\`\n💬 Total messages exchanged: \`${messagesExchanged}\``;

          console.log(`Session details for ${currentSessionId}: Started at ${details.startTime}, ${messagesExchanged} messages. Duration: ${formattedDuration}.`);

          bot.telegram.sendMessage(userId, summaryMessageForSender, { parse_mode: 'MarkdownV2' })
            .catch(err => console.error(`Error sending error summary to User ${userId}: `, err));

          bot.telegram.sendMessage(recipientId, summaryMessageForRecipient, { parse_mode: 'MarkdownV2' })
            .catch(err => console.error(`Error sending error summary to Partner ${recipientId}: `, err));

          sessionDetails.delete(currentSessionId);
      } else {
         // Fallback if details somehow missing. The ctx.replyWithMarkdownV2 above already notified the sender.
         console.warn(`Session details not found for ${currentSessionId} during error handling.`);
      }

      if (sessions.has(userId)) sessions.delete(userId);
      const senderUserData = users.get(userId);
      if (senderUserData) {
        senderUserData.state = 'idle';
        users.set(userId, senderUserData);
      }

      if (partnerId) {
        if (sessions.has(partnerId)) sessions.delete(partnerId);
        const partnerUserData = users.get(partnerId);
        if (partnerUserData) {
          partnerUserData.state = 'idle';
          users.set(partnerId, partnerUserData);
        }
        bot.telegram.sendMessage(partnerId, "Your chat partner has disconnected, or there was an issue delivering a message. The chat has ended. Use /new to find a new partner.")
          .catch(err => console.error(`Error notifying partner ${partnerId} (originally ${userId}'s partner) of automated disconnect:`, err));
      }
    }
  } else if (userData && userData.state === 'waiting') {
    // Enhanced message with MarkdownV2
    ctx.replyWithMarkdownV2("⏳ _You are currently waiting for a partner\\. Please be patient\\._");
  } else { // Includes idle state or if userData is somehow missing
    // Enhanced message with MarkdownV2
    ctx.replyWithMarkdownV2("ℹ️ You are not currently in a chat\\. Use the \\`/new\\` command to find a partner\\.");
  }
});

// /start command handler
bot.start((ctx) => {
  ensureUserInitialized(ctx); // Initialize user if not already done
  const welcomeMessage = `Welcome to the Anonymous Chat Bot\\! 👋

Send \`/new\` to connect with a random stranger\\.
Use \`/end\` to finish your chat at any time\\.

Enjoy your conversation\\! Remember to be respectful\\.`;
  // Send welcome message with MarkdownV2
  ctx.replyWithMarkdownV2(welcomeMessage);
});

// Start the bot
bot.launch()
  .then(() => {
    console.log('Bot started successfully. Current sessions are ephemeral and will be lost on restart.');
  })
  .catch((err) => {
    console.error('Critical Error starting bot:', err);
  });

// Graceful stop
process.once('SIGINT', () => {
  console.log('Bot is shutting down (SIGINT)...');
  bot.stop('SIGINT');
  process.exit(0); // Ensure process exits
});
process.once('SIGTERM', () => {
  console.log('Bot is shutting down (SIGTERM)...');
  bot.stop('SIGTERM');
  process.exit(0); // Ensure process exits
});

console.log('Bot script processing complete. Bot is attempting to launch...');

// --- Share Username Action Handlers ---

bot.action('share_username_prompt', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx); // Ensure user data is fresh, though ctx.from should be enough here
  const userData = users.get(userId);
  const partnerId = sessions.get(userId);

  if (!userData || userData.state !== 'chatting' || !partnerId) {
    await ctx.answerCbQuery("This chat is no longer active.");
  // Try to edit the original message which contained the button, if possible.
  // Manually escape .
    return ctx.editMessageText("This chat session is no longer active\\.", { parse_mode: 'MarkdownV2' })
      .catch(e => {
        console.error('Error editing original message for inactive share prompt:', e);
      // If editing fails (e.g. message too old or deleted), try replying. Manually escape .
        ctx.reply("This chat session is no longer active\\.", { parse_mode: 'MarkdownV2' }).catch(eReply => console.error('Error replying for inactive share prompt:', eReply));
      });
  }

  await ctx.answerCbQuery();
  // Remove the 'Offer to Share' button from the original connection message
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (e) {
    console.error('Error removing old keyboard for share_username_prompt (message might be too old or user deleted it):', e);
  }

  // Send a new message with Yes/No options
  await ctx.replyWithMarkdownV2("Would you like to share your Telegram username with the person you're chatting with\\?",
    { reply_markup: confirmShareUsernameKeyboard.reply_markup }
  ).catch(e => console.error('Error sending share_username_prompt confirmation message:', e));
});

bot.action('share_username_yes', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx);
  const userData = users.get(userId);
  const partnerId = sessions.get(userId);

  if (!userData || userData.state !== 'chatting' || !partnerId) {
    await ctx.answerCbQuery("This chat is no longer active.");
    return ctx.editMessageText(escapeMarkdownV2("Could not share username as this chat session is no longer active."), { parse_mode: 'MarkdownV2' })
      .catch(e => console.error('Error editing message for share_yes inactive:', e));
  }

  const username = userData.userObject?.username;
  if (!username) {
    await ctx.answerCbQuery("Username not found.");
    return ctx.editMessageText(escapeMarkdownV2("You don't seem to have a Telegram username set up in your profile, so it cannot be shared."), { parse_mode: 'MarkdownV2' })
      .catch(e => console.error('Error editing message for no username:', e));
  }

  await ctx.answerCbQuery("Sharing...");

  // Construct message for partner. Username itself is NOT escaped for @mention. Text around it IS.
  const messageToPartner = `Your chat partner @${username} would like to share their profile with you\\!`;
  await bot.telegram.sendMessage(partnerId, messageToPartner, { parse_mode: 'MarkdownV2' })
    .catch(err => console.error(`Error sending username to partner ${partnerId}: `, err));

  // Construct confirmation for sharer. Username IS escaped for display.
  const confirmationToSharer = `Your username (@${escapeMarkdownV2(username)}) has been shared with your partner\\. They can now tap it to view your profile\\.`;
  await ctx.editMessageText(confirmationToSharer, { parse_mode: 'MarkdownV2' })
    .catch(e => console.error('Error editing message for share_yes success:', e));
});

bot.action('share_username_no', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx); // Though not strictly needed if only editing based on ctx
  const userData = users.get(userId); // For state check
  const partnerId = sessions.get(userId); // For state check

  // Check if the session is still active when 'No' is pressed.
  // If not active, the Yes/No prompt might be orphaned. We can try to delete it.
  if (!userData || userData.state !== 'chatting' || !partnerId) {
    await ctx.answerCbQuery("This chat is no longer active.");
    // Try to delete the Yes/No prompt message
    return ctx.deleteMessage().catch(e => console.error('Error deleting (Yes/No prompt) message for share_no inactive:', e));
  }

  await ctx.answerCbQuery("Okay.");
  await ctx.editMessageText(escapeMarkdownV2("Okay, your username will not be shared at this time."), { parse_mode: 'MarkdownV2' })
    .catch(e => console.error('Error editing message for share_no:', e));
});
