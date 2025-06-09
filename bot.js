const { Telegraf, Markup } = require('telegraf');
const fs = require('fs').promises;
const path = require('path');

// Define file paths
const USER_DATA_PATH = path.join(__dirname, 'userData.json');

// Bot token - replace with environment variable in production
const BOT_TOKEN = '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo';

// Admin User ID(s) - Replace with actual admin ID(s)
const ADMIN_USER_IDS = [123456789];

// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// Data structures
const users = new Map(); // userId -> { state, userObject, gender, age, location, interestedIn, onboardingStep, warnings, isBanned, banUntil }
const waitingQueue = []; // Array of user IDs waiting for partners
const sessions = new Map(); // userId -> partnerId
const sessionDetails = new Map(); // sessionId -> { startTime, messageCount, user1Id, user2Id }
const usernameShareData = new Map(); // sessionId -> { user1Shares: 0, user2Shares: 0 }
const reports = new Map(); // reportId -> { reporterId, reportedId, partnerUsername, timestamp, reason, sessionId }
let nextReportId = 1;

// Rate limiting
const messageTimestamps = new Map(); // userId -> [timestamps]
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const MAX_MESSAGES_IN_WINDOW = 3;

// Username sharing restrictions
const USERNAME_SHARE_COOLDOWN = 60000; // 1 minute in milliseconds
const MAX_USERNAME_SHARES = 2; // Maximum shares per user per session

// Helper function to check if username sharing is allowed
const canShareUsername = (userId) => {
  const partnerId = sessions.get(userId);
  if (!partnerId) return { allowed: false, reason: 'No active chat' };
  
  const sessionId = [userId, partnerId].sort().join('-');
  const sessionData = sessionDetails.get(sessionId);
  
  if (!sessionData) return { allowed: false, reason: 'Session not found' };
  
  const timeSinceConnection = Date.now() - sessionData.startTime;
  if (timeSinceConnection < USERNAME_SHARE_COOLDOWN) {
    const remainingTime = Math.ceil((USERNAME_SHARE_COOLDOWN - timeSinceConnection) / 1000);
    return { 
      allowed: false, 
      reason: 'cooldown', 
      remainingTime 
    };
  }
  
  const shareData = usernameShareData.get(sessionId) || { user1Shares: 0, user2Shares: 0 };
  const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares';
  
  if (shareData[userKey] >= MAX_USERNAME_SHARES) {
    return { 
      allowed: false, 
      reason: 'limit_reached' 
    };
  }
  
  return { allowed: true };
};

// Helper function to increment username share count
const incrementShareCount = (userId) => {
  const partnerId = sessions.get(userId);
  if (!partnerId) return;
  
  const sessionId = [userId, partnerId].sort().join('-');
  const sessionData = sessionDetails.get(sessionId);
  if (!sessionData) return;
  
  const shareData = usernameShareData.get(sessionId) || { user1Shares: 0, user2Shares: 0 };
  const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares';
  
  shareData[userKey]++;
  usernameShareData.set(sessionId, shareData);
};

// Content filtering, utility functions, keyboards (assumed to be correct from previous steps)
const MAX_MESSAGE_LENGTH = 500;
const prohibitedKeywords = ['spam', 'scam', 'fake'];

const escapeMarkdown = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
};

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hour${hours === 1 ? '' : 's'} and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
};

const chatActiveKeyboard = Markup.keyboard([['🔗 Share Username'], ['🔄 End & Find New', '❌ End Chat']]).resize().oneTime();
const searchingKeyboard = Markup.keyboard([['❌ Cancel Search']]).resize().oneTime();
const shareConfirmKeyboard = Markup.inlineKeyboard([[Markup.button.callback('✅ Yes', 'share_yes'), Markup.button.callback('❌ No', 'share_no')]]);
const removeKeyboard = Markup.removeKeyboard();

