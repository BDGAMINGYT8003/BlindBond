// chat_service.js
// Manages active chat sessions, message forwarding, and chat-related commands.

const UserDataService = require('./user_data_service');
// const MatchingService = require('./matching_service');
const UserDataService = require('./user_data_service');
const ModerationService = require('./moderation_service'); // Already required
const { chatActiveKeyboard, shareConfirmKeyboard, removeKeyboard } = require('./keyboards');
const { escapeMarkdown, formatDuration, formatPartnerInfo } = require('./utils');
// No need for local PROHIBITED_KEYWORDS anymore

// Service-local data stores
const usersPendingReportReason = new Map(); // userId -> { partnerId, sessionId }
const sessions = new Map(); // userId -> partnerId
const sessionDetails = new Map(); // sessionId (user1Id-user2Id) -> { startTime, messageCount, user1Id, user2Id }
const usernameShareData = new Map(); // sessionId -> { user1Shares: 0, user2Shares: 0 }

// Rate limiting & Content moderation constants
const messageTimestamps = new Map(); // userId -> [timestamps]
const RATE_LIMIT_WINDOW = 5000; // ms
const MAX_MESSAGES_IN_WINDOW = 3;
const MAX_MESSAGE_LENGTH = 500; // This can remain or be moved to ModerationService too
// PROHIBITED_KEYWORDS is now in ModerationService
const USERNAME_SHARE_COOLDOWN = 60000; // 1 minute
const MAX_USERNAME_SHARES = 2;

let botInstance;
let matchingServiceInstance;

// --- Internal Helper Functions ---

async function _sendConversationSummary(userId, partnerId, sessionId, reason = 'ended') {
  if (!sessionDetails.has(sessionId)) {
    console.log(`ChatService: No session details found for ${sessionId} to send summary.`);
    return;
  }

  const details = sessionDetails.get(sessionId);
  const durationMs = new Date() - details.startTime;
  const formattedDuration = formatDuration(durationMs); // Use from utils
  const messageCount = details.messageCount;

  let summaryMessage = reason === 'error'
    ? `🔚 *The conversation has ended due to a connection issue\\.*`
    : `🔚 *The conversation has officially concluded\\.*`;

  summaryMessage += `\n\n⏱️ *Duration:* ${escapeMarkdown(formattedDuration)}
💬 *Total messages exchanged:* ${messageCount}

Use /find to start a new conversation\\.`;

  try {
    if (botInstance) {
      await botInstance.telegram.sendMessage(userId, summaryMessage, { parse_mode: 'MarkdownV2', reply_markup: removeKeyboard.reply_markup });
    }
  } catch (e) { console.error(`ChatService: Failed to send summary to user ${userId}:`, e); }
  try {
    if (botInstance) {
      await botInstance.telegram.sendMessage(partnerId, summaryMessage, { parse_mode: 'MarkdownV2', reply_markup: removeKeyboard.reply_markup });
    }
  } catch (e) { console.error(`ChatService: Failed to send summary to partner ${partnerId}:`, e); }
}

async function _forwardMedia(ctx, partnerId) {
    const message = ctx.message;
    if (!botInstance) {
        console.error("ChatService: botInstance not available for forwarding media.");
        return false;
    }
    try {
        if (message.photo) await botInstance.telegram.sendPhoto(partnerId, message.photo[message.photo.length - 1].file_id, { caption: message.caption && escapeMarkdown(message.caption) || undefined });
        else if (message.video) await botInstance.telegram.sendVideo(partnerId, message.video.file_id, { caption: message.caption && escapeMarkdown(message.caption) || undefined });
        else if (message.animation) await botInstance.telegram.sendAnimation(partnerId, message.animation.file_id, { caption: message.caption && escapeMarkdown(message.caption) || undefined });
        else if (message.audio) await botInstance.telegram.sendAudio(partnerId, message.audio.file_id, { caption: message.caption && escapeMarkdown(message.caption) || undefined });
        else if (message.voice) await botInstance.telegram.sendVoice(partnerId, message.voice.file_id);
        else if (message.video_note) await botInstance.telegram.sendVideoNote(partnerId, message.video_note.file_id);
        else if (message.document) await botInstance.telegram.sendDocument(partnerId, message.document.file_id, { caption: message.caption && escapeMarkdown(message.caption) || undefined });
        else if (message.sticker) await botInstance.telegram.sendSticker(partnerId, message.sticker.file_id);
        else if (message.location) await botInstance.telegram.sendLocation(partnerId, message.location.latitude, message.location.longitude);
        else return false;
        return true;
    } catch (error) {
        console.error('ChatService: Failed to forward media:', error);
        return false;
    }
}

