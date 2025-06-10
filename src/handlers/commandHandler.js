const User = require('../models/user');
const { handleOnboarding, askForGender } = require('./onboardingHandler');
const { removeKeyboard } = require('../utils/constants');
const { promptUpdateOptions } = require('./updateHandler');
const { escapeMarkdown } = require('../utils/helpers');
const { Markup } = require('telegraf');

/**
 * Handles the /start command.
 * If the user is new, creates a user profile and starts onboarding.
 * If an existing user is not fully onboarded, resumes their onboarding.
 * If an existing user is already onboarded, sends a welcome back message.
 * @param {object} ctx - Telegraf context object.
 */
const handleStartCommand = async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;

  let user = User.findById(userId);

  if (!user) {
    console.log(`New user ${userId} (${firstName}) started the bot.`);
    user = User.create({
      id: userId,
      username: username,
      firstName: firstName,
      onboardingState: 'pending_gender', // Initial state
    });
    // The user is saved within User.create()
    await ctx.reply(`Welcome, ${firstName}! Let's get you set up.`);
    await askForGender(ctx, user); // Start onboarding by asking for gender
  } else {
    console.log(`User ${userId} (${firstName}) restarted with /start. Onboarding state: ${user.onboardingState}`);
    if (!user.isOnboarded()) {
      await ctx.reply(`Welcome back, ${firstName}! Let's continue where you left off.`);
      // Route to the current onboarding step
      await handleOnboarding(ctx, user);
    } else {
      // User is already onboarded
      await ctx.replyWithMarkdownV2(
        `👋 *Welcome back, ${escapeMarkdown(user.firstName)}\\!*\n\nYou're all set up\\. Use /find to connect with someone\\.`,
        { reply_markup: removeKeyboard.reply_markup } // Use removeKeyboard or main menu keyboard
      );
      // TODO: Show main menu keyboard if available
    }
  }
};

// Placeholder for other command handlers
// const handleEndCommand = async (ctx) => { ... }; // Example for future commands

/**
 * Handles the /update command.
 * Prompts an onboarded user with options to update their profile information.
 * If the user is not onboarded, guides them to the onboarding process.
 * @param {object} ctx - Telegraf context object.
 */
const handleUpdateCommand = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || !user.isOnboarded()) {
    await ctx.reply("Please complete your onboarding process first. Use /start to begin.");
    if (user) { // If user exists but not onboarded, help them continue
      const { handleOnboarding } = require('./onboardingHandler');
      await handleOnboarding(ctx, user);
    }
    return;
  }
  await promptUpdateOptions(ctx);
};

/**
 * Handles the /myprofile command.
 * Displays the user's current profile information if they are onboarded.
 * If the user is not onboarded, guides them to the onboarding process.
 * @param {object} ctx - Telegraf context object.
 */
const handleMyProfileCommand = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || !user.isOnboarded()) {
    await ctx.reply("You need to complete your profile first. Use /start to continue onboarding.");
     if (user) {
      const { handleOnboarding } = require('./onboardingHandler');
      await handleOnboarding(ctx, user);
    }
    return;
  }

  let profileMessage = `👤 *Your Profile*:\n\n`;
  profileMessage += `*Name:* ${escapeMarkdown(user.firstName)}\n`;
  profileMessage += `*Username:* ${user.username ? `@${escapeMarkdown(user.username)}` : 'Not set'}\n`;
  profileMessage += `*Gender:* ${user.gender ? escapeMarkdown(user.gender) : 'Not set'}\n`;
  profileMessage += `*Age:* ${user.age ? user.age : 'Not set'}\n`;
  profileMessage += `*Location:* ${user.location ? `Lat: ${user.location.latitude.toFixed(2)}, Lon: ${user.location.longitude.toFixed(2)}` : 'Not set'}\n`;
  profileMessage += `*Interested In:* ${user.interestedIn ? escapeMarkdown(user.interestedIn) : 'Not set'}\n`;
  profileMessage += `*Reputation:* ${user.reputation}\n`;
  if (user.warnings && user.warnings.length > 0) {
    profileMessage += `*Warnings:* ${user.warnings.length}\n`;
  }
  if (user.isBanned) {
    profileMessage += `*Status:* Banned until ${new Date(user.banUntil).toLocaleString()}\n`;
  }
  profileMessage += `\nUse /update to change your information.`;

  await ctx.replyWithMarkdownV2(profileMessage);
};

/**
 * Handles the /report command.
 * Allows a user in an active chat to initiate reporting their chat partner.
 * Sends a confirmation message with inline keyboard options.
 * If the user is not in an active chat or not onboarded, informs them accordingly.
 * @param {object} ctx - Telegraf context object.
 */
const handleReportCommand = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || !user.isOnboarded()) {
    // Using removeKeyboard as this is a direct response to a command, not expecting further text input for this flow immediately.
    return ctx.reply("You need to complete onboarding before accessing this feature.", Markup.removeKeyboard());
  }

  if (user.chatState !== 'chatting' || !user.currentSessionId) {
    return ctx.reply("You can only report a user you are currently chatting with.", Markup.removeKeyboard());
  }

  // Confirm the report
  await ctx.reply(
    "Are you sure you want to report your current chat partner for inappropriate behavior?\n\nThis will also end the current chat.",
    Markup.inlineKeyboard([
      Markup.button.callback('Yes, Report', 'report_yes'),
      Markup.button.callback('No, Cancel', 'report_no')
    ])
  );
};

module.exports = {
  handleStartCommand,
  handleUpdateCommand,
  handleMyProfileCommand,
  handleReportCommand,
  // handleFindCommand is in matchingHandler.js
  // handleEndCommand is in matchingHandler.js
};