// User Initialization
const ensureUserInitialized = async (ctx) => {
  if (!ctx.from) return null;
  const userId = ctx.from.id;
  const cleanedUserObject = { id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name, language_code: ctx.from.language_code };
  let needsSave = false;
  if (!users.has(userId)) {
    users.set(userId, {
      state: 'onboarding', userObject: cleanedUserObject, gender: null, age: null, location: null, interestedIn: null,
      onboardingStep: 'gender', warnings: 0, isBanned: false, banUntil: null
    });
    console.log(`User ${userId} (${ctx.from.username || 'no_username'}) initialized for onboarding`);
    needsSave = true;
  } else {
    const existingUser = users.get(userId);
    if (JSON.stringify(existingUser.userObject) !== JSON.stringify(cleanedUserObject)) {
      existingUser.userObject = cleanedUserObject;
      needsSave = true;
    }
    if (existingUser.gender === undefined) { existingUser.gender = null; needsSave = true; }
    if (existingUser.age === undefined) { existingUser.age = null; needsSave = true; }
    if (existingUser.location === undefined) { existingUser.location = null; needsSave = true; }
    if (existingUser.interestedIn === undefined) { existingUser.interestedIn = null; needsSave = true; }
    if (existingUser.onboardingStep === undefined) { existingUser.onboardingStep = 'gender'; needsSave = true; }
    if (existingUser.warnings === undefined) { existingUser.warnings = 0; needsSave = true; }
    if (existingUser.isBanned === undefined) { existingUser.isBanned = false; needsSave = true; }
    if (existingUser.banUntil === undefined) { existingUser.banUntil = null; needsSave = true; }
    if (existingUser.state === 'idle' && (existingUser.gender === null || existingUser.age === null || existingUser.location === null || existingUser.interestedIn === null)) {
      existingUser.state = 'onboarding'; existingUser.onboardingStep = 'gender';
      console.log(`User ${userId} switched from idle to onboarding due to missing profile data`);
      needsSave = true;
    }
    if (needsSave) users.set(userId, existingUser);
  }
  if (needsSave) await saveUserData();
  return users.get(userId);
};

// Persistence
async function saveUserData() {
  try {
    const dataToSave = {
      users: Array.from(users.entries()), sessions: Array.from(sessions.entries()),
      sessionDetails: Array.from(sessionDetails.entries()), waitingQueue,
      usernameShareData: Array.from(usernameShareData.entries()), reports: Array.from(reports.entries()), nextReportId,
    };
    await fs.writeFile(USER_DATA_PATH, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log('User data saved successfully.');
  } catch (error) { console.error('Failed to save user data:', error); }
}

async function loadUserData() {
  try {
    const jsonData = await fs.readFile(USER_DATA_PATH, 'utf8');
    const loadedData = JSON.parse(jsonData);
    users.clear(); if (loadedData.users) loadedData.users.forEach(([k, v]) => users.set(k, v));
    sessions.clear(); if (loadedData.sessions) loadedData.sessions.forEach(([k, v]) => sessions.set(k, v));
    sessionDetails.clear(); if (loadedData.sessionDetails) loadedData.sessionDetails.forEach(([k, v]) => { v.startTime = new Date(v.startTime); sessionDetails.set(k, v); });
    waitingQueue.length = 0; if (loadedData.waitingQueue) waitingQueue.push(...loadedData.waitingQueue);
    usernameShareData.clear(); if (loadedData.usernameShareData) loadedData.usernameShareData.forEach(([k, v]) => usernameShareData.set(k, v));
    reports.clear(); if (loadedData.reports) loadedData.reports.forEach(([k, v]) => { v.timestamp = new Date(v.timestamp); reports.set(k, v); });
    nextReportId = loadedData.nextReportId || 1;
    console.log('User data loaded successfully.');
  } catch (error) {
    if (error.code === 'ENOENT') console.log('No existing user data found. Starting fresh.');
    else if (error instanceof SyntaxError) {
      console.error('Failed to parse userData.json. Backing up and starting fresh.', error);
      try { await fs.copyFile(USER_DATA_PATH, `${USER_DATA_PATH}.${Date.now()}.corrupted`); console.log('Corrupted file backed up.'); }
      catch (backupError) { console.error('Failed to back up corrupted data file:', backupError); }
    } else console.error('Failed to load user data:', error);
  }
}

// Conversation Summary and Session Cleanup (Assumed correct from previous steps)
const sendConversationSummary = async (userId, partnerId, sessionId, reason = 'ended') => {
  if (!sessionDetails.has(sessionId)) return;
  const details = sessionDetails.get(sessionId);
  const duration = new Date() - details.startTime;
  const formattedDuration = formatDuration(duration);
  const messageCount = details.messageCount;
  let summaryMessage = reason === 'error' ? `🔚 *The conversation has ended due to a connection issue\\.*\n\n⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}\n💬 *Total messages exchanged:* ${messageCount}\n\nUse /find to start a new conversation\\.` : `🔚 *The conversation has officially concluded\\.*\n\n⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}\n💬 *Total messages exchanged:* ${messageCount}\n\nThanks for using Anonymous Chat Bot\\! Use /find to start a new conversation\\.`;
  try { await bot.telegram.sendMessage(userId, summaryMessage, { parse_mode: 'MarkdownV2', reply_markup: removeKeyboard.reply_markup }); } catch (e) { console.error(`Failed to send summary to user ${userId}:`, e); }
  try { await bot.telegram.sendMessage(partnerId, summaryMessage, { parse_mode: 'MarkdownV2', reply_markup: removeKeyboard.reply_markup }); } catch (e) { console.error(`Failed to send summary to partner ${partnerId}:`, e); }
  sessionDetails.delete(sessionId);
};
const cleanupSession = async (userId, partnerId, sessionId, reason = 'ended') => {
  await sendConversationSummary(userId, partnerId, sessionId, reason);
  let changed = false;
  if (sessions.delete(userId)) changed = true; if (sessions.delete(partnerId)) changed = true; if (usernameShareData.delete(sessionId)) changed = true;
  const d1 = users.get(userId); if (d1 && d1.state !== 'idle') { d1.state = 'idle'; users.set(userId, d1); changed = true; }
  const d2 = users.get(partnerId); if (d2 && d2.state !== 'idle') { d2.state = 'idle'; users.set(partnerId, d2); changed = true; }
  if (changed) await saveUserData();
};

// Onboarding Prompt Functions
const askForGender = (ctx) => ctx.replyWithMarkdownV2("Welcome\\! To personalize your experience, please complete a brief onboarding\\. First, what is your gender?", Markup.keyboard(['Male', 'Female']).resize().oneTime());
const askForAge = (ctx) => { console.log(`User ${ctx.from.id} reached askForAge step.`); ctx.replyWithMarkdownV2("Great\\! Now, please enter your age \\(e\\.g\\., 25\\)\\.", Markup.removeKeyboard()); };
const askForInterestedIn = (ctx) => { console.log(`User ${ctx.from.id} reached askForInterestedIn step.`); ctx.replyWithMarkdownV2("Next, who are you interested in meeting?", Markup.keyboard(['Male', 'Female', 'Both']).resize().oneTime()); };
const askForLocation = (ctx) => { console.log(`User ${ctx.from.id} reached askForLocation step.`); ctx.replyWithMarkdownV2("Lastly, to help find relevant matches, please share your current location\\. Tap the button below\\.", Markup.keyboard([Markup.button.locationRequest('Share My Location')]).resize().oneTime()); };

// Welcome Message
const sendWelcomeMessage = (ctx) => ctx.replyWithMarkdownV2(`🤖 *Welcome to Anonymous Chat Bot\\!*\n\n🔍 Use /find to find a random chat partner\n🛑 Use /end to finish your current conversation\n📝 Send text, photos, videos, stickers, and any media anonymously\n\n*Stay respectful and enjoy chatting\\!*`, { reply_markup: removeKeyboard.reply_markup });

// Command: /start
bot.start(async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return;
  const userData = users.get(user.userObject.id);
  if (userData.state === 'onboarding') {
    if (userData.onboardingStep === 'gender') askForGender(ctx);
    else if (userData.onboardingStep === 'age') askForAge(ctx);
    else if (userData.onboardingStep === 'interested_in') askForInterestedIn(ctx);
    else if (userData.onboardingStep === 'location') askForLocation(ctx);
    else sendWelcomeMessage(ctx); // Fallback if step is unknown/completed
  } else sendWelcomeMessage(ctx);
});

