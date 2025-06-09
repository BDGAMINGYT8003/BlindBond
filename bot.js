
const { Telegraf, Markup } = require('telegraf');

// Bot token - replace with environment variable in production
const BOT_TOKEN = '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo';

// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// Data structures
const users = new Map(); // userId -> { state: 'idle'/'waiting'/'chatting', userObject: ctx.from }
const waitingQueue = []; // Array of user IDs waiting for partners
const sessions = new Map(); // userId -> partnerId
const sessionDetails = new Map(); // sessionId -> { startTime, messageCount, user1Id, user2Id }

// Rate limiting
const messageTimestamps = new Map(); // userId -> [timestamps]
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const MAX_MESSAGES_IN_WINDOW = 3;

// Content filtering
const MAX_MESSAGE_LENGTH = 500;
const prohibitedKeywords = ['spam', 'scam', 'fake'];

// Utility function to escape MarkdownV2 special characters
const escapeMarkdown = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
};

// Format duration helper
const formatDuration = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }
  
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes < 60) {
    if (seconds === 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
};

// Reply keyboards
const chatActiveKeyboard = Markup.keyboard([
  ['🔗 Share Username'],
  ['🔄 End & Find New', '❌ End Chat']
]).resize().oneTime();

const shareConfirmKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Yes', 'share_yes'),
    Markup.button.callback('❌ No', 'share_no')
  ]
]);

const removeKeyboard = Markup.removeKeyboard();

// Initialize user helper
const ensureUserInitialized = (ctx) => {
  if (!ctx.from) return null;
  
  const userId = ctx.from.id;
  if (!users.has(userId)) {
    users.set(userId, { state: 'idle', userObject: ctx.from });
    console.log(`User ${userId} (${ctx.from.username || 'no_username'}) initialized`);
  } else {
    // Update user object if changed
    const existingUser = users.get(userId);
    existingUser.userObject = ctx.from;
    users.set(userId, existingUser);
  }
  
  return users.get(userId);
};

// Send conversation summary
const sendConversationSummary = async (userId, partnerId, sessionId, reason = 'ended') => {
  if (!sessionDetails.has(sessionId)) return;
  
  const details = sessionDetails.get(sessionId);
  const duration = new Date() - details.startTime;
  const formattedDuration = formatDuration(duration);
  const messageCount = details.messageCount;
  
  let summaryMessage;
  if (reason === 'error') {
    summaryMessage = `🔚 *The conversation has ended due to a connection issue\\.*

⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}
💬 *Total messages exchanged:* ${messageCount}

Use /find to start a new conversation\\.`;
  } else {
    summaryMessage = `🔚 *The conversation has officially concluded\\.*

⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}
💬 *Total messages exchanged:* ${messageCount}

Thanks for using Anonymous Chat Bot\\! Use /find to start a new conversation\\.`;
  }
  
  // Send to both users
  try {
    await bot.telegram.sendMessage(userId, summaryMessage, { 
      parse_mode: 'MarkdownV2',
      reply_markup: removeKeyboard.reply_markup 
    });
  } catch (error) {
    console.error(`Failed to send summary to user ${userId}:`, error);
  }
  
  try {
    await bot.telegram.sendMessage(partnerId, summaryMessage, { 
      parse_mode: 'MarkdownV2',
      reply_markup: removeKeyboard.reply_markup 
    });
  } catch (error) {
    console.error(`Failed to send summary to partner ${partnerId}:`, error);
  }
  
  sessionDetails.delete(sessionId);
};

// Clean up session
const cleanupSession = async (userId, partnerId, sessionId, reason = 'ended') => {
  // Send summary first
  await sendConversationSummary(userId, partnerId, sessionId, reason);
  
  // Clean up session data
  sessions.delete(userId);
  sessions.delete(partnerId);
  
  // Update user states
  const user1Data = users.get(userId);
  const user2Data = users.get(partnerId);
  
  if (user1Data) {
    user1Data.state = 'idle';
    users.set(userId, user1Data);
  }
  
  if (user2Data) {
    user2Data.state = 'idle';
    users.set(partnerId, user2Data);
  }
};

