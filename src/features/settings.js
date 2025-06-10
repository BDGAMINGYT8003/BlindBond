// src/features/settings.js
const { Markup } = require('telegraf');
const { updateUserField, getUser } = require('../db/database');
const { askGender: askOnboardingGender, askAge: askOnboardingAge, askLocation: askOnboardingLocation, askInterestedIn: askOnboardingInterestedIn } = require('./onboarding'); // Re-use prompts

// In-memory store for user update states
// Key: userId, Value: { currentUpdateField: 'gender'/'age'/'location'/'interested_in' }
const updatingUsers = new Map();

const startSettings = async (ctx) => {
    const userId = ctx.from.id;
    const user = await getUser(userId); // Assuming user exists as they finished onboarding

    if (!user || !user.onboarding_complete) {
        return ctx.reply("You need to complete the onboarding process first. Use /start.", Markup.removeKeyboard());
    }

    await ctx.reply(
        '⚙️ *Settings Menu*\n\nWhat information would you like to update?',
        {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.keyboard([
                ['🚻 Update Gender', '🎂 Update Age'],
                ['📍 Update Location', '🔍 Update Interest'],
                ['⬅️ Back to Main']
            ]).resize().oneTime().reply_markup
        }
    );
};

const requestGenderUpdate = async (ctx) => {
    const userId = ctx.from.id;
    updatingUsers.set(userId, { currentUpdateField: 'gender' });
    await askOnboardingGender(ctx, userId); // Reuse onboarding's gender question
};

const handleGenderUpdate = async (ctx, gender) => {
    const userId = ctx.from.id;
    if (!['Male', 'Female'].includes(gender)) {
        await ctx.reply('Invalid selection. Please choose Male or Female.', Markup.keyboard([['Male', 'Female']]).resize().oneTime());
        return;
    }
    try {
        await updateUserField(userId, 'gender', gender.toLowerCase());
        updatingUsers.delete(userId);
        await ctx.reply(`✅ Gender updated to ${gender}.`, Markup.removeKeyboard());
        await startSettings(ctx); // Show settings menu again
    } catch (error) {
        console.error('Error updating gender:', error);
        await ctx.reply('Sorry, there was an error updating your gender.');
        updatingUsers.delete(userId);
        await startSettings(ctx);
    }
};

const requestAgeUpdate = async (ctx) => {
    const userId = ctx.from.id;
    updatingUsers.set(userId, { currentUpdateField: 'age' });
    await askOnboardingAge(ctx, userId); // Reuse onboarding's age question
};

const handleAgeUpdate = async (ctx, ageText) => {
    const userId = ctx.from.id;
    const age = parseInt(ageText, 10);
    if (isNaN(age) || age < 13 || age > 99) {
        await ctx.reply('Please enter a valid age between 13 and 99.');
        return;
    }
    try {
        await updateUserField(userId, 'age', age);
        updatingUsers.delete(userId);
        await ctx.reply(`✅ Age updated to ${age}.`, Markup.removeKeyboard());
        await startSettings(ctx);
    } catch (error) {
        console.error('Error updating age:', error);
        await ctx.reply('Sorry, there was an error updating your age.');
        updatingUsers.delete(userId);
        await startSettings(ctx);
    }
};

const requestLocationUpdate = async (ctx) => {
    const userId = ctx.from.id;
    updatingUsers.set(userId, { currentUpdateField: 'location' });
    await askOnboardingLocation(ctx, userId); // Reuse onboarding's location question
};

const handleLocationUpdate = async (ctx, location) => {
    const userId = ctx.from.id;
     if (!location || !location.latitude || !location.longitude) {
        await ctx.reply('Could not read location. Please try sharing it again using the button.', Markup.keyboard([
            [Markup.button.locationRequest('Share Location')]
        ]).resize().oneTime());
        return;
    }
    try {
        await updateUserField(userId, 'location', { latitude: location.latitude, longitude: location.longitude });
        updatingUsers.delete(userId);
        await ctx.reply('✅ Location updated.', Markup.removeKeyboard());
        await startSettings(ctx);
    } catch (error) {
        console.error('Error updating location:', error);
        await ctx.reply('Sorry, there was an error updating your location.');
        updatingUsers.delete(userId);
        await startSettings(ctx);
    }
};

const requestInterestUpdate = async (ctx) => {
    const userId = ctx.from.id;
    updatingUsers.set(userId, { currentUpdateField: 'interested_in' });
    await askOnboardingInterestedIn(ctx, userId); // Reuse onboarding's interest question
};

const handleInterestUpdate = async (ctx, interest) => {
    const userId = ctx.from.id;
    if (!['Male', 'Female', 'Both'].includes(interest)) {
        await ctx.reply('Invalid selection. Please choose Male, Female, or Both.', Markup.keyboard([['Male', 'Female', 'Both']]).resize().oneTime());
        return;
    }
    try {
        await updateUserField(userId, 'interested_in', interest.toLowerCase());
        updatingUsers.delete(userId);
        await ctx.reply(`✅ Interest updated to ${interest}.`, Markup.removeKeyboard());
        await startSettings(ctx);
    } catch (error) {
        console.error('Error updating interest:', error);
        await ctx.reply('Sorry, there was an error updating your interest.');
        updatingUsers.delete(userId);
        await startSettings(ctx);
    }
};

const isUserUpdatingField = (userId) => {
    return updatingUsers.has(userId);
};

const getUpdatingField = (userId) => {
    return updatingUsers.get(userId)?.currentUpdateField;
};

// This function will be called from bot.js on('text') and on('location')
const handleSettingsUpdate = async (ctx) => {
    const userId = ctx.from.id;
    if (!isUserUpdatingField(userId)) return false; // Not in update mode

    const field = getUpdatingField(userId);
    const messageText = ctx.message.text; // Might be undefined if location message
    const location = ctx.message.location;

    switch (field) {
        case 'gender':
            if (messageText) await handleGenderUpdate(ctx, messageText);
            else await ctx.reply("Invalid input for gender. Please use the buttons."); // Or re-ask
            break;
        case 'age':
            if (messageText) await handleAgeUpdate(ctx, messageText);
            else await ctx.reply("Invalid input for age. Please type your age."); // Or re-ask
            break;
        case 'location':
            if (location) await handleLocationUpdate(ctx, location);
            else await ctx.reply("Please use the 'Share Location' button.");
            break;
        case 'interested_in':
            if (messageText) await handleInterestUpdate(ctx, messageText);
            else await ctx.reply("Invalid input for interest. Please use the buttons."); // Or re-ask
            break;
        default:
            await ctx.reply("I'm not sure what information I was expecting for update. Returning to settings menu.");
            updatingUsers.delete(userId);
            await startSettings(ctx);
    }
    return true; // Message was handled by settings update
};

// Function to clear update state if user navigates away or types /cancel equivalent
const cancelUpdate = (userId) => {
    updatingUsers.delete(userId);
};

module.exports = {
    startSettings,
    requestGenderUpdate,
    requestAgeUpdate,
    requestLocationUpdate,
    requestInterestUpdate,
    isUserUpdatingField,
    getUpdatingField,
    handleSettingsUpdate,
    cancelUpdate
};