// Command: /find
bot.command('find', async (ctx) => {
  const userCtx = await ensureUserInitialized(ctx); if (!userCtx) return;
  const userId = userCtx.userObject.id;
  const userData = users.get(userId); // Get fresh userData after ensureUserInitialized

  if (userData.state === 'onboarding') {
    let stepMessage = "Please complete the onboarding process before finding a partner. ";
    switch (userData.onboardingStep) {
      case 'gender': stepMessage += "Let's continue with selecting your gender."; await ctx.replyWithMarkdownV2(escapeMarkdown(stepMessage)); askForGender(ctx); break;
      case 'age': stepMessage += "Let's continue with entering your age."; await ctx.replyWithMarkdownV2(escapeMarkdown(stepMessage)); askForAge(ctx); break;
      case 'interested_in': stepMessage += "Let's continue with selecting who you're interested in."; await ctx.replyWithMarkdownV2(escapeMarkdown(stepMessage)); askForInterestedIn(ctx); break;
      case 'location': stepMessage += "Let's continue with sharing your location."; await ctx.replyWithMarkdownV2(escapeMarkdown(stepMessage)); askForLocation(ctx); break;
      default:
        const currentStep = userData.onboardingStep;
        if (!currentStep.startsWith('update_') && currentStep !== 'completed') {
          stepMessage = "It seems there's an issue with your onboarding step. Let's start with gender.";
          await ctx.replyWithMarkdownV2(escapeMarkdown(stepMessage));
          userData.onboardingStep = 'gender'; users.set(userId, userData); await saveUserData(); askForGender(ctx);
        } else if (currentStep === 'completed') {
          userData.state = 'idle'; users.set(userId, userData); await saveUserData();
          await ctx.replyWithMarkdownV2("Your onboarding is complete. You can now use /find.");
        } else { await ctx.replyWithMarkdownV2("Please complete your profile update first\\."); }
    }
    return;
  }
  if (sessions.has(userId)) return ctx.replyWithMarkdownV2("❌ *You're already in a chat\\!* Use /end to finish your current conversation first\\.", removeKeyboard);
  if (waitingQueue.includes(userId)) return ctx.replyWithMarkdownV2("⏳ *You're already searching for a partner\\.*\n\nUse the button below to cancel your search\\.", searchingKeyboard);
  await ctx.replyWithMarkdownV2("🔍 *Searching for a chat partner\\.\\.\\.*\n\n⏳ Please wait while we connect you\\.", searchingKeyboard);
  let stateChanged = false;
  if (userData.state !== 'waiting') { userData.state = 'waiting'; stateChanged = true; }
  if (!waitingQueue.includes(userId)) { waitingQueue.push(userId); stateChanged = true; }
  if (stateChanged) { users.set(userId, userData); await saveUserData(); }
  console.log(`User ${userId} entered waiting queue`);
  if (waitingQueue.length >= 2) {
    const u1Id = waitingQueue.shift(), u2Id = waitingQueue.shift();
    const u1Data = users.get(u1Id), u2Data = users.get(u2Id);
    if (!u1Data || !u2Data) { console.error('User data missing during pairing'); if(u1Id && !u1Data) waitingQueue.unshift(u1Id); if(u2Id && !u2Data) waitingQueue.unshift(u2Id); return; }
    sessions.set(u1Id, u2Id); sessions.set(u2Id, u1Id);
    u1Data.state = 'chatting'; u2Data.state = 'chatting';
    users.set(u1Id, u1Data); users.set(u2Id, u2Data);
    const sId = [u1Id, u2Id].sort().join('-');
    sessionDetails.set(sId, { startTime: new Date(), messageCount: 0, user1Id: u1Id, user2Id: u2Id });
    usernameShareData.set(sId, { user1Shares: 0, user2Shares: 0 });
    await saveUserData(); console.log(`Session started: ${sId}`);
    setTimeout(async () => {
      const u1PartnerInfo = `*Partner's Details:*\n*Gender:* ${escapeMarkdown(u2Data.gender)}\n*Age:* ${u2Data.age}\n*Interested In:* ${escapeMarkdown(u2Data.interestedIn || 'N/A')}\n*Location:* ${u2Data.location ? 'Shared' : 'Not Shared'}`;
      const u2PartnerInfo = `*Partner's Details:*\n*Gender:* ${escapeMarkdown(u1Data.gender)}\n*Age:* ${u1Data.age}\n*Interested In:* ${escapeMarkdown(u1Data.interestedIn || 'N/A')}\n*Location:* ${u1Data.location ? 'Shared' : 'Not Shared'}`;
      const baseMsg = `\n\n💬 Start chatting by sending messages, photos, videos, stickers, or any media\\.\n🔗 Use the button below to share your username if you want\\.`;
      try { await bot.telegram.sendMessage(u1Id, `🎉 *You're now connected with a stranger\\!*\n\n${u1PartnerInfo}${baseMsg}`, { parse_mode: 'MarkdownV2', reply_markup: chatActiveKeyboard.reply_markup }); } catch (e) { console.error(e); }
      try { await bot.telegram.sendMessage(u2Id, `🎉 *You're now connected with a stranger\\!*\n\n${u2PartnerInfo}${baseMsg}`, { parse_mode: 'MarkdownV2', reply_markup: chatActiveKeyboard.reply_markup }); } catch (e) { console.error(e); }
    }, 500);
  }
});

