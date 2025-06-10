const { Telegraf, Markup } = require('telegraf'); // Added Markup
const { BOT_TOKEN } = require('./config');
const { getOrCreateUser, getUser } = require('./db/database'); // getUser might be useful
const {
    startOnboarding, isUserOnboarding, handleOnboardingMessage,
    getCurrentOnboardingStep, handleLocation: handleOnboardingLocation
} = require('./features/onboarding');
const {
    startSettings, requestGenderUpdate, requestAgeUpdate, requestLocationUpdate, requestInterestUpdate,
    isUserUpdatingField, getUpdatingField, handleSettingsUpdate, cancelUpdate
} = require('./features/settings'); // Added settings imports

if (!BOT_TOKEN) {
  console.error('FATAL ERROR: BOT_TOKEN is not defined in config.js');
  process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

// Basic error handler
bot.catch((err, ctx) => {
  console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

bot.start(async (ctx) => {
    try {
        const user = await getOrCreateUser(ctx.from);
        if (user.is_banned) {
            // Handle banned user - TBD in later step
            return ctx.reply('Your account is currently suspended.');
        }
        if (!user.onboarding_complete) {
            await startOnboarding(ctx, user.user_id);
        } else {
            ctx.reply(`Welcome back, ${user.first_name}! Use /find to chat or /settings to update your info.`, /* Add main menu keyboard here later */ Markup.removeKeyboard());
        }
    } catch (error) {
        console.error('Error in start handler:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// General text message handler
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    // Ensure user exists (e.g., if they didn't /start but sent a message)
    const user = await getOrCreateUser(ctx.from);
    if (user.is_banned) return ctx.reply('Your account is currently suspended.');

    if (isUserOnboarding(userId)) {
        await handleOnboardingMessage(ctx);
    } else if (isUserUpdatingField(userId)) { // Added check for settings update
        await handleSettingsUpdate(ctx);
    } else {
        if (!user.onboarding_complete) {
            await startOnboarding(ctx, userId);
            return;
        }
        // Handle commands passed as text (if not caught by specific hears/command)
        if (ctx.message.text.startsWith('/')) {
            // Already handled by command handlers or falls through to unknown command
            // Let Telegraf's command processing take precedence for registered commands.
            // If it's not a registered command, it will be caught by the final 'else'
             ctx.reply("Unknown command. Available commands: /start, /settings. Others like /find, /end are coming soon.");
        } else if (['🚻 Update Gender', '🎂 Update Age', '📍 Update Location', '🔍 Update Interest', '⬅️ Back to Main'].includes(ctx.message.text)) {
            // This will be handled by the bot.hears if they are active.
            // If keyboard is not shown and user types this, it might be confusing.
            // Consider if specific handling is needed here or rely on .hears
            // For now, do nothing here, let .hears handle it or it falls to the final else.
        } else {
            // Placeholder for non-command, non-onboarding, non-settings text
            ctx.reply("You are not in a chat. Use /find to connect, or /settings to update your profile.");
        }
    }
});

// Modified Location message handler
bot.on('location', async (ctx) => {
    const userId = ctx.from.id;
    const user = await getOrCreateUser(ctx.from);
    if (user.is_banned) return ctx.reply('Your account is currently suspended.');

    if (isUserOnboarding(userId) && getCurrentOnboardingStep(userId) === 'location') {
        await handleOnboardingLocation(ctx, userId, ctx.message.location);
    } else if (isUserUpdatingField(userId) && getUpdatingField(userId) === 'location') { // Added
        await handleSettingsUpdate(ctx); // Will call handleLocationUpdate from settings.js
    } else {
        ctx.reply('I only need your location during onboarding or when you explicitly update it via Settings.');
    }
});

// Settings Command
bot.command('settings', async (ctx) => {
    const user = await getOrCreateUser(ctx.from); // Ensure user is known
    if (!user.onboarding_complete) {
        return ctx.reply("Please complete the onboarding process first. Use /start.");
    }
    if (isUserOnboarding(ctx.from.id)) { // If somehow stuck in onboarding
         return ctx.reply("Please complete the ongoing onboarding steps first.");
    }
    cancelUpdate(ctx.from.id); // Cancel any pending field update
    await startSettings(ctx);
});

// Settings Menu Button Handlers
bot.hears('🚻 Update Gender', async (ctx) => {
    if (await preUpdateCheck(ctx)) await requestGenderUpdate(ctx);
});
bot.hears('🎂 Update Age', async (ctx) => {
    if (await preUpdateCheck(ctx)) await requestAgeUpdate(ctx);
});
bot.hears('📍 Update Location', async (ctx) => {
    if (await preUpdateCheck(ctx)) await requestLocationUpdate(ctx);
});
bot.hears('🔍 Update Interest', async (ctx) => {
    if (await preUpdateCheck(ctx)) await requestInterestUpdate(ctx);
});
bot.hears('⬅️ Back to Main', async (ctx) => {
    cancelUpdate(ctx.from.id); // Clear any update state
    // Placeholder for main menu keyboard
    await ctx.reply('Returning to main menu...\nType /find to search for a chat, or /settings to view settings again.', Markup.removeKeyboard());
});

// Helper for settings button handlers
async function preUpdateCheck(ctx) {
    // User object from ctx.from might not have all DB fields. Get from DB.
    const userFromDb = await getUser(ctx.from.id);

    if (!userFromDb || !userFromDb.onboarding_complete) {
        await ctx.reply("Please complete the onboarding process first. Use /start.");
        return false;
    }
    if (isUserOnboarding(ctx.from.id)) {
         await ctx.reply("Please complete the ongoing onboarding steps first.");
         return false;
    }
    // Check if already in another chat or process if necessary in future
    return true;
}

// Launch the bot
bot.launch().then(() => {
  console.log('Bot started successfully!');
}).catch(err => {
  console.error('Failed to launch bot:', err);
  process.exit(1);
});

// ... rest of bot.js
