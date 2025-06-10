
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

// User data persistence
const userDataPath = path.join(__dirname, 'users_data.json');
let users = new Map(); // Now global, will be populated by loadUsers

function loadUsers() {
  try {
    if (fs.existsSync(userDataPath)) {
      const data = fs.readFileSync(userDataPath, 'utf8');
      const parsedData = JSON.parse(data);
      // Ensure keys are numbers as Telegraf uses numeric IDs.
      // Map constructor from an array of [key, value] entries.
      users = new Map(parsedData.map(([key, value]) => [Number(key), value]));
      console.log('User data loaded successfully.');
    } else {
      console.log('No user data file found. Starting with an empty user set.');
    }
  } catch (error) {
    console.error('Failed to load user data:', error);
    users = new Map(); // Start with an empty map in case of error
  }
}

async function saveUsers() {
  try {
    const dataToSave = JSON.stringify(Array.from(users.entries()));
    fs.writeFileSync(userDataPath, dataToSave, 'utf8');
    console.log('User data saved successfully.');
  } catch (error) {
    console.error('Failed to save user data:', error);
  }
}

// Bot token - replace with environment variable in production
const BOT_TOKEN = '7947606721:AAGxfrYl1HI86IRkYKbIyhwkmq4cu2Pb-vo';

// Initialize the bot
const bot = new Telegraf(BOT_TOKEN);

// Data structures (users Map is now global and loaded by loadUsers)
const waitingQueue = []; // Array of user IDs waiting for partners
const sessions = new Map(); // userId -> partnerId
const sessionDetails = new Map(); // sessionId -> { startTime, messageCount, user1Id, user2Id }
const usernameShareData = new Map(); // sessionId -> { user1Shares: 0, user2Shares: 0 }

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
  
  // Check if 1 minute has passed since connection
  const timeSinceConnection = Date.now() - sessionData.startTime;
  if (timeSinceConnection < USERNAME_SHARE_COOLDOWN) {
    const remainingTime = Math.ceil((USERNAME_SHARE_COOLDOWN - timeSinceConnection) / 1000);
    return { 
      allowed: false, 
      reason: 'cooldown', 
      remainingTime 
    };
  }
  
  // Check share count
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

// Content filtering
const MAX_MESSAGE_LENGTH = 500;
const prohibitedKeywords = ['spam', 'scam', 'fake'];

// Utility function to escape MarkdownV2 special characters
const escapeMarkdown = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
};

// Format duration helper
const formatDuration = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }
  
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes < 60) {
    if (seconds === 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
};

// Reply keyboards
const chatActiveKeyboard = Markup.keyboard([
  ['🔗 Share Username'],
  ['🔄 End & Find New', '❌ End Chat']
]).resize().oneTime();

const searchingKeyboard = Markup.keyboard([
  ['❌ Cancel Search']
]).resize().oneTime();

const shareConfirmKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Yes', 'share_yes'),
    Markup.button.callback('❌ No', 'share_no')
  ]
]);

const removeKeyboard = Markup.removeKeyboard();

// Onboarding keyboards
const genderReplyKeyboard = Markup.keyboard([['Male', 'Female']]).resize().oneTime();
const requestLocationKeyboard = Markup.keyboard([
  [Markup.button.locationRequest('Share My Location')]
]).resize().oneTime();
const interestedInKeyboard = Markup.keyboard([
  ['Male', 'Female'],
  ['Both']
]).resize().oneTime();

// Profile Update Keyboard
const updateProfileKeyboard = Markup.keyboard([
  ['Update Gender', 'Update Age'],
  ['Update Location', 'Update Interest'],
  ['Back to Main Menu']
]).resize().oneTime();

// Onboarding helper functions
const handleOnboarding = async (ctx) => {
  const userData = users.get(ctx.from.id);
  if (!userData) return; // Should not happen if ensureUserInitialized is called

  switch (userData.onboardingState) {
    case 'pending_gender':
      await ctx.reply("Please select your gender:", { reply_markup: genderReplyKeyboard.reply_markup });
      break;
    case 'pending_age':
      await ctx.reply("Please enter your age (e.g., 25).", { reply_markup: removeKeyboard.reply_markup });
      break;
    case 'pending_location':
      await ctx.reply(
        "Please share your location. This helps in finding relevant matches but will be kept approximate for your privacy.",
        { reply_markup: requestLocationKeyboard.reply_markup }
      );
      break;
    case 'pending_interested_in':
      await ctx.reply(
        "Please select who you are interested in meeting:",
        { reply_markup: interestedInKeyboard.reply_markup }
      );
      break;
    case 'completed':
      // This case is now primarily handled by maybeStartOnboarding after onboarding completion.
      // If handleOnboarding is called directly with 'completed' state, show the main welcome message.
      await ctx.replyWithMarkdownV2(
        `🤖 *Welcome to Anonymous Chat Bot\\!*

Your setup is complete\\.
🔍 Use /find to find a random chat partner
🛑 Use /end to finish your current conversation
📝 Send text, photos, videos, stickers, and any media anonymously

*Stay respectful and enjoy chatting\\!*`,
        { reply_markup: removeKeyboard.reply_markup }
      );
      break;
    default:
      console.error(`Unknown onboarding state: ${userData.onboardingState} for user ${ctx.from.id}`);
      await ctx.reply("An unexpected error occurred during onboarding. Please try /start again.");
      // Reset to a known state if necessary
      userData.onboardingState = 'pending_gender';
      users.set(ctx.from.id, userData);
      break;
  }
};