// Command: /end
bot.command('end', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return;
  const userId = user.userObject.id; const userData = users.get(userId);
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) return ctx.replyWithMarkdownV2("ℹ️ *You're not currently in a chat\\.*\n\nUse /find to start a new conversation\\.", removeKeyboard);
  const partnerId = sessions.get(userId); const sessionId = [userId, partnerId].sort().join('-');
  console.log(`Session ended by user ${userId}. Session: ${sessionId}`);
  await cleanupSession(userId, partnerId, sessionId, 'ended');
});

// Command: /cancelsearch
bot.command('cancelsearch', cancelSearch); // Already async, calls ensureUserInitialized

// Consolidated Handler for Gender and Interested In input
bot.hears(['Male', 'Female', 'Both'], async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return;
  const userId = user.userObject.id; const userData = users.get(userId); const messageText = ctx.message.text;

  if (userData && userData.state === 'onboarding') {
    let changed = false;
    if ((userData.onboardingStep === 'gender' || userData.onboardingStep === 'update_gender') && (messageText === 'Male' || messageText === 'Female')) {
      userData.gender = messageText;
      if (userData.onboardingStep === 'gender') {
        userData.onboardingStep = 'age'; console.log(`User ${userId} selected gender: ${userData.gender}, moving to age step.`); users.set(userId, userData); changed = true;
        if (changed) await saveUserData(); askForAge(ctx);
      } else {
        userData.state = 'idle'; userData.onboardingStep = 'completed'; users.set(userId, userData); changed = true;
        console.log(`User ${userId} updated gender to: ${userData.gender}.`); if (changed) await saveUserData();
        await ctx.replyWithMarkdownV2("✅ Your gender has been updated\\.", Markup.removeKeyboard());
      }
    } else if (userData.onboardingStep === 'interested_in' && ['Male', 'Female', 'Both'].includes(messageText)) {
      userData.interestedIn = messageText; userData.onboardingStep = 'location'; users.set(userId, userData); changed = true;
      console.log(`User ${userId} selected interestedIn: ${userData.interestedIn}, moving to location step.`);
      if (changed) await saveUserData(); askForLocation(ctx);
    } else if (userData.onboardingStep === 'update_interested_in' && ['Male', 'Female', 'Both'].includes(messageText)) {
      userData.interestedIn = messageText; userData.state = 'idle'; userData.onboardingStep = 'completed'; users.set(userId, userData); changed = true;
      console.log(`User ${userId} updated interestedIn to: ${userData.interestedIn}.`); if (changed) await saveUserData();
      await ctx.replyWithMarkdownV2("✅ Your 'interested in' preference has been updated\\.", Markup.removeKeyboard());
    } else {
      if (userData.onboardingStep === 'gender' || userData.onboardingStep === 'update_gender') { await ctx.replyWithMarkdownV2("Invalid selection for gender. Please choose 'Male' or 'Female'."); askForGender(ctx); }
      else if (userData.onboardingStep === 'interested_in' || userData.onboardingStep === 'update_interested_in') { await ctx.replyWithMarkdownV2("Invalid selection for interest. Please choose 'Male', 'Female', or 'Both'."); askForInterestedIn(ctx); }
    }
    if (changed) return;
  }
});

