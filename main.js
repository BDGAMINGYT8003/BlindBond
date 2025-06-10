// main.js
// Main entry point for the bot. Initializes modules, sets up Telegraf, and starts the bot.

const { Telegraf } = require('telegraf');

// Require services and managers (placeholders for now)
const UserDataService = require('./user_data_service');
const OnboardingManager = require('./onboarding_manager');
const ProfileManager = require('./profile_manager');
const MatchingService = require('./matching_service');
const ChatService = require('./chat_service');
const CommandHandler = require('./commands');
// const Keyboards = require('./keyboards');
// const Utils = require('./utils');
const ModerationService = require('./moderation_service'); // Required to ensure it's loaded if it had init logic

// TODO: Replace with actual token from environment variables or config from a dedicated config file
const BOT_TOKEN = process.env.BOT_TOKEN || '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo'; // Using the token from bot.js for now
const bot = new Telegraf(BOT_TOKEN);

// Initialize and load data - UserDataService handles its own loading upon require or explicitly if designed so.
// For this structure, we'll call it explicitly at the start of startApp.

// Initialize services and handlers (Conceptual - to be filled in later)
// CommandHandler.register(bot, /* pass necessary manager/service instances */);
// OnboardingManager.initialize(bot /*, UserDataService, Keyboards */);
// ProfileManager.initialize(bot /*, UserDataService, Keyboards */);
// ChatService.initialize(bot /*, UserDataService, Keyboards, Utils, ModerationService */);
// MatchingService.initialize(bot /*, UserDataService, ChatService */); // ChatService for sending match messages

// --- Placeholder for Handlers (to be moved to respective modules) ---
// Example: bot.on('text', async (ctx) => { /* ... */ });
// Example: bot.on('location', async (ctx) => { /* ... */ });
// Example: bot.action('some_action', async (ctx) => { /* ... */ });
console.log('Conceptual: Event handlers (text, location, actions) to be registered here or in modules.');


// Global Error Handling (adapted from old bot.js)
bot.catch((err, ctx) => {
  console.error(`Bot error for user ${ctx.from ? ctx.from.id : 'unknown'}:`, err);
  if (ctx && ctx.from && ctx.from.id) {
    UserDataService.ensureUserInitialized(ctx.from.id, ctx.from); // Ensure user data exists even on error path
  }
  if (ctx && ctx.reply) {
    ctx.reply("Sorry, something went wrong. Please try again later.").catch(e => console.error("Failed to send error reply:", e));
  }
});

// Graceful Shutdown (adapted from old bot.js)
const shutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  await UserDataService.saveData();
  console.log('User data saved via UserDataService.');
  bot.stop(signal);
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Bot Launching (adapted from old bot.js)
async function startApp() {
  try {
    UserDataService.loadData(); // Load user data at the very beginning

    // TODO: Initialize all services and register handlers
    // UserDataService is loaded above, its methods are directly available.
    OnboardingManager.initialize(bot); // Depends on UserDataService, Keyboards
    ProfileManager.initialize(bot);   // Depends on UserDataService, Keyboards

    // MatchingService and ChatService depend on each other for some calls.
    // Initialize them and then set cross-references if needed, or pass one to the other.
    // Current plan: MatchingService calls ChatService.createSessionAndNotify
    // ChatService calls MatchingService.tryMatchUsers and MatchingService.addUserToWaitingQueue
    MatchingService.initialize(bot, UserDataService, ChatService); // MatchingService needs ChatService to create sessions.
    ChatService.initialize(bot, UserDataService, MatchingService); // ChatService needs MatchingService to re-queue/trigger matching.

    // CommandHandler.register(bot, ...); // etc.

    // Temporary /start command handler
    bot.command('start', (ctx) => {
      OnboardingManager.startOnboardingOrWelcome(ctx);
    });

    // Temporary /update_profile command handler
    bot.command('update_profile', (ctx) => {
      ProfileManager.showUpdateOptions(ctx);
    });

    // Temporary /find command handler (to be moved to commands.js)
    bot.command('find', async (ctx) => {
      const userId = ctx.from.id;
      const userData = UserDataService.getUser(userId);

      if (!userData || userData.onboardingState !== 'completed') {
        return ctx.reply("Please complete your onboarding before finding a partner. Use /start if you haven't finished.");
      }
      if (userData.state === 'chatting') {
        return ctx.reply("You are already in a chat. Use /end to finish your current conversation first.");
      }
      if (userData.state === 'waiting') {
        return ctx.reply("You are already searching for a partner. Use /cancel_search to stop.");
      }

      await ctx.reply("🔍 Searching for a chat partner...\n\n⏳ Please wait while we connect you.", { reply_markup: { remove_keyboard: true } }); // Placeholder for searchingKeyboard
      await MatchingService.addUserToWaitingQueue(userId);
    });

    // Temporary /cancel_search command handler (to be moved to commands.js)
    bot.command('cancel_search', async (ctx) => {
        const userId = ctx.from.id;
        const userData = UserDataService.getUser(userId);
        if (userData && userData.state === 'waiting') {
            await MatchingService.removeUserFromWaitingQueue(userId);
            await ctx.reply("Search cancelled. You are no longer in the waiting queue.", { reply_markup: { remove_keyboard: true } });
        } else {
            await ctx.reply("You are not currently searching for a partner.", { reply_markup: { remove_keyboard: true } });
        }
    });


    console.log('Starting bot...');
    await bot.launch();
    console.log('✅ Bot started successfully!');
    console.log('Users can now use /start to begin chatting (if commands are registered).');
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  }
}

// Call startApp to run the bot
startApp();

// console.log('main.js setup complete. Call startApp() to launch the bot when ready.'); // Commenting this out as startApp will log.

module.exports = { bot, startApp }; // Export for potential testing or if other scripts need the bot instance
