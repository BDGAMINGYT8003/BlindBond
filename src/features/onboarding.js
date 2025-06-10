// src/features/onboarding.js
const { Markup } = require('telegraf');
const { updateUserField, updateUserOnboardingData, getUser } = require('../db/database');

// In-memory store for user onboarding states and data
// Key: userId, Value: { currentStep: 'gender'/'age'/'location'/'interested_in', data: {} }
const onboardingUsers = new Map();

const startOnboarding = async (ctx, userId) => {
    onboardingUsers.set(userId, { currentStep: 'gender', data: {} });
    await ctx.reply('Welcome! To get started, please answer a few questions to personalize your experience.');
    await askGender(ctx, userId);
};

const askGender = async (ctx, userId) => {
    onboardingUsers.get(userId).currentStep = 'gender';
    await ctx.reply('First, please select your gender:', Markup.keyboard([
        ['Male', 'Female']
    ]).resize().oneTime());
};

const handleGender = async (ctx, userId, gender) => {
    if (!['Male', 'Female'].includes(gender)) {
        await ctx.reply('Invalid selection. Please choose Male or Female.', Markup.keyboard([
            ['Male', 'Female']
        ]).resize().oneTime());
        return;
    }
    const userData = onboardingUsers.get(userId);
    userData.data.gender = gender.toLowerCase();
    // No DB update yet, wait until all data is collected
    await askAge(ctx, userId);
};

const askAge = async (ctx, userId) => {
    onboardingUsers.get(userId).currentStep = 'age';
    await ctx.reply('Next, please tell me your age (e.g., 25):', Markup.removeKeyboard());
};

const handleAge = async (ctx, userId, ageText) => {
    const age = parseInt(ageText, 10);
    if (isNaN(age) || age < 13 || age > 99) {
        await ctx.reply('Please enter a valid age between 13 and 99.');
        return;
    }
    const userData = onboardingUsers.get(userId);
    userData.data.age = age;
    await askLocation(ctx, userId);
};

const askLocation = async (ctx, userId) => {
    onboardingUsers.get(userId).currentStep = 'location';
    await ctx.reply('Great! Now, please share your live location. This helps in finding nearby matches but will be kept approximate.', Markup.keyboard([
        [Markup.button.locationRequest('Share Location')]
    ]).resize().oneTime());
};

const handleLocation = async (ctx, userId, location) => {
    if (!location || !location.latitude || !location.longitude) {
        await ctx.reply('Could not read location. Please try sharing it again using the button.', Markup.keyboard([
            [Markup.button.locationRequest('Share Location')]
        ]).resize().oneTime());
        return;
    }
    const userData = onboardingUsers.get(userId);
    userData.data.latitude = location.latitude;
    userData.data.longitude = location.longitude;
    await askInterestedIn(ctx, userId);
};

const askInterestedIn = async (ctx, userId) => {
    onboardingUsers.get(userId).currentStep = 'interested_in';
    await ctx.reply('Finally, who are you interested in meeting?', Markup.keyboard([
        ['Male', 'Female', 'Both']
    ]).resize().oneTime());
};

const handleInterestedIn = async (ctx, userId, interest) => {
    if (!['Male', 'Female', 'Both'].includes(interest)) {
        await ctx.reply('Invalid selection. Please choose Male, Female, or Both.', Markup.keyboard([
            ['Male', 'Female', 'Both']
        ]).resize().oneTime());
        return;
    }
    const userData = onboardingUsers.get(userId);
    userData.data.interested_in = interest.toLowerCase();

    // All data collected, save to DB and complete onboarding
    try {
        await updateUserOnboardingData(userId, userData.data);
        onboardingUsers.delete(userId); // Clear from in-memory store
        await ctx.reply('Thank you! Your onboarding is complete. You can now use /find to search for a chat partner.', Markup.removeKeyboard());
        // Potentially provide a main menu keyboard here
    } catch (error) {
        console.error('Error saving onboarding data:', error);
        await ctx.reply('Sorry, there was an error saving your information. Please try /start again later.');
    }
};

const isUserOnboarding = (userId) => {
    return onboardingUsers.has(userId);
};

const getCurrentOnboardingStep = (userId) => {
    return onboardingUsers.get(userId)?.currentStep;
};

const handleOnboardingMessage = async (ctx) => {
    const userId = ctx.from.id;
    if (!isUserOnboarding(userId)) return false; // Not in onboarding, skip

    const userOnboardingState = onboardingUsers.get(userId);
    const messageText = ctx.message.text;
    const location = ctx.message.location;

    switch (userOnboardingState.currentStep) {
        case 'gender':
            await handleGender(ctx, userId, messageText);
            break;
        case 'age':
            await handleAge(ctx, userId, messageText);
            break;
        case 'location':
            // Location is handled by `on('location')` handler usually
            if (location) {
                await handleLocation(ctx, userId, location);
            } else {
                await ctx.reply('Please use the "Share Location" button.');
            }
            break;
        case 'interested_in':
            await handleInterestedIn(ctx, userId, messageText);
            break;
        default:
            await ctx.reply("I'm not sure what information I was expecting. Let's try starting the onboarding again with /start.");
            onboardingUsers.delete(userId);
    }
    return true; // Message was handled by onboarding
};

module.exports = {
    startOnboarding,
    isUserOnboarding,
    getCurrentOnboardingStep,
    handleOnboardingMessage,
    // Export individual handlers if needed for more complex routing in bot.js
    handleGender,
    handleAge,
    handleLocation,
    handleInterestedIn,
    askGender, // Exporting for potential re-ask scenarios
    askAge,
    askLocation,
    askInterestedIn
};