function _canShareUsername(userId, sessionId) {
    const sessionData = sessionDetails.get(sessionId);
    if (!sessionData) return { allowed: false, reason: 'Session not found' };

    const timeSinceConnection = Date.now() - sessionData.startTime;
    if (timeSinceConnection < USERNAME_SHARE_COOLDOWN) {
        const remainingTime = Math.ceil((USERNAME_SHARE_COOLDOWN - timeSinceConnection) / 1000);
        return { allowed: false, reason: 'cooldown', remainingTime };
    }

    const shareData = usernameShareData.get(sessionId) || { user1Shares: 0, user2Shares: 0 };
    const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares';
    if (shareData[userKey] >= MAX_USERNAME_SHARES) {
        return { allowed: false, reason: 'limit_reached' };
    }
    return { allowed: true };
}

function _incrementShareCount(userId, sessionId) {
    const sessionData = sessionDetails.get(sessionId);
    if (!sessionData) return;
    const shareData = usernameShareData.get(sessionId) || { user1Shares: 0, user2Shares: 0 };
    const userKey = sessionData.user1Id === userId ? 'user1Shares' : 'user2Shares';
    shareData[userKey]++;
    usernameShareData.set(sessionId, shareData);
}

// --- Exported Functions ---

async function createSessionAndNotify(user1Id, user2Id) {
  const user1Data = UserDataService.getUser(user1Id);
  const user2Data = UserDataService.getUser(user2Id);

  if(!user1Data || !user2Data) {
      console.error("ChatService: Cannot create session, user data missing for one or both users.", user1Id, user2Id);
      // Potentially try to put the other user back in queue if one is missing
      if (user1Data && matchingServiceInstance) await matchingServiceInstance.addUserToWaitingQueue(user1Id);
      if (user2Data && matchingServiceInstance) await matchingServiceInstance.addUserToWaitingQueue(user2Id);
      return;
  }

  sessions.set(user1Id, user2Id);
  sessions.set(user2Id, user1Id);

  const sessionId = [user1Id, user2Id].sort().join('-');
  sessionDetails.set(sessionId, { startTime: new Date(), messageCount: 0, user1Id, user2Id });
  usernameShareData.set(sessionId, { user1Shares: 0, user2Shares: 0 });

  console.log(`ChatService: Session created ${sessionId} between ${user1Id} and ${user2Id}`);

  const partnerInfoForUser1 = formatPartnerInfo(user2Data, escapeMarkdown);
  const partnerInfoForUser2 = formatPartnerInfo(user1Data, escapeMarkdown);
  const baseConnectMessage = `\n\n💬 Start chatting by sending messages, photos, videos, stickers, or any media\\.
🔗 Use the button below to share your username if you want\\.`;
  const connectMessageUser1 = `🎉 *You're now connected with a stranger\\!*${partnerInfoForUser1}${baseConnectMessage}`;
  const connectMessageUser2 = `🎉 *You're now connected with a stranger\\!*${partnerInfoForUser2}${baseConnectMessage}`;

  try {
    if(botInstance){
        await botInstance.telegram.sendMessage(user1Id, connectMessageUser1, { parse_mode: 'MarkdownV2', reply_markup: chatActiveKeyboard.reply_markup });
        await botInstance.telegram.sendMessage(user2Id, connectMessageUser2, { parse_mode: 'MarkdownV2', reply_markup: chatActiveKeyboard.reply_markup });
    } else {
        console.error("ChatService: botInstance not initialized. Cannot send connection messages.");
    }
  } catch (error) {
    console.error('ChatService: Failed to send connection messages:', error);
  }
}

async function cleanupSession(userId, partnerId, reason = 'ended') {
  const sessionId = [userId, partnerId].sort().join('-');
  console.log(`ChatService: Cleaning up session ${sessionId} for reason: ${reason}`);

  await _sendConversationSummary(userId, partnerId, sessionId, reason);

  sessions.delete(userId);
  sessions.delete(partnerId);
  sessionDetails.delete(sessionId);
  usernameShareData.delete(sessionId);

  UserDataService.updateUser(userId, { state: 'idle' });
  UserDataService.updateUser(partnerId, { state: 'idle' });
  await UserDataService.saveData();

  if (matchingServiceInstance) {
    await matchingServiceInstance.tryMatchUsers();
  } else {
    console.error("ChatService: matchingServiceInstance not available in cleanupSession");
  }
}


