const User = require('../models/user');
const { Markup } = require('telegraf');
const { askForGender, askForAge, askForLocation, askForInterest } = require('./onboardingHandler');
const { MIN_AGE, MAX_AGE, GENDER_OPTIONS, INTEREST_OPTIONS } = require('../utils/constants');

/**
 * Prompts the user with options to update their profile information.
 * Sends a custom keyboard with update categories.
 * @param {object} ctx - Telegraf context object.
 */
const promptUpdateOptions = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || !user.isOnboarded()) {
    return ctx.reply("You need to complete the onboarding process first. Use /start.");
  }
  // Note: No specific 'user.updateState' is set here, as this is the main menu for updates.
  // The state will be set when the user chooses an option (e.g., 'Update Gender' text).
  await ctx.reply(
    "What information would you like to update?",
    Markup.keyboard([
      ['Update Gender', 'Update Age'],
      ['Update Location', 'Update Interest'],
      ['Cancel Update'] // This button allows user to explicitly exit update mode.
    ]).resize().oneTime()
  );
};

/**
 * Initiates the gender update process for the user.
 * Sets user's updateState to 'pending_gender_update'.
 * @param {object} ctx - Telegraf context object.
 */
const startGenderUpdate = async (ctx) => {
  const user = User.findById(ctx.from.id);
  if (!user || !user.isOnboarded()) return ctx.reply("Please complete onboarding first with /start.");
  user.update({ updateState: 'pending_gender_update' });
  await askForGender(ctx); // askForGender from onboardingHandler doesn't need user obj
};

/**
 * Initiates the age update process for the user.
 * Sets user's updateState to 'pending_age_update'.
 * @param {object} ctx - Telegraf context object.
 */
const startAgeUpdate = async (ctx) => {
  const user = User.findById(ctx.from.id);
  if (!user || !user.isOnboarded()) return ctx.reply("Please complete onboarding first with /start.");
  user.update({ updateState: 'pending_age_update' });
  await askForAge(ctx);
};

/**
 * Initiates the location update process for the user.
 * Sets user's updateState to 'pending_location_update'.
 * @param {object} ctx - Telegraf context object.
 */
const startLocationUpdate = async (ctx) => {
  const user = User.findById(ctx.from.id);
  if (!user || !user.isOnboarded()) return ctx.reply("Please complete onboarding first with /start.");
  user.update({ updateState: 'pending_location_update' });
  await askForLocation(ctx);
};

/**
 * Initiates the interest update process for the user.
 * Sets user's updateState to 'pending_interest_update'.
 * @param {object} ctx - Telegraf context object.
 */
const startInterestUpdate = async (ctx) => {
  const user = User.findById(ctx.from.id);
  if (!user || !user.isOnboarded()) return ctx.reply("Please complete onboarding first with /start.");
  user.update({ updateState: 'pending_interest_update' });
  await askForInterest(ctx);
};

/**
 * Processes the user's gender update.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processGenderUpdate = async (ctx, user) => {
  const gender = ctx.message.text;
  if (GENDER_OPTIONS.includes(gender)) {
    user.update({ gender: gender.toLowerCase(), updateState: null });
    await ctx.reply("✅ Your gender has been updated.", Markup.removeKeyboard());
  } else {
    await ctx.reply("Please select a valid gender from the options.", Markup.keyboard(GENDER_OPTIONS).resize().oneTime());
  }
};

/**
 * Processes the user's age update.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processAgeUpdate = async (ctx, user) => {
  const ageText = ctx.message.text;
  const age = parseInt(ageText, 10);
  if (!isNaN(age) && age >= MIN_AGE && age <= MAX_AGE) {
    user.update({ age, updateState: null });
    await ctx.reply("✅ Your age has been updated.", Markup.removeKeyboard());
  } else {
    await ctx.reply(`Please enter a valid age between ${MIN_AGE} and ${MAX_AGE}.`);
  }
};

/**
 * Processes the user's location update.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processLocationUpdate = async (ctx, user) => {
  if (ctx.message.location) {
    const { latitude, longitude } = ctx.message.location;
    user.update({ location: { latitude, longitude }, updateState: null });
    await ctx.reply("✅ Your location has been updated.", Markup.removeKeyboard());
  } else {
    await ctx.reply("Please use the 'Share Location' button.");
  }
};

/**
 * Processes the user's interest update.
 * @param {object} ctx - Telegraf context object.
 * @param {User} user - The user instance.
 */
const processInterestUpdate = async (ctx, user) => {
  const interest = ctx.message.text;
  if (INTEREST_OPTIONS.includes(interest)) {
    user.update({ interestedIn: interest.toLowerCase(), updateState: null });
    await ctx.reply("✅ Your interest has been updated.", Markup.removeKeyboard());
  } else {
    await ctx.reply("Please select a valid option.", Markup.keyboard(INTEREST_OPTIONS).resize().oneTime());
  }
};

/**
 * Cancels any pending profile update operation for the user.
 * Clears user's updateState.
 * @param {object} ctx - Telegraf context object.
 */
const cancelUpdateProcess = async (ctx) => {
  const user = User.findById(ctx.from.id);
  if (user) { // Check if user exists
    user.update({ updateState: null });
  }
  await ctx.reply("Update process cancelled.", Markup.removeKeyboard());
};

/**
 * Routes incoming messages to the appropriate update processing function
 * based on the user's current updateState.
 * @param {object} ctx - Telegraf context object.
 * @returns {boolean} True if the message was handled by an update step, false otherwise.
 */
const routeUpdateMessage = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || !user.updateState) {
    return false;
  }

  switch (user.updateState) {
    case 'pending_gender_update':
      if (ctx.message && ctx.message.text) {
        await processGenderUpdate(ctx, user);
        return true;
      }
      break;
    case 'pending_age_update':
      if (ctx.message && ctx.message.text) {
        await processAgeUpdate(ctx, user);
        return true;
      }
      break;
    case 'pending_location_update':
      if (ctx.message && ctx.message.location) {
        await processLocationUpdate(ctx, user);
        return true;
      }
      break;
    case 'pending_interest_update':
      if (ctx.message && ctx.message.text) {
        await processInterestUpdate(ctx, user);
        return true;
      }
      break;
    default:
      console.warn(`User ${user.id} in unhandled update state: ${user.updateState}`);
      return false;
  }
  // If message type doesn't match expected input for current state, re-prompt.
  // This is handled by the main message handler in bot.js calling the appropriate start<Property>Update function.
  return false;
};

module.exports = {
  promptUpdateOptions,
  startGenderUpdate,
  startAgeUpdate,
  startLocationUpdate,
  startInterestUpdate,
  cancelUpdateProcess,
  routeUpdateMessage,
};