// Find partner function (extracted for reuse)
const findPartner = async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  
  // Check if already in chat
  if (sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("❌ *You're already in a chat\\!* Use /end to finish your current conversation first\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // Check if already waiting
  if (waitingQueue.includes(userId)) {
    return ctx.replyWithMarkdownV2("⏳ *You're already searching for a partner\\.*\n\nPlease wait while we find someone for you\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // Send search message first
  await ctx.replyWithMarkdownV2("🔍 *Searching for a chat partner\\.\\.\\.*\n\n⏳ Please wait while we connect you\\.", { reply_markup: removeKeyboard.reply_markup });
  
  // Add to waiting queue
  userCtx.state = 'waiting';
  users.set(userId, userCtx);
  waitingQueue.push(userId);
  
  console.log(`User ${userId} entered waiting queue`);
  
  // Try to pair users
  if (waitingQueue.length >= 2) {
    const user1Id = waitingQueue.shift();
    const user2Id = waitingQueue.shift();
    
    const user1Data = users.get(user1Id);
    const user2Data = users.get(user2Id);
    
    if (!user1Data || !user2Data) {
      console.error('User data missing during pairing');
      return;
    }
    
    // Create session
    sessions.set(user1Id, user2Id);
    sessions.set(user2Id, user1Id);
    
    // Update states
    user1Data.state = 'chatting';
    user2Data.state = 'chatting';
    users.set(user1Id, user1Data);
    users.set(user2Id, user2Data);
    
    // Create session details
    const sessionId = [user1Id, user2Id].sort().join('-');
    sessionDetails.set(sessionId, {
      startTime: new Date(),
      messageCount: 0,
      user1Id,
      user2Id
    });
    
    console.log(`Session started: ${sessionId}`);
    
    // Small delay to ensure proper message ordering
    setTimeout(async () => {
      // Notify both users with reply keyboard
      const connectMessage = `🎉 *You're now connected with a stranger\\!*

💬 Start chatting by sending a message\\.
🔗 Use the button below to share your username if you want\\.`;
      
      try {
        await bot.telegram.sendMessage(user1Id, connectMessage, {
          parse_mode: 'MarkdownV2',
          reply_markup: chatActiveKeyboard.reply_markup
        });
        
        await bot.telegram.sendMessage(user2Id, connectMessage, {
          parse_mode: 'MarkdownV2',
          reply_markup: chatActiveKeyboard.reply_markup
        });
      } catch (error) {
        console.error('Failed to send connection messages:', error);
      }
    }, 500); // 500ms delay to ensure proper ordering
  }
};

// End chat function (extracted for reuse)
const endChat = async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("ℹ️ *You're not currently in a chat\\.*\n\nUse /find to start a new conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  const partnerId = sessions.get(userId);
  const sessionId = [userId, partnerId].sort().join('-');
  
  console.log(`Session ended by user ${userId}. Session: ${sessionId}`);
  
  await cleanupSession(userId, partnerId, sessionId, 'ended');
};

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error:`, err);
  ensureUserInitialized(ctx);
});

// Start command
bot.start((ctx) => {
  ensureUserInitialized(ctx);
  
  const welcomeMessage = `🤖 *Welcome to Anonymous Chat Bot\\!*

🔍 Use /find to find a random chat partner
🛑 Use /end to finish your current conversation
📝 Messages are forwarded anonymously between partners

*Stay respectful and enjoy chatting\\!*`;

  ctx.replyWithMarkdownV2(welcomeMessage, { reply_markup: removeKeyboard.reply_markup });
});

// Find chat command (renamed from /new)
bot.command('find', findPartner);

// End chat command
bot.command('end', endChat);

// Handle reply keyboard buttons
bot.hears('🔗 Share Username', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("❌ *You're not currently in a chat\\.*\n\nUse /find to start a conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  const username = userData.userObject?.username;
  const displayUsername = username ? `@${username}` : 'your username';
  
  const askMessage = `🤔 *Would you like to share your username?*

Your chat partner will be able to see your username ${escapeMarkdown(displayUsername)} and contact you directly on Telegram\\.`;
  
  await ctx.replyWithMarkdownV2(askMessage, { reply_markup: shareConfirmKeyboard.reply_markup });
});

bot.hears('🔄 End & Find New', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("ℹ️ *You're not currently in a chat\\.*\n\nUse /find to start a new conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // End current chat first
  await endChat(ctx);
  
  // Small delay to ensure cleanup is complete
  setTimeout(async () => {
    await findPartner(ctx);
  }, 1000);
});

bot.hears('❌ End Chat', endChat);

// Message forwarding
bot.on('text', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  const messageText = ctx.message.text;
  
  // Block commands from being forwarded
  if (messageText.startsWith('/')) {
    if (userData && userData.state === 'chatting') {
      return ctx.replyWithMarkdownV2("❌ *Commands cannot be sent to your chat partner\\.*\n\nIf you want to end the chat, use /end");
    }
    return; // Let Telegraf handle the command normally
  }
  
  // Block reply keyboard button text from being forwarded
  if (messageText === '🔗 Share Username' || messageText === '🔄 End & Find New' || messageText === '❌ End Chat') {
    return; // These are handled by the hears handlers above
  }
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    if (userData && userData.state === 'waiting') {
      return ctx.replyWithMarkdownV2("⏳ *Please wait while we find you a chat partner\\.*");
    }
    return ctx.replyWithMarkdownV2("ℹ️ *You're not in a chat\\.*\n\nUse /find to start a conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  const partnerId = sessions.get(userId);
  
  // Message length check
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return ctx.replyWithMarkdownV2(`❌ *Message too long\\!*\n\nPlease keep messages under ${MAX_MESSAGE_LENGTH} characters\\.`);
  }
  
  // Content filtering
  const lowerMessage = messageText.toLowerCase();
  for (const keyword of prohibitedKeywords) {
    if (lowerMessage.includes(keyword)) {
      console.warn(`Blocked message from ${userId} containing: ${keyword}`);
      return ctx.replyWithMarkdownV2("🚫 *Your message was blocked\\.*\n\nPlease keep conversations respectful\\.");
    }
  }
  
  // Rate limiting
  const now = Date.now();
  const userTimestamps = messageTimestamps.get(userId) || [];
  const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (recentTimestamps.length >= MAX_MESSAGES_IN_WINDOW) {
    return ctx.replyWithMarkdownV2("⚠️ *Slow down\\!*\n\nYou're sending messages too quickly\\.");
  }
  
  recentTimestamps.push(now);
  messageTimestamps.set(userId, recentTimestamps);
  
  // Forward message
  try {
    await bot.telegram.sendMessage(partnerId, messageText);
    
    // Increment message count
    const sessionId = [userId, partnerId].sort().join('-');
    const details = sessionDetails.get(sessionId);
    if (details) {
      details.messageCount++;
      sessionDetails.set(sessionId, details);
    }
    
  } catch (error) {
    console.error(`Message delivery failed from ${userId} to ${partnerId}:`, error);
    
    // End session due to delivery failure
    const sessionId = [userId, partnerId].sort().join('-');
    await cleanupSession(userId, partnerId, sessionId, 'error');
  }
});

// Inline keyboard handlers for username sharing confirmation
bot.action('share_yes', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx);
  
  const userData = users.get(userId);
  const partnerId = sessions.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !partnerId) {
    await ctx.answerCbQuery('This chat is no longer active.');
    return ctx.editMessageText('❌ This chat session is no longer active\\.', { parse_mode: 'MarkdownV2' })
      .catch(console.error);
  }
  
  const username = userData.userObject?.username;
  if (!username) {
    await ctx.answerCbQuery('No username found.');
    return ctx.editMessageText('❌ *You don\'t have a username set\\.*\n\nPlease set a username in your Telegram settings first\\.', { parse_mode: 'MarkdownV2' })
      .catch(console.error);
  }
  
  await ctx.answerCbQuery('Sharing username...');
  
  // Send username to partner (username in @mention is NOT escaped)
  const partnerMessage = `🔗 *Your chat partner shared their username:*\n\n@${username}\n\nTap to view their profile\\!`;
  
  await bot.telegram.sendMessage(partnerId, partnerMessage, { parse_mode: 'MarkdownV2' })
    .catch(console.error);
  
  // Confirm to sender (username in display text IS escaped)
  const confirmMessage = `✅ *Username shared successfully\\!*\n\nYour username @${escapeMarkdown(username)} has been sent to your chat partner\\.`;
  
  await ctx.editMessageText(confirmMessage, { parse_mode: 'MarkdownV2' })
    .catch(console.error);
});

bot.action('share_no', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx);
  
  const userData = users.get(userId);
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    await ctx.answerCbQuery('This chat is no longer active.');
    return ctx.deleteMessage().catch(console.error);
  }
  
  await ctx.answerCbQuery('Username not shared.');
  await ctx.editMessageText('👍 *Your username was not shared\\.*\n\nYou can continue chatting anonymously\\.', { parse_mode: 'MarkdownV2' })
    .catch(console.error);
});

// Start the bot
console.log('Starting Anonymous Chat Bot...');

bot.launch()
  .then(() => {
    console.log('✅ Bot started successfully!');
    console.log('Users can now use /start to begin chatting.');
  })
  .catch((err) => {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  });

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  bot.stop(signal);
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

console.log('Bot setup complete. Waiting for launch...');