// Update Commands (/updategender, /updateage, /updatelocation) - Assumed correct from previous steps, ensure async and saveUserData calls
bot.command('updategender', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (userData.state === 'chatting') return ctx.replyWithMarkdownV2("❌ You cannot update your profile while in an active chat\\. Please use /end first\\.");
  if (userData.state === 'waiting') return ctx.replyWithMarkdownV2("❌ You cannot update your profile while searching for a partner\\. Please cancel the search first\\.");
  userData.state = 'onboarding'; userData.onboardingStep = 'update_gender'; users.set(userId, userData); await saveUserData(); askForGender(ctx);
});
bot.command('updateage', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (userData.state === 'chatting') return ctx.replyWithMarkdownV2("❌ You cannot update your profile while in an active chat\\. Please use /end first\\.");
  if (userData.state === 'waiting') return ctx.replyWithMarkdownV2("❌ You cannot update your profile while searching for a partner\\. Please cancel the search first\\.");
  userData.state = 'onboarding'; userData.onboardingStep = 'update_age'; users.set(userId, userData); await saveUserData(); askForAge(ctx);
});
bot.command('updatelocation', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (userData.state === 'chatting') return ctx.replyWithMarkdownV2("❌ You cannot update your profile while in an active chat\\. Please use /end first\\.");
  if (userData.state === 'waiting') return ctx.replyWithMarkdownV2("❌ You cannot update your profile while searching for a partner\\. Please cancel the search first\\.");
  userData.state = 'onboarding'; userData.onboardingStep = 'update_location'; users.set(userId, userData); await saveUserData(); askForLocation(ctx);
});

bot.command('updateinterestedin', async (ctx) => {
  const user = await ensureUserInitialized(ctx);
  if (!user) return;
  const userId = user.userObject.id;
  const userData = users.get(userId);

  if (userData.state === 'chatting') {
    return ctx.replyWithMarkdownV2("❌ You cannot update your preferences while in an active chat\. Please use /end first\.");
  }
  if (userData.state === 'waiting') {
    return ctx.replyWithMarkdownV2("❌ You cannot update your preferences while searching for a partner\. Please cancel the search first\.");
  }

  userData.state = 'onboarding'; // Re-use 'onboarding' state
  userData.onboardingStep = 'update_interested_in'; // Specific step for this update
  users.set(userId, userData);
  await saveUserData(); // Save state change

  askForInterestedIn(ctx); // Re-use the existing prompt function
});