const maybeStartOnboarding = async (ctx) => {
  const userData = users.get(ctx.from.id); // User should be initialized by now
  if (!userData) {
    console.error("User not found in maybeStartOnboarding, this shouldn't happen.");
    return ctx.reply("An error occurred. Please try again.");
  }

  if (userData.onboardingState !== 'completed') {
    await handleOnboarding(ctx);
  } else {
    // Standard welcome message if onboarding is complete
    await ctx.replyWithMarkdownV2(
      `🤖 *Welcome back to Anonymous Chat Bot\\!*

🔍 Use /find to find a random chat partner
🛑 Use /end to finish your current conversation

*Stay respectful and enjoy chatting\\!*`,
      { reply_markup: removeKeyboard.reply_markup }
    );
  }
};

// Initialize user helper
const ensureUserInitialized = (ctx) => {
  if (!ctx.from) return null;
  
  const userId = ctx.from.id;
  if (!users.has(userId)) {
    users.set(userId, {
      state: 'idle',
      userObject: ctx.from,
      gender: null,
      age: null,
      location: null,
      interestedIn: null,
      onboardingState: 'pending_gender',
      profileUpdateState: null // Initialize new state
    });
    console.log(`User ${userId} (${ctx.from.username || 'no_username'}) initialized`);
  } else {
    // Update user object if changed
    const existingUser = users.get(userId);
    existingUser.userObject = ctx.from;
    // Ensure new fields exist for older users, if not already present
    if (existingUser.gender === undefined) existingUser.gender = null;
    if (existingUser.age === undefined) existingUser.age = null;
    if (existingUser.location === undefined) existingUser.location = null;
    if (existingUser.interestedIn === undefined) existingUser.interestedIn = null;
    if (existingUser.onboardingState === undefined) existingUser.onboardingState = 'pending_gender';
    if (existingUser.profileUpdateState === undefined) existingUser.profileUpdateState = null; // Ensure for existing users
    users.set(userId, existingUser);
  }
  
  return users.get(userId);
};

// Send conversation summary
const sendConversationSummary = async (userId, partnerId, sessionId, reason = 'ended') => {
  if (!sessionDetails.has(sessionId)) return;
  
  const details = sessionDetails.get(sessionId);
  const duration = new Date() - details.startTime;
  const formattedDuration = formatDuration(duration);
  const messageCount = details.messageCount;
  
  let summaryMessage;
  if (reason === 'error') {
    summaryMessage = `🔚 *The conversation has ended due to a connection issue\\.*

⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}
💬 *Total messages exchanged:* ${messageCount}

Use /find to start a new conversation\\.`;
  } else {
    summaryMessage = `🔚 *The conversation has officially concluded\\.*

⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}
💬 *Total messages exchanged:* ${messageCount}

Thanks for using Anonymous Chat Bot\\! Use /find to start a new conversation\\.`;
  }
  
  // Send to both users
  try {
    await bot.telegram.sendMessage(userId, summaryMessage, { 
      parse_mode: 'MarkdownV2',
      reply_markup: removeKeyboard.reply_markup 
    });
  } catch (error) {
    console.error(`Failed to send summary to user ${userId}:`, error);
  }
  
  try {
    await bot.telegram.sendMessage(partnerId, summaryMessage, { 
      parse_mode: 'MarkdownV2',
      reply_markup: removeKeyboard.reply_markup 
    });
  } catch (error) {
    console.error(`Failed to send summary to partner ${partnerId}:`, error);
  }
  
  sessionDetails.delete(sessionId);
};

// Clean up session
const cleanupSession = async (userId, partnerId, sessionId, reason = 'ended') => {
  // Send summary first
  await sendConversationSummary(userId, partnerId, sessionId, reason);
  
  // Clean up session data
  sessions.delete(userId);
  sessions.delete(partnerId);
  usernameShareData.delete(sessionId); // Clean up username share data
  
  // Update user states
  const user1Data = users.get(userId);
  const user2Data = users.get(partnerId);
  
  if (user1Data) {
    user1Data.state = 'idle';
    users.set(userId, user1Data);
  }
  
  if (user2Data) {
    user2Data.state = 'idle';
    users.set(partnerId, user2Data);
  }
  // After users are set to idle, try to match anyone remaining in the queue
  await tryMatchUsers();
};

