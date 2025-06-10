const User = require('../models/user');
const { Markup } = require('telegraf');
const { MIN_AGE, MAX_AGE, GENDER_OPTIONS, INTEREST_OPTIONS } = require('../utils/constants');

/**
 * Main router for handling the next step in a user's onboarding process.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const handleOnboarding = async (ctx, user) => {
  console.log(`Handling onboarding for user ${user.id} in state ${user.onboardingState}`);

  switch (user.onboardingState) {
    case 'pending_gender':
      await askForGender(ctx); // Removed user param as it's not used by askFor functions now
      break;
    case 'pending_age':
      await askForAge(ctx);
      break;
    case 'pending_location':
      await askForLocation(ctx);
      break;
    case 'pending_interest':
      await askForInterest(ctx);
      break;
    case 'completed':
      await ctx.reply("You are already onboarded!");
      break;
    default:
      console.error(`Unknown onboarding state: ${user.onboardingState} for user ${user.id}`);
      user.update({ onboardingState: 'pending_gender' });
      await askForGender(ctx);
      break;
  }
};

/**
 * Asks the user for their gender.
 * @param {object} ctx - Telegraf context object.
 */
const askForGender = async (ctx) => {
  await ctx.reply("Let's get to know you better! What's your gender?", Markup.keyboard(GENDER_OPTIONS).resize().oneTime());
};

/**
 * Processes the user's gender input during onboarding.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processGender = async (ctx, user) => {
  const gender = ctx.message.text;
  if (GENDER_OPTIONS.includes(gender)) {
    user.update({ gender: gender.toLowerCase(), onboardingState: 'pending_age' });
    await askForAge(ctx);
  } else {
    await ctx.reply("Please select a valid gender from the options.", Markup.keyboard(GENDER_OPTIONS).resize().oneTime());
  }
};

/**
 * Asks the user for their age.
 * @param {object} ctx - Telegraf context object.
 */
const askForAge = async (ctx) => {
  await ctx.reply("Great! How old are you?", Markup.removeKeyboard()); // Explicitly remove previous keyboard
};

/**
 * Processes the user's age input during onboarding.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processAge = async (ctx, user) => {
  const ageText = ctx.message.text;
  const age = parseInt(ageText, 10);
  if (!isNaN(age) && age >= MIN_AGE && age <= MAX_AGE) {
    user.update({ age, onboardingState: 'pending_location' });
    await askForLocation(ctx);
  } else {
    await ctx.reply(`Please enter a valid age between ${MIN_AGE} and ${MAX_AGE}.`);
  }
};

/**
 * Asks the user to share their location.
 * @param {object} ctx - Telegraf context object.
 */
const askForLocation = async (ctx) => {
  await ctx.reply("Thanks! Now, please share your location so we can find people near you.",
    Markup.keyboard([
      Markup.button.locationRequest('Share Location')
    ]).resize().oneTime()
  );
};

/**
 * Processes the user's location input during onboarding.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processLocation = async (ctx, user) => {
  if (ctx.message.location) {
    const { latitude, longitude } = ctx.message.location;
    user.update({ location: { latitude, longitude }, onboardingState: 'pending_interest' });
    await askForInterest(ctx);
  } else {
    await ctx.reply("Please use the 'Share Location' button to share your location.");
  }
};

/**
 * Asks the user for their interest in matching.
 * @param {object} ctx - Telegraf context object.
 */
const askForInterest = async (ctx) => {
  await ctx.reply("Almost done! Who are you interested in meeting?", Markup.keyboard(INTEREST_OPTIONS).resize().oneTime());
};

/**
 * Processes the user's interest input during onboarding.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processInterest = async (ctx, user) => {
  const interest = ctx.message.text;
  if (INTEREST_OPTIONS.includes(interest)) {
    user.update({ interestedIn: interest.toLowerCase(), onboardingState: 'completed' });
    await ctx.reply("🎉 Onboarding complete! You're all set up.\nUse /find to look for a chat partner.", Markup.removeKeyboard());
  } else {
    await ctx.reply("Please select a valid option for who you're interested in.", Markup.keyboard(INTEREST_OPTIONS).resize().oneTime());
  }
};

/**
 * Routes incoming messages to the appropriate onboarding processing function
 * based on the user's current onboardingState.
 * @param {object} ctx - Telegraf context object.
 * @returns {boolean} True if the message was handled by an onboarding step, false otherwise.
 */
const routeOnboardingMessage = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || user.isOnboarded()) {
    return false;
  }

  switch (user.onboardingState) {
    case 'pending_gender':
      if (ctx.message && ctx.message.text) {
        await processGender(ctx, user);
        return true;
      }
      break;
    case 'pending_age':
      if (ctx.message && ctx.message.text) {
        await processAge(ctx, user);
        return true;
      }
      break;
    case 'pending_location':
      if (ctx.message && ctx.message.location) {
        await processLocation(ctx, user);
        return true;
      }
      break;
    case 'pending_interest':
      if (ctx.message && ctx.message.text) {
        await processInterest(ctx, user);
        return true;
      }
      break;
    default:
      console.warn(`User ${user.id} in unhandled onboarding state ${user.onboardingState} during message routing.`);
      return false;
  }
  // If message type doesn't match expected input for current state, re-prompt.
  // This is now handled by the main message handler in bot.js calling handleOnboarding again.
  return false;
};

module.exports = {
  handleOnboarding,
  routeOnboardingMessage,
  askForGender, // Exported for /start command
};