// Location Handler (Onboarding & Update)
bot.on('location', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (userData && userData.state === 'onboarding') {
    if (userData.onboardingStep === 'location') {
      userData.location = { latitude: ctx.message.location.latitude, longitude: ctx.message.location.longitude };
      userData.onboardingStep = 'completed'; userData.state = 'idle'; users.set(userId, userData); await saveUserData();
      console.log(`User ${userId} shared location, initial onboarding complete.`);
      await ctx.replyWithMarkdownV2("✅ Thanks for completing the onboarding\\! You can now use /find to connect with someone\\.", Markup.removeKeyboard());
      sendWelcomeMessage(ctx); return;
    } else if (userData.onboardingStep === 'update_location') {
      userData.location = { latitude: ctx.message.location.latitude, longitude: ctx.message.location.longitude };
      userData.state = 'idle'; userData.onboardingStep = 'completed'; users.set(userId, userData);
      console.log(`User ${userId} updated location.`); await saveUserData();
      await ctx.replyWithMarkdownV2("✅ Your location has been updated\\.", Markup.removeKeyboard()); return;
    }
  }
});

// Report Commands & Logic (Assumed correct from previous steps)
bot.command('report', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (userData.state !== 'chatting' || !sessions.has(userId)) return ctx.replyWithMarkdownV2("You can only report a user you are currently chatting with\\.");
  const partnerId = sessions.get(userId); userData.state = 'reporting_reason'; userData.reportingPartnerId = partnerId;
  users.set(userId, userData); await saveUserData();
  await ctx.replyWithMarkdownV2("You are about to report your current chat partner\\. Please provide a brief reason for your report\\. Send /cancelreport to cancel\\.", Markup.removeKeyboard());
});
bot.command('cancelreport', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (userData.state === 'reporting_reason') {
    userData.state = 'chatting'; delete userData.reportingPartnerId; users.set(userId, userData); await saveUserData();
    await ctx.replyWithMarkdownV2("Report cancelled\\. You are still in the chat\\.", chatActiveKeyboard);
  } else await ctx.replyWithMarkdownV2("You are not currently reporting anyone\\.");
});

