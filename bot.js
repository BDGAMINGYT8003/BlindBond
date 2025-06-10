
const { Telegraf, Markup } = require('telegraf'); // Markup might be used by handlers
const {
  RATE_LIMIT_WINDOW,
  MAX_MESSAGES_IN_WINDOW,
  USERNAME_SHARE_COOLDOWN,
  MAX_USERNAME_SHARES,
  MAX_MESSAGE_LENGTH,
  prohibitedKeywords,
  chatActiveKeyboard,
  searchingKeyboard,
  shareConfirmKeyboard,
  removeKeyboard,
} = require('./src/utils/constants');
const { escapeMarkdown, formatDuration } = require('./src/utils/helpers'); // May not be needed directly in bot.js anymore
const { handleStartCommand } = require('./src/handlers/commandHandler');
const { routeOnboardingMessage } = require('./src/handlers/onboardingHandler');
const User = require('./src/models/user'); // Required for checking user state in generic message handlers

// Bot token - replace with environment variable in production
const BOT_TOKEN = process.env.BOT_TOKEN || '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo';

// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// Data structures (Old - to be removed)
// const users = new Map(); // userId -> { state: 'idle'/'waiting'/'chatting', userObject: ctx.from }
// const waitingQueue = []; // Array of user IDs waiting for partners (global one)
// const sessions = new Map(); // userId -> partnerId
// const sessionDetails = new Map(); // sessionId -> { startTime, messageCount, user1Id, user2Id }
// const usernameShareData = new Map(); // sessionId -> { user1Shares: 0, user2Shares: 0 }

// Rate limiting (Still potentially useful, but not directly tied to old session logic)
const messageTimestamps = new Map(); // userId -> [timestamps]

// Helper function to check if username sharing is allowed (Old - to be removed or refactored for new system)
// const canShareUsername = (userId) => { ... }

// Helper function to increment username share count (Old - to be removed or refactored)
// const incrementShareCount = (userId) => { ... }

// Initialize user helper (Old - to be removed)
// const ensureUserInitialized = (ctx) => { ... }

// Send conversation summary (Old - to be removed)
// const sendConversationSummary = async (userId, partnerId, sessionId, reason = 'ended') => { ... }

// Clean up session (Old - to be removed)
// const cleanupSession = async (userId, partnerId, sessionId, reason = 'ended') => { ... }

// Cancel search function (Old - to be removed)
// const cancelSearch = async (ctx) => { ... }

// Find partner function (Old - to be removed)
// const findPartner = async (ctx) => { ... }

// End chat function (Old - to be removed)
// const endChat = async (ctx) => { ... }