// Cancel search function
const cancelSearch = async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'waiting') {
    return ctx.replyWithMarkdownV2("ℹ️ *You're not currently searching for a partner\\.*", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // Remove from waiting queue
  const queueIndex = waitingQueue.indexOf(userId);
  if (queueIndex > -1) {
    waitingQueue.splice(queueIndex, 1);
    console.log(`User ${userId} cancelled search and removed from queue`);
  }
  
  // Update user state
  userData.state = 'idle';
  users.set(userId, userData);
  
  // Send confirmation
  await ctx.replyWithMarkdownV2("✅ *Search cancelled\\.*\n\nYou can use /find to search for a partner again\\.", { reply_markup: removeKeyboard.reply_markup });
};

// Matching Logic
const isCompatible = (userA, userB) => {
  if (!userA || !userB) return false;

  const aLikesB = userA.interestedIn === userB.gender || userA.interestedIn === 'both';
  const bLikesA = userB.interestedIn === userA.gender || userB.interestedIn === 'both';

  return aLikesB && bLikesA;
};

// Helper function to format partner information for connection messages
const formatPartnerInfo = (partnerData) => {
  if (!partnerData) {
    return "Unfortunately, there was an issue retrieving your match's details.";
  }

  const displayGender = partnerData.gender
    ? escapeMarkdown(partnerData.gender.charAt(0).toUpperCase() + partnerData.gender.slice(1))
    : 'Not specified';
  const displayAge = partnerData.age ? escapeMarkdown(String(partnerData.age)) : 'Not specified';
  const displayLocation = partnerData.location ? 'Shared' : 'Not shared';

  return `\n*Partner's Profile:*
\\- Gender: ${displayGender}
\\- Age: ${displayAge}
\\- Location: ${displayLocation}`;
};

async function tryMatchUsers() {
  if (waitingQueue.length < 2) {
    return; // Not enough users to match
  }

  console.log(`Attempting to match users. Queue size: ${waitingQueue.length}`);
  let i = 0;
  while (i < waitingQueue.length) {
    let matched = false;
    for (let j = i + 1; j < waitingQueue.length; j++) {
      const userId1 = waitingQueue[i];
      const userId2 = waitingQueue[j];

      const user1Data = users.get(userId1);
      const user2Data = users.get(userId2);

      if (!user1Data || !user2Data) {
        console.error(`User data missing for ${userId1} or ${userId2} during matching. Removing from queue.`);
        // Remove problematic users (or just the one whose data is missing)
        // This is a safeguard; ideally, user data should always be present if they are in the queue.
        if (!user1Data) waitingQueue.splice(i, 1); else if (i < j) waitingQueue.splice(j, 1); else waitingQueue.splice(i, 1);
        if (!user2Data && waitingQueue.includes(userId2)) { // if user2 was not user1 and still in queue
            const idx = waitingQueue.indexOf(userId2);
            if(idx > -1) waitingQueue.splice(idx, 1);
        }
        i--; // Adjust outer loop index due to removal
        matched = true; // Restart outer loop essentially
        break;
      }

      if (user1Data.onboardingState !== 'completed' || user2Data.onboardingState !== 'completed') {
        continue; // Skip users who haven't completed onboarding (shouldn't be in queue ideally, but as a safeguard)
      }

      if (isCompatible(user1Data, user2Data)) {
        console.log(`Match found: ${userId1} and ${userId2}`);
        // Remove both users from waiting queue
        // Order of removal matters to keep indices correct for splice
        waitingQueue.splice(j, 1); // Remove user j first (higher index)
        waitingQueue.splice(i, 1); // Remove user i

        // Create session
        sessions.set(userId1, userId2);
        sessions.set(userId2, userId1);

        user1Data.state = 'chatting';
        user2Data.state = 'chatting';
        users.set(userId1, user1Data);
        users.set(userId2, user2Data);

        const sessionId = [userId1, userId2].sort().join('-');
        sessionDetails.set(sessionId, {
          startTime: new Date(),
          messageCount: 0,
          user1Id,
          user2Id
        });
        usernameShareData.set(sessionId, { user1Shares: 0, user2Shares: 0 });

        console.log(`Session started: ${sessionId}`);

        // Prepare personalized connection messages
        const partnerInfoForUser1 = formatPartnerInfo(user2Data);
        const partnerInfoForUser2 = formatPartnerInfo(user1Data);

        const baseConnectMessage = `\n\n💬 Start chatting by sending messages, photos, videos, stickers, or any media\\.
🔗 Use the button below to share your username if you want\\.`;

        const connectMessageUser1 = `🎉 *You're now connected with a stranger\\!*${partnerInfoForUser1}${baseConnectMessage}`;
        const connectMessageUser2 = `🎉 *You're now connected with a stranger\\!*${partnerInfoForUser2}${baseConnectMessage}`;

        try {
          await bot.telegram.sendMessage(userId1, connectMessageUser1, { parse_mode: 'MarkdownV2', reply_markup: chatActiveKeyboard.reply_markup });
          await bot.telegram.sendMessage(userId2, connectMessageUser2, { parse_mode: 'MarkdownV2', reply_markup: chatActiveKeyboard.reply_markup });
        } catch (error) {
          console.error('Failed to send connection messages:', error);
        }

        matched = true;
        i--; // Adjust outer loop index because an element was removed before current i
        break; // Break inner loop and restart scan for user i (now potentially a new user if i was removed) or next user
      }
    }
    if (!matched) {
      i++; // Move to the next user in the outer loop only if no match was made for the current user i
    }
  }
}


// Find partner function (extracted for reuse)
const findPartner = async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  
  // Check if already in chat
  if (sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("❌ *You're already in a chat\\!* Use /end to finish your current conversation first\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // Check if already waiting
  if (waitingQueue.includes(userId)) {
    return ctx.replyWithMarkdownV2("⏳ *You're already searching for a partner\\.*\n\nUse the button below to cancel your search\\.", { reply_markup: searchingKeyboard.reply_markup });
  }
  
  // Send search message with cancel option
  await ctx.replyWithMarkdownV2("🔍 *Searching for a chat partner\\.\\.\\.*\n\n⏳ Please wait while we connect you\\.", { reply_markup: searchingKeyboard.reply_markup });
  
  // Add to waiting queue
  userCtx.state = 'waiting';
  users.set(userId, userCtx); // Ensure user data is updated with 'waiting' state
  if (!waitingQueue.includes(userId)) { // Add only if not already there
      waitingQueue.push(userId);
  }
  
  console.log(`User ${userId} (${userCtx.userObject.username || 'no_username'}) entered waiting queue. Queue size: ${waitingQueue.length}`);
  
  // Attempt to match users
  await tryMatchUsers();
};

// End chat function (extracted for reuse)
const endChat = async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("ℹ️ *You're not currently in a chat\\.*\n\nUse /find to start a new conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  const partnerId = sessions.get(userId);
  const sessionId = [userId, partnerId].sort().join('-');
  
  console.log(`Session ended by user ${userId}. Session: ${sessionId}`);
  
  await cleanupSession(userId, partnerId, sessionId, 'ended');
};

// Helper function to forward media content
const forwardMedia = async (ctx, partnerId) => {
  try {
    // Get the message object
    const message = ctx.message;
    
    // Handle different media types
    if (message.photo) {
      await bot.telegram.sendPhoto(partnerId, message.photo[message.photo.length - 1].file_id, {
        caption: message.caption || undefined
      });
    } else if (message.video) {
      await bot.telegram.sendVideo(partnerId, message.video.file_id, {
        caption: message.caption || undefined
      });
    } else if (message.animation) {
      await bot.telegram.sendAnimation(partnerId, message.animation.file_id, {
        caption: message.caption || undefined
      });
    } else if (message.audio) {
      await bot.telegram.sendAudio(partnerId, message.audio.file_id, {
        caption: message.caption || undefined
      });
    } else if (message.voice) {
      await bot.telegram.sendVoice(partnerId, message.voice.file_id);
    } else if (message.video_note) {
      await bot.telegram.sendVideoNote(partnerId, message.video_note.file_id);
    } else if (message.document) {
      await bot.telegram.sendDocument(partnerId, message.document.file_id, {
        caption: message.caption || undefined
      });
    } else if (message.sticker) {
      await bot.telegram.sendSticker(partnerId, message.sticker.file_id);
    } else if (message.location) {
      await bot.telegram.sendLocation(partnerId, message.location.latitude, message.location.longitude);
    } else if (message.contact) {
      await bot.telegram.sendContact(partnerId, message.contact.phone_number, message.contact.first_name, {
        last_name: message.contact.last_name || undefined
      });
    } else if (message.poll) {
      const poll = message.poll;
      await bot.telegram.sendPoll(
        partnerId,
        poll.question,
        poll.options.map(option => option.text),
        {
          is_anonymous: poll.is_anonymous,
          type: poll.type,
          allows_multiple_answers: poll.allows_multiple_answers
        }
      );
    } else if (message.dice) {
      await bot.telegram.sendDice(partnerId, {
        emoji: message.dice.emoji
      });
    }
    
    return true;
  } catch (error) {
    console.error('Failed to forward media:', error);
    return false;
  }
};

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error:`, err);
  ensureUserInitialized(ctx);
});

// Start command
bot.start(async (ctx) => {
  ensureUserInitialized(ctx);
  await maybeStartOnboarding(ctx);
});

// Find chat command (renamed from /new)
bot.command('find', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;

  if (userCtx.onboardingState !== 'completed') {
    return ctx.replyWithMarkdownV2("👋 Please complete the onboarding process first to ensure better matching\\. Use /start to begin or continue onboarding\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  // Existing findPartner logic
  await findPartner(ctx);
});

// End chat command
bot.command('end', endChat);

// Update profile command
bot.command('update_profile', async (ctx) => {
  const userData = ensureUserInitialized(ctx);
  if (!userData) return;

  if (userData.onboardingState !== 'completed') {
    return ctx.replyWithMarkdownV2("Please complete the onboarding process first before updating your profile. Use /start to begin or continue onboarding.", { reply_markup: removeKeyboard.reply_markup });
  }

  userData.state = 'updating_profile'; // General state indicating user is in profile update mode
  userData.profileUpdateState = 'selecting_option'; // Specific state for choosing what to update
  users.set(ctx.from.id, userData);

  await ctx.reply("What would you like to update?", { reply_markup: updateProfileKeyboard.reply_markup });
});

// Handle reply keyboard buttons
bot.hears('🔗 Share Username', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("❌ *You're not currently in a chat\\.*\n\nUse /find to start a conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // Check if username sharing is allowed
  const shareCheck = canShareUsername(userId);
  if (!shareCheck.allowed) {
    let errorMessage;
    
    if (shareCheck.reason === 'cooldown') {
      errorMessage = `⏰ *Username sharing is not available yet\\.*\n\nYou can share your username after being connected for 1 minute\\.\n\n⏳ Please wait ${shareCheck.remainingTime} more second${shareCheck.remainingTime === 1 ? '' : 's'}\\.`;
    } else if (shareCheck.reason === 'limit_reached') {
      errorMessage = `🚫 *Username sharing limit reached\\.*\n\nYou can only share your username ${MAX_USERNAME_SHARES} times per conversation\\.\n\nThis helps maintain user privacy and prevents spam\\.`;
    } else {
      errorMessage = "❌ *Username sharing is not available right now\\.*";
    }
    
    return ctx.replyWithMarkdownV2(errorMessage);
  }
  
  const username = userData.userObject?.username;
  const displayUsername = username ? `@${username}` : 'your username';
  
  // Get current share count for display
  const partnerId = sessions.get(userId);
  const sessionId = [userId, partnerId].sort().join('-');
  const sessionData = sessionDetails.get(sessionId);
  const shareData = usernameShareData.get(sessionId);
  const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares';
  const currentShares = shareData[userKey];
  const remainingShares = MAX_USERNAME_SHARES - currentShares;
  
  const askMessage = `🤔 *Would you like to share your username?*

Your chat partner will be able to see your username ${escapeMarkdown(displayUsername)} and contact you directly on Telegram\\.

📊 *Remaining shares:* ${remainingShares}/${MAX_USERNAME_SHARES}`;
  
  await ctx.replyWithMarkdownV2(askMessage, { reply_markup: shareConfirmKeyboard.reply_markup });
});

bot.hears('🔄 End & Find New', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    return ctx.replyWithMarkdownV2("ℹ️ *You're not currently in a chat\\.*\n\nUse /find to start a new conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  // End current chat first
  await endChat(ctx);
  
  // Small delay to ensure cleanup is complete
  setTimeout(async () => {
    await findPartner(ctx);
  }, 1000);
});

bot.hears('❌ End Chat', endChat);

bot.hears('❌ Cancel Search', cancelSearch);

// Handle Gender Input for Onboarding
// Handles 'Male', 'Female', 'Both' for gender and interestedIn onboarding steps
bot.hears(['Male', 'Female', 'Both'], async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;

  const userId = userCtx.userObject.id;
  const userData = users.get(userId);
  const messageText = ctx.message.text;

  if (userData && userData.onboardingState === 'pending_gender') {
    if (messageText === 'Both') {
      await ctx.reply("Invalid selection for gender. Please choose Male or Female.", { reply_markup: genderReplyKeyboard.reply_markup });
      return;
    }
    userData.gender = messageText.toLowerCase();
    userData.onboardingState = 'pending_age';
    users.set(userId, userData);
    await ctx.reply(`Gender set to: ${messageText}.`, { reply_markup: removeKeyboard.reply_markup });
    await handleOnboarding(ctx);
  } else if (userData && userData.onboardingState === 'pending_interested_in') {
    userData.interestedIn = messageText.toLowerCase();
    userData.onboardingState = 'completed';
    users.set(userId, userData);
    await saveUsers(); // PERSISTENCE
    await ctx.reply(`Interest set to: ${messageText}. Onboarding complete!`, { reply_markup: removeKeyboard.reply_markup });
    await maybeStartOnboarding(ctx);
  } else if (userData && userData.profileUpdateState === 'pending_new_gender') {
    if (messageText === 'Both') {
      await ctx.reply("Invalid selection for gender. Please choose Male or Female.", { reply_markup: genderReplyKeyboard.reply_markup });
      return;
    }
    userData.gender = messageText.toLowerCase();
    users.set(userId, userData);
    await saveUsers(); // PERSISTENCE
    userData.profileUpdateState = 'selecting_option';
    await ctx.reply(`Gender updated to: ${messageText}.`, { reply_markup: updateProfileKeyboard.reply_markup });
  } else if (userData && userData.profileUpdateState === 'pending_new_interest') {
    userData.interestedIn = messageText.toLowerCase();
    users.set(userId, userData);
    await saveUsers(); // PERSISTENCE
    userData.profileUpdateState = 'selecting_option';
    await ctx.reply(`Interest updated to: ${messageText}.`, { reply_markup: updateProfileKeyboard.reply_markup });
  } else {
    // If the message is 'Male', 'Female', or 'Both' but not in a relevant onboarding or update state,
    // it might be a regular chat message. Let it fall through to the main message handler.
    if (userData && userData.state !== 'chatting' && userData.state !== 'updating_profile') {
        // This condition means the user is idle and typed 'Male'/'Female'/'Both'.
        // It will be handled by the generic text handler if not caught by other specific hears.
    }
  }
});

bot.hears('Update Gender', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
    userData.profileUpdateState = 'pending_new_gender';
    users.set(userId, userData);
    await ctx.reply("Please select your new gender:", { reply_markup: genderReplyKeyboard.reply_markup });
  } else if (userData && userData.state !== 'updating_profile') {
     await ctx.reply("Please use the /update_profile command to start updating your profile.", { reply_markup: removeKeyboard.reply_markup });
  }
  // If in 'updating_profile' but not 'selecting_option', means they are in another update flow, so ignore.
});

bot.hears('Update Age', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
    userData.profileUpdateState = 'pending_new_age';
    users.set(userId, userData);
    await ctx.reply("Please enter your new age (e.g., 25).", { reply_markup: removeKeyboard.reply_markup });
  } else if (userData && userData.state !== 'updating_profile') {
     await ctx.reply("Please use the /update_profile command to start updating your profile.", { reply_markup: removeKeyboard.reply_markup });
  }
});

bot.hears('Update Location', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
    userData.profileUpdateState = 'pending_new_location';
    users.set(userId, userData);
    await ctx.reply("Please share your new location.", { reply_markup: requestLocationKeyboard.reply_markup });
  } else if (userData && userData.state !== 'updating_profile') {
     await ctx.reply("Please use the /update_profile command to start updating your profile.", { reply_markup: removeKeyboard.reply_markup });
  }
});

bot.hears('Update Interest', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  if (userData && userData.state === 'updating_profile' && userData.profileUpdateState === 'selecting_option') {
    userData.profileUpdateState = 'pending_new_interest';
    users.set(userId, userData);
    await ctx.reply("Please select your new interest:", { reply_markup: interestedInKeyboard.reply_markup });
  } else if (userData && userData.state !== 'updating_profile') {
     await ctx.reply("Please use the /update_profile command to start updating your profile.", { reply_markup: removeKeyboard.reply_markup });
  }
});

bot.hears('Back to Main Menu', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  if (userData && (userData.state === 'updating_profile' || userData.profileUpdateState)) {
    userData.state = 'idle';
    userData.profileUpdateState = null;
    users.set(userId, userData);
    await ctx.reply("Returning to main menu.", { reply_markup: removeKeyboard.reply_markup });
    await maybeStartOnboarding(ctx); // This will show the main welcome for completed users
  } else {
    // If not in update mode, this button press might be stray, show main menu anyway or ignore.
    await maybeStartOnboarding(ctx);
  }
});


// Handle Location Input for Onboarding
bot.on('location', async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;

  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  if (userData && userData.onboardingState === 'pending_location') {
    userData.location = {
      latitude: ctx.message.location.latitude,
      longitude: ctx.message.location.longitude
    };
    userData.onboardingState = 'pending_interested_in';
    users.set(userId, userData);
    await saveUsers(); // PERSISTENCE
    await ctx.reply("Location received. Thank you!", { reply_markup: removeKeyboard.reply_markup });
    await handleOnboarding(ctx);
  } else if (userData && userData.profileUpdateState === 'pending_new_location') {
    userData.location = {
      latitude: ctx.message.location.latitude,
      longitude: ctx.message.location.longitude
    };
    users.set(userId, userData);
    await saveUsers(); // PERSISTENCE
    userData.profileUpdateState = 'selecting_option';
    await ctx.reply("Location updated successfully!", { reply_markup: updateProfileKeyboard.reply_markup });
  } else {
    // Location shared outside of the specific onboarding or update step.
    if (userData && userData.state !== 'chatting' && userData.state !== 'updating_profile') {
      await ctx.reply("Thanks for sharing your location, but I wasn't expecting it right now.", { reply_markup: removeKeyboard.reply_markup });
    }
    // If in chat, the main message handler will forward it.
    // If in 'updating_profile' but not 'pending_new_location', it's an unexpected location share.
  }
});

// Handle all media and message types
bot.on(['text', 'photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'document', 'sticker', 'location', 'contact', 'poll', 'dice'], async (ctx) => {
  const userCtx = ensureUserInitialized(ctx);
  if (!userCtx) return;
  
  const userId = userCtx.userObject.id;
  const userData = users.get(userId);

  // If a location was handled by the specific 'location' onboarding handler, don't process it again here.
  if (ctx.message.location && userData && userData.onboardingState === 'pending_interested_in') { //
      // This means location was just processed by the specific handler, and state moved to pending_interested_in
      // Avoid treating it as a message to forward or an error.
      return;
  }


  // Handle text messages specifically
  if (ctx.message.text) {
    const messageText = ctx.message.text.trim(); // Trim whitespace

    // Onboarding: Age Input
    if (userData && userData.onboardingState === 'pending_age') {
      const age = parseInt(messageText, 10);
      if (isNaN(age) || age < 13 || age > 99) {
        await ctx.reply("Invalid age. Please enter a number between 13 and 99.");
        return;
      }
      userData.age = age;
      userData.onboardingState = 'pending_location';
      users.set(userId, userData);
      await saveUsers(); // PERSISTENCE
      await ctx.reply(`Age set to: ${age}.`);
      await handleOnboarding(ctx);
      return;
    } else if (userData && userData.profileUpdateState === 'pending_new_age') {
      const age = parseInt(messageText, 10);
      if (isNaN(age) || age < 13 || age > 99) {
        await ctx.reply("Invalid age. Please enter a number between 13 and 99.");
        return;
      }
      userData.age = age;
      users.set(userId, userData);
      await saveUsers(); // PERSISTENCE
      userData.profileUpdateState = 'selecting_option';
      await ctx.reply(`Age updated to: ${age}.`, { reply_markup: updateProfileKeyboard.reply_markup });
      return;
    }
    
    // Block commands from being forwarded
    if (messageText.startsWith('/')) {
      if (userData && userData.state === 'chatting') {
        return ctx.replyWithMarkdownV2("❌ *Commands cannot be sent to your chat partner\\.*\n\nIf you want to end the chat, use /end");
      }
      return; // Let Telegraf handle the command normally
    }
    
    // Block reply keyboard button text from being forwarded
    if (messageText === '🔗 Share Username' || messageText === '🔄 End & Find New' || messageText === '❌ End Chat' || messageText === '❌ Cancel Search') {
      return; // These are handled by the hears handlers above
    }
    
    // Message length check for text
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      return ctx.replyWithMarkdownV2(`❌ *Message too long\\!*\n\nPlease keep messages under ${MAX_MESSAGE_LENGTH} characters\\.`);
    }
    
    // Content filtering for text
    const lowerMessage = messageText.toLowerCase();
    for (const keyword of prohibitedKeywords) {
      if (lowerMessage.includes(keyword)) {
        console.warn(`Blocked message from ${userId} containing: ${keyword}`);
        return ctx.replyWithMarkdownV2("🚫 *Your message was blocked\\.*\n\nPlease keep conversations respectful\\.");
      }
    }
  }
  
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    if (userData && userData.state === 'waiting') {
      return ctx.replyWithMarkdownV2("⏳ *Please wait while we find you a chat partner\\.*");
    }
    return ctx.replyWithMarkdownV2("ℹ️ *You're not in a chat\\.*\n\nUse /find to start a conversation\\.", { reply_markup: removeKeyboard.reply_markup });
  }
  
  const partnerId = sessions.get(userId);
  
  // Rate limiting
  const now = Date.now();
  const userTimestamps = messageTimestamps.get(userId) || [];
  const recentTimestamps = userTimestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (recentTimestamps.length >= MAX_MESSAGES_IN_WINDOW) {
    return ctx.replyWithMarkdownV2("⚠️ *Slow down\\!*\n\nYou're sending messages too quickly\\.");
  }
  
  recentTimestamps.push(now);
  messageTimestamps.set(userId, recentTimestamps);
  
  // Forward message or media
  try {
    // Send 'typing...' action to the recipient before sending the actual message
    await bot.telegram.sendChatAction(partnerId, 'typing');
    
    // Optional: Add a small delay if desired, e.g., await new Promise(resolve => setTimeout(resolve, 300));

    let success = false;
    if (ctx.message.text) {
      await bot.telegram.sendMessage(partnerId, ctx.message.text);
      success = true;
    } else {
      // Forward media (ensure forwardMedia doesn't also send chat actions if it were more complex)
      success = await forwardMedia(ctx, partnerId);
    }
    
    if (success) {
      // Increment message count
      const sessionId = [userId, partnerId].sort().join('-');
      const details = sessionDetails.get(sessionId);
      if (details) {
        details.messageCount++;
        sessionDetails.set(sessionId, details);
      }
    }
    
  } catch (error) {
    console.error(`Message/media delivery failed from ${userId} to ${partnerId}:`, error);
    
    // End session due to delivery failure
    const sessionId = [userId, partnerId].sort().join('-');
    await cleanupSession(userId, partnerId, sessionId, 'error');
  }
});

// Inline keyboard handlers for username sharing confirmation
bot.action('share_yes', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx);
  
  const userData = users.get(userId);
  const partnerId = sessions.get(userId);
  
  if (!userData || userData.state !== 'chatting' || !partnerId) {
    await ctx.answerCbQuery('This chat is no longer active.');
    return ctx.editMessageText('❌ This chat session is no longer active\\.', { parse_mode: 'MarkdownV2' })
      .catch(console.error);
  }
  
  // Double-check sharing restrictions before proceeding
  const shareCheck = canShareUsername(userId);
  if (!shareCheck.allowed) {
    let errorMessage;
    
    if (shareCheck.reason === 'cooldown') {
      errorMessage = `⏰ *Username sharing is not available yet\\.*\n\nPlease wait ${shareCheck.remainingTime} more second${shareCheck.remainingTime === 1 ? '' : 's'}\\.`;
    } else if (shareCheck.reason === 'limit_reached') {
      errorMessage = `🚫 *Username sharing limit reached\\.*\n\nYou can only share your username ${MAX_USERNAME_SHARES} times per conversation\\.`;
    } else {
      errorMessage = "❌ *Username sharing is not available right now\\.*";
    }
    
    await ctx.answerCbQuery('Sharing not allowed.');
    return ctx.editMessageText(errorMessage, { parse_mode: 'MarkdownV2' })
      .catch(console.error);
  }
  
  const username = userData.userObject?.username;
  if (!username) {
    await ctx.answerCbQuery('No username found.');
    return ctx.editMessageText('❌ *You don\'t have a username set\\.*\n\nPlease set a username in your Telegram settings first\\.', { parse_mode: 'MarkdownV2' })
      .catch(console.error);
  }
  
  await ctx.answerCbQuery('Sharing username...');
  
  // Increment share count
  incrementShareCount(userId);
  
  // Get updated share count for display
  const sessionId = [userId, partnerId].sort().join('-');
  const sessionData = sessionDetails.get(sessionId);
  const shareData = usernameShareData.get(sessionId);
  const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares';
  const currentShares = shareData[userKey];
  const remainingShares = MAX_USERNAME_SHARES - currentShares;
  
  // Send username to partner (username in @mention is NOT escaped)
  const partnerMessage = `🔗 *Your chat partner shared their username:*\n\n@${username}\n\nTap to view their profile\\!`;
  
  await bot.telegram.sendMessage(partnerId, partnerMessage, { parse_mode: 'MarkdownV2' })
    .catch(console.error);
  
  // Confirm to sender (username in display text IS escaped)
  let confirmMessage = `✅ *Username shared successfully\\!*\n\nYour username @${escapeMarkdown(username)} has been sent to your chat partner\\.`;
  
  if (remainingShares > 0) {
    confirmMessage += `\n\n📊 *Remaining shares:* ${remainingShares}/${MAX_USERNAME_SHARES}`;
  } else {
    confirmMessage += `\n\n🚫 *You have reached the maximum sharing limit for this conversation\\.*`;
  }
  
  await ctx.editMessageText(confirmMessage, { parse_mode: 'MarkdownV2' })
    .catch(console.error);
});

bot.action('share_no', async (ctx) => {
  const userId = ctx.from.id;
  ensureUserInitialized(ctx);
  
  const userData = users.get(userId);
  if (!userData || userData.state !== 'chatting' || !sessions.has(userId)) {
    await ctx.answerCbQuery('This chat is no longer active.');
    return ctx.deleteMessage().catch(console.error);
  }
  
  await ctx.answerCbQuery('Username not shared.');
  await ctx.editMessageText('👍 *Your username was not shared\\.*\n\nYou can continue chatting anonymously\\.', { parse_mode: 'MarkdownV2' })
    .catch(console.error);
});

// Load users at startup
loadUsers();

// Start the bot
console.log('Starting Anonymous Chat Bot...');

bot.launch()
  .then(() => {
    console.log('✅ Bot started successfully!');
    console.log('Users can now use /start to begin chatting.');
  })
  .catch((err) => {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  });

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  await saveUsers(); // Save users before exiting
  bot.stop(signal);
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

console.log('Bot setup complete. Waiting for launch...');