function initialize(bot, /*userDataServ,*/ matchServ) {
  botInstance = bot;
  matchingServiceInstance = matchServ;

  // Main message handler - MODIFIED FOR REPORTING
  bot.on(['text', 'photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'document', 'sticker', 'location', 'contact', 'poll', 'dice'], async (ctx, next) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    // Handle report reason submission
    if (usersPendingReportReason.has(userId)) {
      if (ctx.message.text) { // Ensure there's text for the reason
        const reportDetails = usersPendingReportReason.get(userId);
        const reason = ctx.message.text.trim();

        ModerationService.logReport(userId, reportDetails.partnerId, reportDetails.sessionId, reason);
        usersPendingReportReason.delete(userId);

        await ctx.reply("Thank you. Your report has been submitted.", chatActiveKeyboard);
        // Decide if chat should end automatically or not. For now, it doesn't.
        // Example: await cleanupSession(userId, reportDetails.partnerId, 'reported_and_ended');
        return; // Report reason processed
      } else {
        // If user sent something other than text as reason (e.g. a photo)
        await ctx.reply("Please provide your report reason as a text message.", removeKeyboard);
        // We could choose to keep them in the reporting state or clear it.
        // For simplicity, let's clear it, they can initiate report again.
        usersPendingReportReason.delete(userId);
        await ctx.reply("Report cancelled. You can continue chatting or start a new report.", chatActiveKeyboard);
        return;
      }
    }

    if (!userData || userData.state !== 'chatting') {
      if (userData && (userData.onboardingState !== 'completed' || userData.profileUpdateState)) {
        return next();
      }
      if (userData && (userData.state === 'idle' || userData.state === 'waiting') && ctx.message.text && !ctx.message.text.startsWith('/')) {
        // Potentially inform user they are not in a chat
      }
      return;
    }

    const partnerId = sessions.get(userId);
    if (!partnerId) {
      await ctx.reply("You are not connected to anyone. Something went wrong.", removeKeyboard);
      UserDataService.updateUser(userId, { state: 'idle' });
      await UserDataService.saveData();
      return;
    }

    const now = Date.now();
    const userMsgTimestamps = messageTimestamps.get(userId) || [];
    const recentUserTimestamps = userMsgTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
    if (recentUserTimestamps.length >= MAX_MESSAGES_IN_WINDOW) {
      await ctx.reply("⚠️ Slow down! You're sending messages too quickly.");
      return;
    }
    recentUserTimestamps.push(now);
    messageTimestamps.set(userId, recentUserTimestamps);

    if (ctx.message.text) {
      const messageText = ctx.message.text;
      // Message Length Check (can stay here or move to ModerationService)
      if (messageText.length > MAX_MESSAGE_LENGTH) {
        await ctx.reply(`❌ Message too long! Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`);
        return;
      }
      // Content Filtering using ModerationService
      const moderationResult = ModerationService.checkMessageContent(messageText);
      if (!moderationResult.isAllowed) {
        await ctx.replyWithMarkdownV2("🚫 *Your message was blocked due to inappropriate content\\.* \n\nPlease keep conversations respectful\\.");
        // Optionally, log this specific block or penalize reputation here in future.
        console.warn(`ChatService: Message from ${userId} blocked by ModerationService for keyword: ${moderationResult.blockedKeyword}`);
        return; // Stop processing this message
      }
    }

    try {
      const action = ctx.message.text ? 'typing' :
                     ctx.message.photo ? 'upload_photo' :
                     ctx.message.video ? 'upload_video' :
                     ctx.message.voice ? 'upload_voice' : 'typing'; // Default or more specific types
      await botInstance.telegram.sendChatAction(partnerId, action);

      let success;
      if (ctx.message.text) {
        await botInstance.telegram.sendMessage(partnerId, ctx.message.text);
        success = true;
      } else {
        success = await _forwardMedia(ctx, partnerId);
      }

      if (success) {
        const sessionId = [userId, partnerId].sort().join('-');
        const details = sessionDetails.get(sessionId);
        if (details) {
          details.messageCount++;
          sessionDetails.set(sessionId, details);
        }
      } else if (!ctx.message.text) {
          await ctx.reply("Sorry, couldn't send that media type or an error occurred.");
      }
    } catch (error) {
      console.error(`ChatService: Message delivery failed from ${userId} to ${partnerId}:`, error);
      await ctx.reply("⚠️ Oh no! Your message could not be delivered. Your partner might have disconnected or blocked the bot.");
      await cleanupSession(userId, partnerId, 'error');
    }
  });

  // Chat command handlers
  bot.hears('🔗 Share Username', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
     if (!userData || userData.state !== 'chatting') {
        return ctx.reply("You can only share your username when you're in a chat.", removeKeyboard);
    }
    const partnerId = sessions.get(userId);
    if (!partnerId) return;
    const sessionId = [userId, partnerId].sort().join('-');

    const shareCheck = _canShareUsername(userId, sessionId);
    if (!shareCheck.allowed) {
        let msg = "❌ Username sharing not available.";
        if (shareCheck.reason === 'cooldown') msg = `⏰ Username sharing available 1 minute after connection. Wait ${shareCheck.remainingTime}s.`;
        if (shareCheck.reason === 'limit_reached') msg = `🚫 Max ${MAX_USERNAME_SHARES} username shares per chat.`;
        return ctx.replyWithMarkdownV2(escapeMarkdown(msg));
    }
    const username = userData.userObject?.username;
    const displayUsername = username ? `@${username}` : 'your username';
    const shareData = usernameShareData.get(sessionId) || { user1Shares: 0, user2Shares: 0 };
    const userKey = sessionDetails.get(sessionId).user1Id === userId ? 'user1Shares' : 'user2Shares';
    const currentShares = shareData[userKey] || 0; // Ensure it's a number
    const remainingShares = MAX_USERNAME_SHARES - currentShares;
    await ctx.replyWithMarkdownV2(`🤔 Share ${escapeMarkdown(displayUsername)} with your partner? (${remainingShares} shares left)`, { reply_markup: shareConfirmKeyboard.reply_markup });
  });

  bot.hears('🔄 End & Find New', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    if (!userData || userData.state !== 'chatting') {
        return ctx.reply("You're not in a chat.", removeKeyboard);
    }
    const partnerId = sessions.get(userId);
    if (partnerId) await cleanupSession(userId, partnerId, 'user_ended_to_find_new');
    else { // Should not happen if state is 'chatting'
        UserDataService.updateUser(userId, {state: 'idle'}); // Ensure state is idle
        await UserDataService.saveData();
    }

    await ctx.reply("Searching for a new partner...", {reply_markup: removeKeyboard.reply_markup });
    if (matchingServiceInstance) {
        await matchingServiceInstance.addUserToWaitingQueue(userId);
    } else {
        console.error("ChatService: matchingServiceInstance not available for End & Find New");
        await ctx.reply("Sorry, an error occurred. Please try /find again later.");
    }
  });

  bot.hears('❌ End Chat', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
     if (!userData || userData.state !== 'chatting') {
        return ctx.reply("You're not in a chat.", removeKeyboard);
    }
    const partnerId = sessions.get(userId);
    if (partnerId) await cleanupSession(userId, partnerId, 'user_ended');
    else {
        UserDataService.updateUser(userId, {state: 'idle'});
        await UserDataService.saveData();
        await ctx.reply("You were not in a chat.", removeKeyboard);
    }
  });

  bot.action('share_yes', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);
    if (!userData || userData.state !== 'chatting') {
      await ctx.answerCbQuery("You're not in a chat anymore.");
      return ctx.editMessageText("❌ This action is no longer valid as the chat has ended.").catch(() => {});
    }
    const partnerId = sessions.get(userId);
    if (!partnerId) return;
    const sessionId = [userId, partnerId].sort().join('-');

    const shareCheck = _canShareUsername(userId, sessionId);
    if (!shareCheck.allowed) {
      await ctx.answerCbQuery("Sharing not allowed.");
      return ctx.editMessageText("❌ Username sharing limit reached or cooldown active.").catch(() => {});
    }
    const username = userData.userObject?.username;
    if (!username) {
      await ctx.answerCbQuery("No username set.");
      return ctx.editMessageText("❌ You don't have a Telegram username set in your profile.").catch(() => {});
    }

    _incrementShareCount(userId, sessionId);
    if (botInstance) {
        await botInstance.telegram.sendMessage(partnerId, `🔗 Your partner shared their username: @${username}`);
    }
    await ctx.answerCbQuery("Username shared!");
    await ctx.editMessageText(`✅ Username @${escapeMarkdown(username)} shared!`).catch(() => {});
  });

  bot.action('share_no', async (ctx) => {
    await ctx.answerCbQuery("Username not shared.");
    await ctx.editMessageText("👍 Your username was not shared.").catch(() => {});
  });

  // Handle /end command
  bot.command('end', async (ctx) => {
    const userId = ctx.from.id;
    const userData = UserDataService.getUser(userId);

    if (userData && userData.state === 'chatting' && sessions.has(userId)) {
        const partnerId = sessions.get(userId);
        await cleanupSession(userId, partnerId, 'ended_by_command');
    } else {
        await ctx.replyWithMarkdownV2("ℹ️ *You're not currently in a chat\\.*", { reply_markup: removeKeyboard.reply_markup });
    }
  });
}

module.exports = {
  initialize,
  createSessionAndNotify,
  cleanupSession,
};