// Helper function to forward media content (Old - logic moved into main handler)
// const forwardMedia = async (ctx, partnerId) => { ... }

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error:`, err);
// ensureUserInitialized(ctx); // This logic is now part of User model and command/message handlers
});

const { handleUpdateCommand, handleMyProfileCommand } = require('./src/handlers/commandHandler');
const {
  startGenderUpdate,
  startAgeUpdate,
  startLocationUpdate,
  startInterestUpdate,
  cancelUpdateProcess,
  routeUpdateMessage
} = require('./src/handlers/updateHandler');
const {
  handleFindCommand: match_handleFindCommand, // Renamed to avoid conflict
  handleCancelSearchCommand,
  handleEndChatCommand,
  getSessionById: match_getSessionById,
} = require('./src/handlers/matchingHandler');
const { handleReportCommand } = require('./src/handlers/commandHandler');
const { handleReportYes, handleReportNo } = require('./src/handlers/actionHandler');


// Command handlers
bot.start(handleStartCommand);
bot.command('find', async (ctx) => {
  const user = User.findById(ctx.from.id);
  if (user && user.isBanned && user.banUntil && new Date(user.banUntil) > new Date()) {
    return ctx.reply(`You are temporarily banned until ${new Date(user.banUntil).toLocaleString()}.`);
  } else if (user && user.isBanned && (!user.banUntil || new Date(user.banUntil) <= new Date())) {
    user.update({ isBanned: false, banUntil: null }); // Unban if time is up
  }
  await match_handleFindCommand(ctx);
});
bot.command('update', async (ctx) => {
  const user = User.findById(ctx.from.id);
   if (user && user.isBanned && user.banUntil && new Date(user.banUntil) > new Date()) {
    return ctx.reply(`You are temporarily banned until ${new Date(user.banUntil).toLocaleString()}. Feature disabled.`);
  } else if (user && user.isBanned && (!user.banUntil || new Date(user.banUntil) <= new Date())) {
    user.update({ isBanned: false, banUntil: null });
  }
  await handleUpdateCommand(ctx);
});
bot.command('myprofile', handleMyProfileCommand); // Ban check could be added here too if desired
bot.command('cancelupdate', cancelUpdateProcess);
bot.command('cancelsearch', handleCancelSearchCommand);
bot.command('endchat', handleEndChatCommand);
bot.command('report', handleReportCommand);

// Action handlers for inline keyboards
bot.action('report_yes', handleReportYes);
bot.action('report_no', handleReportNo);


// Text-based triggers from keyboards
// Update options
bot.hears('Update Gender', async (ctx) => {
    const user = User.findById(ctx.from.id);
    if (user && user.isOnboarded() && !user.chatState) await startGenderUpdate(ctx); // Ensure not in chat/waiting
    else if (user && !user.isOnboarded()) await routeOnboardingMessage(ctx);
    else if (!user) await handleStartCommand(ctx);
    // If in chat/waiting, could ignore or send specific message. For now, prioritize chat/wait state.
});
bot.hears('Update Age', async (ctx) => {
    const user = User.findById(ctx.from.id);
    if (user && user.isOnboarded() && !user.chatState) await startAgeUpdate(ctx);
    else if (user && !user.isOnboarded()) await routeOnboardingMessage(ctx);
    else if (!user) await handleStartCommand(ctx);
});
bot.hears('Update Location', async (ctx) => {
    const user = User.findById(ctx.from.id);
    if (user && user.isOnboarded() && !user.chatState) await startLocationUpdate(ctx);
    else if (user && !user.isOnboarded()) await routeOnboardingMessage(ctx);
    else if (!user) await handleStartCommand(ctx);
});
bot.hears('Update Interest', async (ctx) => {
    const user = User.findById(ctx.from.id);
    if (user && user.isOnboarded() && !user.chatState) await startInterestUpdate(ctx);
    else if (user && !user.isOnboarded()) await routeOnboardingMessage(ctx);
    else if (!user) await handleStartCommand(ctx);
});
bot.hears('Cancel Update', async (ctx) => {
    const user = User.findById(ctx.from.id);
    // Only cancel if user exists and is onboarded (implies they could have started an update)
    if (user && user.isOnboarded()) await cancelUpdateProcess(ctx);
    else if (user && !user.isOnboarded()) await routeOnboardingMessage(ctx);
    else if (!user) await handleStartCommand(ctx);
});

// Matching options
bot.hears('❌ Cancel Search', handleCancelSearchCommand);
bot.hears('❌ End Chat', handleEndChatCommand);
bot.hears('🔄 End & Find New', async (ctx) => {
  await handleEndChatCommand(ctx); // End current chat
  await match_handleFindCommand(ctx); // Start finding new one
});
// Share Username is more complex, will handle with active chat logic.

// General message handler for text, location, and other applicable types
bot.on(['text', 'location', 'photo', 'video', 'voice', 'sticker', 'document', 'animation'], async (ctx) => {
  const userId = ctx.from.id;
  let user = User.findById(userId);

  // If user doesn't exist and isn't starting with /start or a command Hears above, prompt to /start
  const messageText = ctx.message && (ctx.message.text || ''); // Handle cases where text might be undefined (e.g. media)
  const knownHears = ['Update Gender', 'Update Age', 'Update Location', 'Update Interest', 'Cancel Update', '❌ Cancel Search', '❌ End Chat', '🔄 End & Find New', '🔗 Share Username'];

  if (!user && !messageText.startsWith('/') && !knownHears.includes(messageText) ) {
    return ctx.reply("Welcome! Please use /start to begin.");
  }
  
  // If user exists, proceed with stateful message routing
  if (user) {
    // Priority 1: Onboarding
    if (!user.isOnboarded()) {
      const messageHandledByOnboarding = await routeOnboardingMessage(ctx);
      if (messageHandledByOnboarding) return;
      const { handleOnboarding } = require('./src/handlers/onboardingHandler');
      await handleOnboarding(ctx, user);
      return;
    }

    // Priority 2: Profile Update
    if (user.updateState) {
      const messageHandledByUpdate = await routeUpdateMessage(ctx);
      if (messageHandledByUpdate) return;
      const { startGenderUpdate: reStartGender, startAgeUpdate: reStartAge, startLocationUpdate: reStartLoc, startInterestUpdate: reStartInt } = require('./src/handlers/updateHandler');
      console.log(`Message not handled by update router for state: ${user.updateState}. Re-prompting.`);
      switch (user.updateState) {
         case 'pending_gender_update': await reStartGender(ctx); break;
         case 'pending_age_update': await reStartAge(ctx); break;
         case 'pending_location_update': await reStartLoc(ctx); break;
         case 'pending_interest_update': await reStartInt(ctx); break;
      }
      return;
    }

    // Priority 3: Active Chat
    if (user.chatState === 'chatting' && user.currentSessionId) {
      const session = match_getSessionById(user.currentSessionId);
      if (session) {
        const partnerId = (session.user1Id === userId) ? session.user2Id : session.user1Id;
        if (partnerId) {
          try {
            let chatAction = 'typing'; // Default action

            if (ctx.message.photo) chatAction = 'upload_photo';
            else if (ctx.message.video) chatAction = 'upload_video';
            else if (ctx.message.voice) chatAction = 'record_voice';
            else if (ctx.message.document) chatAction = 'upload_document';
            else if (ctx.message.location) chatAction = 'find_location'; // Or 'typing' if preferred
            else if (ctx.message.video_note) chatAction = 'record_video_note';
            // Add more specific actions if desired e.g. record_audio, upload_audio for voice/audio files

            await ctx.telegram.sendChatAction(partnerId, chatAction);

            if (ctx.message.text) {
              // Content Filtering for text messages
              const lowerMessage = ctx.message.text.toLowerCase();
              let isProhibited = false;
              for (const keyword of prohibitedKeywords) {
                if (lowerMessage.includes(keyword)) {
                  isProhibited = true;
                  // Log the incident
                  const { appendLog } = require('./src/utils/storage');
                  appendLog('moderation_log.json', {
                    type: 'keyword_violation',
                    timestamp: new Date().toISOString(),
                    userId: userId,
                    message: ctx.message.text,
                    keyword: keyword,
                    sessionId: user.currentSessionId,
                  });
                  // Warn the sender
                  ctx.reply("Your message was not sent as it may violate our content guidelines. Please be respectful. Repeated violations may lead to penalties.");
                  // (Optional: Increment a user-specific counter for keyword violations, which could contribute to reputation)
                  // user.update({ keywordViolations: (user.keywordViolations || 0) + 1 });
                  break;
                }
              }

              if (isProhibited) {
                return; // Stop processing/forwarding this message
              }
              // End of Content Filtering

              if (ctx.message.text.startsWith('/') || knownHears.includes(ctx.message.text)) {
                ctx.reply("Commands and menu buttons are not sent to your partner. Use /endchat to end the conversation.");
                return;
              }
              await ctx.telegram.sendMessage(partnerId, ctx.message.text);
            } else if (ctx.message.photo) {
              // Note: Image moderation would require a more complex setup (e.g., AI service)
              await ctx.telegram.sendPhoto(partnerId, ctx.message.photo[ctx.message.photo.length - 1].file_id, { caption: ctx.message.caption });
            } else if (ctx.message.video) {
              await ctx.telegram.sendVideo(partnerId, ctx.message.video.file_id, { caption: ctx.message.caption });
            } else if (ctx.message.voice) {
              await ctx.telegram.sendVoice(partnerId, ctx.message.voice.file_id);
            } else if (ctx.message.sticker) {
              await ctx.telegram.sendSticker(partnerId, ctx.message.sticker.file_id);
            } else if (ctx.message.document) {
              await ctx.telegram.sendDocument(partnerId, ctx.message.document.file_id, { caption: ctx.message.caption });
            } else if (ctx.message.animation) {
              await ctx.telegram.sendAnimation(partnerId, ctx.message.animation.file_id, { caption: ctx.message.caption });
            } else if (ctx.message.location) {
               await ctx.telegram.sendLocation(partnerId, ctx.message.location.latitude, ctx.message.location.longitude);
            } else if (ctx.message.video_note) {
               await ctx.telegram.sendVideoNote(partnerId, ctx.message.video_note.file_id);
            }
            else {
              console.log("Attempted to forward unhandled message type:", ctx.message);
              ctx.reply("This message type cannot be forwarded.");
            }
          } catch (error) {
            console.error(`Failed to forward message from ${userId} to ${partnerId}:`, error);
            // Check if partner blocked the bot or other issues
            if (error.code === 403) { // Forbidden: bot was blocked by the user
                ctx.reply("Your partner may have disconnected or blocked the bot. Ending chat.");
                await handleEndChatCommand(ctx, 'partner_disconnected_or_blocked');
            } else {
                ctx.reply("Could not send your message. Please try again.");
            }
          }
          return; // Message handled by forwarding
        }
      } else {
        // Session ID exists on user but not in sessions.json (data inconsistency)
        console.error(`User ${userId} in chatting state but session ${user.currentSessionId} not found.`);
        user.update({ chatState: 'idle', currentSessionId: null });
        ctx.reply("There was an issue with your chat session. It has been ended. Please use /find to start a new one.", Markup.removeKeyboard());
        return;
      }
    }

    // Priority 4: User is idle, not a command, not an onboarding/update message
    if (user.chatState === 'idle' && messageText && !messageText.startsWith('/') && !knownHears.includes(messageText)) {
      // console.log(`Message from idle user ${userId}: ${messageText}`);
      // ctx.reply("Not sure what to do with that. Use /find to find a partner, or /update to change your profile.");
    }
  }
  // If !user and it's /start, it's handled by bot.start (defined by Telegraf).
  // If !user and a Hears that calls handleStartCommand, it's handled.
});

// TODO: Load other handlers (e.g., for inline queries)
const { initializeMatchingState, tryMatchUsers: startupTryMatch } = require('./src/handlers/matchingHandler');

// Start the bot
console.log('Starting Anonymous Chat Bot...');

bot.launch().then(async () => {
  console.log('✅ Bot started successfully!');
  // Pass bot.telegram directly for tryMatchUsers if needed by initializeMatchingState
  await initializeMatchingState(bot.telegram);
  // Optionally, call tryMatchUsers directly again if initializeMatchingState doesn't or if you want a separate call
  // await startupTryMatch(bot.telegram); // This would attempt matching immediately after init
  console.log('Users can now use /start to begin chatting.');
}).catch(err => {
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

// Ensure this is the last log before launch (or remove if bot runs continuously)
// console.log('Bot setup complete. Waiting for launch...');
