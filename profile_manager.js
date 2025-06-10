// profile_manager.js
// Handles logic related to user profile viewing and updates.

const UserDataService = require('./user_data_service');
const { genderReplyKeyboard, requestLocationKeyboard, interestedInKeyboard, updateProfileKeyboard, removeKeyboard } = require('./keyboards');
// const OnboardingManager = require('./onboarding_manager'); // For "Back to Main Menu" if it calls startOnboardingOrWelcome

async function showUpdateOptions(ctx) {
  const userId = ctx.from.id;
  // Ensure user is initialized, especially if /update_profile can be called without /start (though less likely)
  const userData = UserDataService.ensureUserInitialized(userId, ctx.from);

  if (userData.onboardingState !== 'completed') {
    await ctx.reply("Please complete the onboarding process first before updating your profile. Use /start to begin or continue onboarding.", { reply_markup: removeKeyboard.reply_markup });
    return;
  }

  UserDataService.updateUser(userId, { state: 'updating_profile', profileUpdateState: 'selecting_option' });
  // No immediate save needed here, as it's a transient state selection menu. Save upon actual data change.
  await ctx.reply("What would you like to update?", { reply_markup: updateProfileKeyboard.reply_markup });
}

function initialize(bot) {
  // Button handlers for selecting which profile attribute to update
  bot.hears('Update Gender', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
      UserDataService.updateUser(userId, { profileUpdateState: 'pending_new_gender' });
      // await UserDataService.saveData(); // Save this transient state change if you want it to persist through restarts
      await ctx.reply("Please select your new gender:", { reply_markup: genderReplyKeyboard.reply_markup });
    } else if (userData && userData.onboardingState === 'completed' && userData.state !== 'updating_profile') {
        await ctx.reply("Please use the /update_profile command first to access update options.", {reply_markup: removeKeyboard.reply_markup});
    }
    // Ignore if in wrong state/sub-state
  });

  bot.hears('Update Age', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
      UserDataService.updateUser(userId, { profileUpdateState: 'pending_new_age' });
      await ctx.reply("Please enter your new age (e.g., 25).", { reply_markup: removeKeyboard.reply_markup });
    } else if (userData && userData.onboardingState === 'completed' && userData.state !== 'updating_profile') {
        await ctx.reply("Please use the /update_profile command first to access update options.", {reply_markup: removeKeyboard.reply_markup});
    }
  });

  bot.hears('Update Location', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
      UserDataService.updateUser(userId, { profileUpdateState: 'pending_new_location' });
      await ctx.reply("Please share your new location.", { reply_markup: requestLocationKeyboard.reply_markup });
    } else if (userData && userData.onboardingState === 'completed' && userData.state !== 'updating_profile') {
        await ctx.reply("Please use the /update_profile command first to access update options.", {reply_markup: removeKeyboard.reply_markup});
    }
  });

  bot.hears('Update Interest', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
      UserDataService.updateUser(userId, { profileUpdateState: 'pending_new_interest' });
      await ctx.reply("Please select your new interest:", { reply_markup: interestedInKeyboard.reply_markup });
    } else if (userData && userData.onboardingState === 'completed' && userData.state !== 'updating_profile') {
        await ctx.reply("Please use the /update_profile command first to access update options.", {reply_markup: removeKeyboard.reply_markup});
    }
  });

  // Handler for actual data input (gender, interest)
  bot.hears(['Male', 'Female', 'Both'], async (ctx, next) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    const messageText = ctx.message.text;

    if (!userData || userData.state !== 'updating_profile') return next(); // Pass to onboarding or other handlers

    if (userData.profileUpdateState === 'pending_new_gender') {
      if (messageText === 'Both') {
        await ctx.reply("Invalid selection for gender. Please choose Male or Female.", { reply_markup: genderReplyKeyboard.reply_markup });
        return;
      }
      UserDataService.updateUser(userId, { gender: messageText.toLowerCase(), profileUpdateState: 'selecting_option' });
      await UserDataService.saveData();
      await ctx.reply(`Gender updated to: ${messageText}.`, { reply_markup: updateProfileKeyboard.reply_markup });
    } else if (userData.profileUpdateState === 'pending_new_interest') {
      UserDataService.updateUser(userId, { interestedIn: messageText.toLowerCase(), profileUpdateState: 'selecting_option' });
      await UserDataService.saveData();
      await ctx.reply(`Interest updated to: ${messageText}.`, { reply_markup: updateProfileKeyboard.reply_markup });
    } else {
      return next(); // Not for profile update gender/interest, pass to other handlers
    }
  });

  // Handler for location update
  bot.on('location', async (ctx, next) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'pending_new_location') {
      UserDataService.updateUser(userId, {
        location: { latitude: ctx.message.location.latitude, longitude: ctx.message.location.longitude },
        profileUpdateState: 'selecting_option'
      });
      await UserDataService.saveData();
      await ctx.reply("Location updated successfully!", { reply_markup: updateProfileKeyboard.reply_markup });
      return; // Processed by profile manager
    }
    return next(); // Pass to onboarding or other handlers
  });

  // Handler for text input (age update)
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'pending_new_age') {
      const ageInput = ctx.message.text.trim();
      const age = parseInt(ageInput, 10);

      if (isNaN(age) || age < 13 || age > 99) {
        await ctx.reply("Invalid age. Please enter a number between 13 and 99.");
        return; // Let user try again, keep state
      }
      UserDataService.updateUser(userId, { age: age, profileUpdateState: 'selecting_option' });
      await UserDataService.saveData();
      await ctx.reply(`Age updated to: ${age}.`, { reply_markup: updateProfileKeyboard.reply_markup });
      return; // Processed by profile manager
    }
    return next(); // Pass to onboarding or other text handlers
  });

  // Handle "Back to Main Menu"
  bot.hears('Back to Main Menu', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    if (userData && userData.state === 'updating_profile') {
      UserDataService.updateUser(userId, { state: 'idle', profileUpdateState: null });
      await UserDataService.saveData();
      await ctx.reply("Returning to the main menu.", { reply_markup: removeKeyboard.reply_markup });
      // To show the main welcome message, the user might need to type /start again,
      // or we could require OnboardingManager here and call its startOnboardingOrWelcome.
      // For now, keeping it simple. A follow-up /start will give them the main options.
    }
    // If not in updating_profile state, this button might be from an old keyboard,
    // let other handlers (like main text handler if it becomes a generic message) deal with it, or ignore.
  });
}

module.exports = {
  initialize,
  showUpdateOptions,
};
