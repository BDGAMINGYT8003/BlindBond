const { Telegraf } = require('telegraf');

// Hardcoded API key (replace with environment variable in production)
const BOT_TOKEN = '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo';

console.log("Bot starting..."); // Log bot starting
// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// Data structures
const users = new Map(); // Stores user states: 'idle', 'waiting', 'chatting'
const waitingQueue = []; // Holds user IDs waiting for a chat partner
const sessions = new Map(); // Stores active chat sessions: user1Id => user2Id

// Basic error handling
bot.catch((err, ctx) => {
  console.error(`Telegraf error for ${ctx.updateType || 'unknown_type'} update ${ctx.update?.update_id || 'unknown_id'}`, err);
});

// /new command handler
bot.command('new', (ctx) => {
  const userId = ctx.from.id;

  // Check user state
  if (sessions.has(userId)) {
    return ctx.reply("You are already in a chat. Use /end to finish your current chat before starting a new one.");
  }

  if (waitingQueue.includes(userId)) {
    return ctx.reply("You are already searching for a partner. Please wait.");
  }

  // Add to waiting queue and attempt pairing
  users.set(userId, 'waiting');
  waitingQueue.push(userId);
  console.log(`User ${userId} entered waiting queue.`);
  ctx.reply("Searching for a partner... Please wait.");

  // Pairing logic
  if (waitingQueue.length >= 2) {
    const user1 = waitingQueue.shift();
    const user2 = waitingQueue.shift();

    // Create a session
    sessions.set(user1, user2);
    sessions.set(user2, user1);

    // Update user states
    users.set(user1, 'chatting');
    users.set(user2, 'chatting');

    console.log(`Session started: User ${user1} and User ${user2}.`);
    // Notify both users
    bot.telegram.sendMessage(user1, "You are now connected with a random stranger! Say hi.");
    bot.telegram.sendMessage(user2, "You are now connected with a random stranger! Say hi.");
  }
});

// /end command handler
bot.command('end', (ctx) => {
  const userId = ctx.from.id;

  if (users.get(userId) === 'chatting' && sessions.has(userId)) {
    const partnerId = sessions.get(userId);

    // Notify both users
    ctx.reply("You have ended the chat.");
    bot.telegram.sendMessage(partnerId, "The other user has ended the chat.")
      .catch(err => console.error(`Error notifying partner ${partnerId} (originally User ${userId}'s partner) about chat end:`, err));

    // Log session metadata
    console.log(`Session ended by User ${userId} (partner was ${partnerId}).`);

    // Clean up session and user states
    sessions.delete(userId);
    sessions.delete(partnerId);
    users.set(userId, 'idle');
    users.set(partnerId, 'idle');

  } else {
    ctx.reply("You are not currently in a chat.");
  }
});

// Message forwarding
const MAX_MESSAGE_LENGTH = 500;
const prohibitedKeywords = ['badword1', 'badword2', 'spamlink.com']; // Basic keyword filter
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const MAX_MESSAGES_IN_WINDOW = 3;
const messageTimestamps = new Map(); // userId => [timestamp1, timestamp2, ...]

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const originalMessageText = ctx.message.text; // Keep original for logging if needed

  if (users.get(userId) === 'chatting' && sessions.has(userId)) {
    const recipientId = sessions.get(userId);
    const messageText = originalMessageText; // Use this for processing

    // Content Scanning (Basic Keyword Filter)
    const lowerCaseMessage = messageText.toLowerCase();
    for (const keyword of prohibitedKeywords) {
      if (lowerCaseMessage.includes(keyword)) {
        console.warn(`Prohibited content warning: User ${userId} message blocked. Content snippet: "${messageText.substring(0, 50)}..."`);
        ctx.reply("Your message appears to violate our content policy and was not sent. Please be respectful.");
        return; // Stop processing this message
      }
    }

    // Message Length Cap
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      console.log(`Message from user ${userId} exceeded length cap (${messageText.length}/${MAX_MESSAGE_LENGTH} chars).`);
      return ctx.reply(`Your message is too long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`);
    }

    // Rate Limiting
    const now = Date.now();
    const userTimestamps = messageTimestamps.get(userId) || [];
    const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);

    if (recentTimestamps.length >= MAX_MESSAGES_IN_WINDOW) {
      console.log(`Rate limit exceeded for user ${userId}.`);
      return ctx.reply("You are sending messages too quickly. Please wait a moment.");
    }

    recentTimestamps.push(now);
    messageTimestamps.set(userId, recentTimestamps);

    // Forward the message
    try {
      await bot.telegram.sendMessage(recipientId, messageText);
      // console.log(`Message forwarded from ${userId} to ${recipientId}.`); // Optional: too verbose for now
    } catch (error) {
      console.error(`Message delivery to ${recipientId} (from ${userId}) failed. Ending session. Error: `, error);
      // Notify sender and end session
      ctx.reply("Could not deliver your message. The other user might have ended the chat or blocked the bot. The chat has been ended.");

      // End session for both users more robustly
      const partnerId = sessions.get(userId);
      console.log(`Session automatically ended between ${userId} and ${partnerId || 'unknown partner'} due to message delivery error.`);

      if (sessions.has(userId)) sessions.delete(userId);
      if (users.has(userId)) users.set(userId, 'idle');

      if (partnerId) {
        if (sessions.has(partnerId)) sessions.delete(partnerId);
        if (users.has(partnerId)) users.set(partnerId, 'idle');
        // Notify the other user
        bot.telegram.sendMessage(partnerId, "Your chat partner has disconnected, or there was an issue delivering a message. The chat has ended. Use /new to find a new partner.")
          .catch(err => console.error(`Error notifying partner ${partnerId} (originally ${userId}'s partner) of automated disconnect:`, err));
      }
    }
  } else if (users.get(userId) === 'waiting') {
    ctx.reply("You are currently waiting for a partner. Please be patient.");
  } else {
    ctx.reply("You are not currently in a chat. Use /new to find a partner.");
  }
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