// Main Message Handler (Text, Media, etc.)
bot.on(['text', 'photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'document', 'sticker', 'location', 'contact', 'poll', 'dice'], async (ctx) => {
  const user = await ensureUserInitialized(ctx);
  if (!user) return;

  const userId = user.userObject.id;
  const userData = users.get(userId);

  // Reporting Reason Input Handling
  if (userData.state === 'reporting_reason' && ctx.message && ctx.message.text) {
    const reason = ctx.message.text;
    if (reason.toLowerCase() === '/cancelreport') {
      userData.state = 'chatting'; delete userData.reportingPartnerId; users.set(userId, userData); await saveUserData();
      await ctx.replyWithMarkdownV2("Report cancelled\\. You are still in the chat\\.", chatActiveKeyboard); return;
    }
    const reportedId = userData.reportingPartnerId; const reporterId = userId; const reportIdValue = nextReportId++;
    const reportedUserData = users.get(reportedId); const partnerUsername = reportedUserData?.userObject?.username || 'N/A';
    const currentSessionId = [reporterId, reportedId].sort().join('-');
    const newReport = { reporterId, reportedId, partnerUsername, timestamp: new Date(), reason, sessionId: currentSessionId };
    reports.set(reportIdValue, newReport); console.log('New Report:', newReport);
    const adminMessage = `New User Report (#${reportIdValue}):\nReporter: ${reporterId} (${userData.userObject.username || 'N/A'})\nReported: ${reportedId} (@${partnerUsername})\nReason: ${reason}\nSessionID: ${currentSessionId}`;
    for (const adminId of ADMIN_USER_IDS) { try { await bot.telegram.sendMessage(adminId, adminMessage); } catch (e) { console.error(`Failed to send report to admin ${adminId}: `, e); } }
    await ctx.replyWithMarkdownV2("Your report has been submitted\\. Thank you\\. An admin will review it\\. You are still in the chat\\.", chatActiveKeyboard);
    userData.state = 'chatting'; delete userData.reportingPartnerId; users.set(userId, userData); await saveUserData(); return;
  }

  // Onboarding Text Input Handling
  if (userData && userData.state === 'onboarding' && ctx.message && ctx.message.text) {
    const messageText = ctx.message.text;
    if (['Male', 'Female', 'Both'].includes(messageText) && (userData.onboardingStep === 'gender' || userData.onboardingStep === 'update_gender' || userData.onboardingStep === 'interested_in' || userData.onboardingStep === 'update_interested_in')) {
      // Handled by bot.hears(['Male', 'Female', 'Both'])
    } else if (userData.onboardingStep === 'age' || userData.onboardingStep === 'update_age') {
      const ageText = messageText; const age = parseInt(ageText, 10);
      if (!isNaN(age) && age >= 13 && age <= 99) {
        userData.age = age;
        if (userData.onboardingStep === 'age') {
          userData.onboardingStep = 'interested_in'; // CORRECTED
          users.set(userId, userData);
          console.log(`User ${userId} entered age: ${userData.age}, moving to interested_in step for initial onboarding.`);
          await saveUserData();
          askForInterestedIn(ctx); // CORRECTED
        } else {
          userData.state = 'idle'; userData.onboardingStep = 'completed'; users.set(userId, userData);
          console.log(`User ${userId} updated age to: ${userData.age}.`); await saveUserData();
          await ctx.replyWithMarkdownV2("✅ Your age has been updated\\.", Markup.removeKeyboard());
        }
      } else { ctx.replyWithMarkdownV2("Please enter a valid age between 13 and 99\\."); }
      return;
    } else if (userData.onboardingStep === 'gender' || userData.onboardingStep === 'update_gender') {
      await ctx.replyWithMarkdownV2("Please select your gender using the buttons provided\\."); askForGender(ctx); return;
    } else if (userData.onboardingStep === 'interested_in' || userData.onboardingStep === 'update_interested_in') {
      await ctx.replyWithMarkdownV2("Please select your interest using the buttons provided\\."); askForInterestedIn(ctx); return;
    } else if (userData.onboardingStep === 'location' || userData.onboardingStep === 'update_location') {
      await ctx.replyWithMarkdownV2("Please share your location using the button provided\\."); askForLocation(ctx); return;
    }
  }

  // General Onboarding Step Enforcement
  if (userData && userData.state === 'onboarding') {
    if (ctx.message && ctx.message.location && !(userData.onboardingStep === 'location' || userData.onboardingStep === 'update_location')) {
      await ctx.replyWithMarkdownV2("Please complete your current onboarding step first before sending a location\\.");
      if (userData.onboardingStep === 'gender' || userData.onboardingStep === 'update_gender') askForGender(ctx);
      else if (userData.onboardingStep === 'age' || userData.onboardingStep === 'update_age') askForAge(ctx);
      else if (userData.onboardingStep === 'interested_in' || userData.onboardingStep === 'update_interested_in') askForInterestedIn(ctx);
      return;
    }
    if (!ctx.message.text && !ctx.message.location) {
       await ctx.replyWithMarkdownV2("Please complete the current onboarding step using the options provided\\.");
       if (userData.onboardingStep === 'gender' || userData.onboardingStep === 'update_gender') await askForGender(ctx);
       else if (userData.onboardingStep === 'age' || userData.onboardingStep === 'update_age') await askForAge(ctx);
       else if (userData.onboardingStep === 'interested_in' || userData.onboardingStep === 'update_interested_in') await askForInterestedIn(ctx);
       else if (userData.onboardingStep === 'location' || userData.onboardingStep === 'update_location') await askForLocation(ctx);
       else {
            userData.state = 'idle'; userData.onboardingStep = 'completed'; users.set(userId, userData); await saveUserData();
            await ctx.replyWithMarkdownV2("There was an issue with your onboarding step\\. Please try starting over or use an update command if needed\\.");
       }
       return;
    }
  }

  // Message Forwarding & Other Logic
  if (ctx.message && ctx.message.text) {
    const messageText = ctx.message.text;
    if (messageText.startsWith('/')) {
      if (userData && userData.state === 'chatting') return ctx.replyWithMarkdownV2("❌ *Commands cannot be sent to your chat partner\\.*\n\nIf you want to end the chat, use /end");
      return;
    }
    if (['🔗 Share Username', '🔄 End & Find New', '❌ End Chat', '❌ Cancel Search', 'Male', 'Female', 'Both'].includes(messageText)) {
      console.log(`Redundant text caught in main handler: ${messageText} from user ${userId}`); return;
    }
    if (messageText.length > MAX_MESSAGE_LENGTH) return ctx.replyWithMarkdownV2(`❌ *Message too long\\!*\n\nPlease keep messages under ${MAX_MESSAGE_LENGTH} characters\\.`);
    const lowerMessage = messageText.toLowerCase();
    for (const keyword of prohibitedKeywords) {
      if (lowerMessage.includes(keyword)) {
        console.warn(`Blocked message from ${userId} containing: ${keyword}`);
        return ctx.replyWithMarkdownV2("🚫 *Your message was blocked\\.*\n\nPlease keep conversations respectful\\.");
      }
    }
  }
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    if (userData && userData.state === 'waiting') return ctx.replyWithMarkdownV2("⏳ *Please wait while we find you a chat partner\\.*");
    return ctx.replyWithMarkdownV2("ℹ️ *You're not in a chat\\.*\n\nUse /find to start a conversation\\.", removeKeyboard);
  }
  const partnerId = sessions.get(userId);
  const now = Date.now();
  const userTimestamps = messageTimestamps.get(userId) || [];
  const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  if (recentTimestamps.length >= MAX_MESSAGES_IN_WINDOW) return ctx.replyWithMarkdownV2("⚠️ *Slow down\\!*\n\nYou're sending messages too quickly\\.");
  recentTimestamps.push(now); messageTimestamps.set(userId, recentTimestamps);
  try {
    let success = false;
    if (partnerId) { try { await bot.telegram.sendChatAction(partnerId, 'typing'); } catch (actionError) { console.error('Failed to send typing action to partner', partnerId, actionError); } }
    if (ctx.message.text) { await bot.telegram.sendMessage(partnerId, ctx.message.text); success = true; }
    else { success = await forwardMedia(ctx, partnerId); }
    if (success) { const sessionId = [userId, partnerId].sort().join('-'); const details = sessionDetails.get(sessionId); if (details) { details.messageCount++; sessionDetails.set(sessionId, details); } }
  } catch (error) {
    console.error(`Message/media delivery failed from ${userId} to ${partnerId}:`, error);
    const sessionId = [userId, partnerId].sort().join('-');
    await cleanupSession(userId, partnerId, sessionId, 'error');
  }
});

