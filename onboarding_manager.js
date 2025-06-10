// onboarding_manager.js
// Handles all logic related to the multi-step user onboarding process.

const UserDataService = require('./user_data_service');
const { genderReplyKeyboard, requestLocationKeyboard, interestedInKeyboard, removeKeyboard } = require('./keyboards');
const { Markup } = require('telegraf'); // Required for removeKeyboard if not directly exported as a complete object.

// This function is internal to the module
async function _handleOnboardingStep(ctx, userData) {
  if (!userData) {
    // This should ideally not happen if ensureUserInitialized is called before this
    console.error("User data missing in _handleOnboardingStep for user:", ctx.from.id);
    await ctx.reply("Something went wrong with your onboarding. Please try typing /start again.");
    return;
  }

  let message = "";
  let keyboard = removeKeyboard; // Default to removing keyboard

  switch (userData.onboardingState) {
    case 'pending_gender':
      message = "Please select your gender:";
      keyboard = genderReplyKeyboard;
      break;
    case 'pending_age':
      message = "Please enter your age (e.g., 25).";
      // keyboard is already removeKeyboard
      break;
    case 'pending_location':
      message = "Please share your location. This helps in finding relevant matches but will be kept approximate for your privacy.";
      keyboard = requestLocationKeyboard;
      break;
    case 'pending_interested_in':
      message = "Please select who you are interested in meeting:";
      keyboard = interestedInKeyboard;
      break;
    case 'completed':
      // This state is usually handled by startOnboardingOrWelcome, but if called directly:
      message = "Your onboarding is already complete! You can use /find to search for a partner.";
      // keyboard is already removeKeyboard
      break;
    default:
      console.error(`Unknown onboarding state: ${userData.onboardingState} for user ${ctx.from.id}`);
      message = "An unexpected error occurred during onboarding. Please try /start again.";
      // Attempt to reset to a known state if something is really wrong
      UserDataService.updateUser(ctx.from.id, { onboardingState: 'pending_gender' });
      await UserDataService.saveData(); // Save the reset state
      break;
  }
  await ctx.reply(message, { reply_markup: keyboard.reply_markup });
}

async function startOnboardingOrWelcome(ctx) {
  const userId = ctx.from.id;
  const userObject = ctx.from;
  const userData = UserDataService.ensureUserInitialized(userId, userObject);

  if (userData.onboardingState === 'completed') {
    await ctx.replyWithMarkdownV2(
      `🤖 *Welcome back to Anonymous Chat Bot\\!*

🔍 Use /find to find a random chat partner
🛑 Use /end to finish your current conversation
✏️ Use /update_profile to change your gender, age, etc\\.

*Stay respectful and enjoy chatting\\!*`,
      { reply_markup: removeKeyboard.reply_markup }
    );
  } else {
    await _handleOnboardingStep(ctx, userData);
  }
}

function initialize(bot) {
  // Handler for gender and interest selection
  bot.hears(['Male', 'Female', 'Both'], async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    const messageText = ctx.message.text;

    if (!userData) return; // User should be initialized via /start

    if (userData.onboardingState === 'pending_gender') {
      if (messageText === 'Both') {
        await ctx.reply("Invalid selection for gender. Please choose Male or Female.", { reply_markup: genderReplyKeyboard.reply_markup });
        return;
      }
      UserDataService.updateUser(userId, { gender: messageText.toLowerCase(), onboardingState: 'pending_age' });
      await UserDataService.saveData();
      await ctx.reply(`Gender set to: ${messageText}.`, { reply_markup: removeKeyboard.reply_markup });
      await _handleOnboardingStep(ctx, UserDataService.getUser(userId));
    } else if (userData.onboardingState === 'pending_interested_in') {
      UserDataService.updateUser(userId, { interestedIn: messageText.toLowerCase(), onboardingState: 'completed' });
      await UserDataService.saveData();
      await ctx.reply(`Interest set to: ${messageText}. Onboarding complete!`, { reply_markup: removeKeyboard.reply_markup });
      // Call startOnboardingOrWelcome to show the main "welcome back" message now that onboarding is done.
      await startOnboardingOrWelcome(ctx);
    }
    // If not in these states, the message might be for profile update or a regular chat message, ignore here.
  });

  // Handler for location input
  bot.on('location', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    if (userData && userData.onboardingState === 'pending_location') {
      UserDataService.updateUser(userId, {
        location: { latitude: ctx.message.location.latitude, longitude: ctx.message.location.longitude },
        onboardingState: 'pending_interested_in'
      });
      await UserDataService.saveData();
      await ctx.reply("Location received. Thank you!", { reply_markup: removeKeyboard.reply_markup });
      await _handleOnboardingStep(ctx, UserDataService.getUser(userId));
    }
    // If not in this state, ignore here (might be for profile update or chat)
  });

  // Handler for text input (primarily for age during onboarding)
  bot.on('text', async (ctx, next) => {
    // Do not use ensureUserInitialized here as it might interfere with other text handlers
    // if the user hasn't typed /start yet. /start should be the entry point.
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    if (userData && userData.onboardingState === 'pending_age') {
      const ageInput = ctx.message.text.trim();
      const age = parseInt(ageInput, 10);

      if (isNaN(age) || age < 13 || age > 99) {
        await ctx.reply("Invalid age. Please enter a number between 13 and 99.");
        return; // Stop processing, let user try again
      }
      UserDataService.updateUser(userId, { age: age, onboardingState: 'pending_location' });
      await UserDataService.saveData();
      await ctx.reply(`Age set to: ${age}.`);
      await _handleOnboardingStep(ctx, UserDataService.getUser(userId));
      return; // Indicate that this text message has been handled by onboarding
    }

    // If not handled by onboarding age input, pass to other text handlers (e.g., chat, commands if not caught by specific command handlers)
    return next();
  });
}

module.exports = {
  initialize,
  startOnboardingOrWelcome,
  // _handleOnboardingStep is internal, not exported
};
