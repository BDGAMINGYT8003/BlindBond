// commands.js
// Handles registration and logic for bot commands like /start, /find, /end, /update_profile.

const UserDataService = require('./user_data_service');
const OnboardingManager = require('./onboarding_manager');
const ProfileManager = require('./profile_manager');
const MatchingService = require('./matching_service');
// ChatService is not directly called by commands here, /end is handled in ChatService itself.
const { removeKeyboard, searchingKeyboard } = require('./keyboards');
const { escapeMarkdown } = require('./utils'); // For Markdown in messages

function initialize(bot) {
  bot.command('start', (ctx) => {
    // ensureUserInitialized is called within startOnboardingOrWelcome
    OnboardingManager.startOnboardingOrWelcome(ctx);
  });

  bot.command('find', async (ctx) => {
    const userId = ctx.from.id;
    // Ensure user is initialized before checking their state
    const userData = UserDataService.ensureUserInitialized(userId, ctx.from);

    if (userData.onboardingState !== 'completed') {
      await ctx.replyWithMarkdownV2("ℹ️ *Please complete the onboarding process first\\!* Use /start to begin or continue\\.", removeKeyboard);
      return;
    }
    if (userData.state === 'chatting') {
      await ctx.replyWithMarkdownV2("❌ *You're already in a chat\\!* Use /end or the buttons to finish your current conversation first\\.", removeKeyboard);
      return;
    }
    if (userData.state === 'waiting') {
      await ctx.replyWithMarkdownV2("⏳ *You're already searching for a partner\\.*", searchingKeyboard);
      return;
    }

    // If user is idle and onboarding is complete, try to add to queue.
    // Confirmation message ("Searching...") should be sent before adding to queue,
    // as addUserToWaitingQueue might immediately find a match and send other messages.
    await ctx.replyWithMarkdownV2("🔍 *Searching for a chat partner\\.\\.\\.*\n\n⏳ Please wait while we connect you\\.", searchingKeyboard);
    await MatchingService.addUserToWaitingQueue(userId);
  });

  bot.command('update_profile', (ctx) => {
    // ensureUserInitialized is called within showUpdateOptions
    ProfileManager.showUpdateOptions(ctx);
  });

  bot.command('cancel_search', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId); // User should exist if they were searching

    if (userData && userData.state === 'waiting') {
      await MatchingService.removeUserFromWaitingQueue(userId); // This updates state and saves
      await ctx.replyWithMarkdownV2("✅ *Search cancelled\\.*\n\nYou can use /find to search again\\.", removeKeyboard);
    } else {
      await ctx.replyWithMarkdownV2("ℹ️ *You're not currently searching for a partner\\.*", removeKeyboard);
    }
  });

  // Note: /end command is now handled within ChatService.initialize()

  // Example for a /my_profile command (not part of original scope but good for completeness)
  bot.command('my_profile', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.ensureUserInitialized(userId, ctx.from);

    if (userData.onboardingState !== 'completed') {
        await ctx.replyWithMarkdownV2("ℹ️ *Please complete the onboarding process first to view your profile\.* Use /start to begin or continue\.", removeKeyboard);
        return;
    }

    const gender = userData.gender ? escapeMarkdown(userData.gender.charAt(0).toUpperCase() + userData.gender.slice(1)) : 'Not set';
    const age = userData.age ? escapeMarkdown(String(userData.age)) : 'Not set';
    const locationStatus = userData.location ? 'Shared' : 'Not set';
    const interestedIn = userData.interestedIn ? escapeMarkdown(userData.interestedIn.charAt(0).toUpperCase() + userData.interestedIn.slice(1)) : 'Not set';

    const profileMessage = `👤 *Your Profile:*
\\- Gender: ${gender}
\\- Age: ${age}
\\- Location Data: ${locationStatus}
\\- Interested In: ${interestedIn}

Use /update_profile to make changes.`;

    await ctx.replyWithMarkdownV2(profileMessage, removeKeyboard);
  });

}

module.exports = {
  initialize,
};