// Inline keyboard handlers (Assumed correct)
bot.action('share_yes', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId); const partnerId = sessions.get(userId);
  if (!userData || userData.state !== 'chatting' || !partnerId) { await ctx.answerCbQuery('This chat is no longer active.'); return ctx.editMessageText('❌ This chat session is no longer active\\.', { parse_mode: 'MarkdownV2' }).catch(console.error); }
  const shareCheck = canShareUsername(userId);
  if (!shareCheck.allowed) {
    let errorMessage;
    if (shareCheck.reason === 'cooldown') errorMessage = `⏰ *Username sharing is not available yet\\.*\n\nPlease wait ${shareCheck.remainingTime} more second${shareCheck.remainingTime === 1 ? '' : 's'}\\.`;
    else if (shareCheck.reason === 'limit_reached') errorMessage = `🚫 *Username sharing limit reached\\.*\n\nYou can only share your username ${MAX_USERNAME_SHARES} times per conversation\\.`;
    else errorMessage = "❌ *Username sharing is not available right now\\.*";
    await ctx.answerCbQuery('Sharing not allowed.'); return ctx.editMessageText(errorMessage, { parse_mode: 'MarkdownV2' }).catch(console.error);
  }
  const username = userData.userObject?.username;
  if (!username) { await ctx.answerCbQuery('No username found.'); return ctx.editMessageText('❌ *You don\'t have a username set\\.*\n\nPlease set a username in your Telegram settings first\\.', { parse_mode: 'MarkdownV2' }).catch(console.error); }
  await ctx.answerCbQuery('Sharing username...'); incrementShareCount(userId); await saveUserData();
  const sessionId = [userId, partnerId].sort().join('-'); const sessionData = sessionDetails.get(sessionId); const shareData = usernameShareData.get(sessionId);
  const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares'; const currentShares = shareData[userKey]; const remainingShares = MAX_USERNAME_SHARES - currentShares;
  const partnerMessage = `🔗 *Your chat partner shared their username:*\n\n@${username}\n\nTap to view their profile\\!`;
  await bot.telegram.sendMessage(partnerId, partnerMessage, { parse_mode: 'MarkdownV2' }).catch(console.error);
  let confirmMessage = `✅ *Username shared successfully\\!*\n\nYour username @${escapeMarkdown(username)} has been sent to your chat partner\\.`;
  if (remainingShares > 0) confirmMessage += `\n\n📊 *Remaining shares:* ${remainingShares}/${MAX_USERNAME_SHARES}`;
  else confirmMessage += `\n\n🚫 *You have reached the maximum sharing limit for this conversation\\.*`;
  await ctx.editMessageText(confirmMessage, { parse_mode: 'MarkdownV2' }).catch(console.error);
});
bot.action('share_no', async (ctx) => {
  const user = await ensureUserInitialized(ctx); if (!user) return; const userId = user.userObject.id; const userData = users.get(userId);
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) { await ctx.answerCbQuery('This chat is no longer active.'); return ctx.deleteMessage().catch(console.error); }
  await ctx.answerCbQuery('Username not shared.'); await ctx.editMessageText('👍 *Your username was not shared\\.*\n\nYou can continue chatting anonymously\\.', { parse_mode: 'MarkdownV2' }).catch(console.error);
});

// Bot Startup and Shutdown
console.log('Starting Anonymous Chat Bot...');
(async () => {
  await loadUserData();
  bot.launch().then(() => { console.log('✅ Bot started successfully!'); console.log('Users can now use /start to begin chatting.'); }).catch((err) => { console.error('❌ Failed to start bot:', err); process.exit(1); });
})();
const shutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  await saveUserData();
  bot.stop(signal);
  console.log('Bot stopped. Data saved.');
  process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
console.log('Bot setup complete. Waiting for launch...');

[end of bot.js]
