const User = require('../models/user');
const { getSessionById } = require('./matchingHandler');
const { appendLog } = require('../utils/storage');
const { REPORT_WARNING_THRESHOLD, REPUTATION_DEFAULT, REPUTATION_DECREMENT_ON_REPORT } = require('../utils/constants');

const MODERATION_LOG_FILE = 'moderation_log.json';

/**
 * Handles the 'Yes, Report' action from the report confirmation inline keyboard.
 * Processes the report, updates user statistics, logs the report, ends the chat,
 * and notifies users involved.
 * @param {object} ctx - Telegraf context object.
 */
const handleReportYes = async (ctx) => {
  await ctx.answerCbQuery('Processing report...');
  const reporterId = ctx.from.id;
  const reporterUser = User.findById(reporterId);

  if (!reporterUser || reporterUser.chatState !== 'chatting' || !reporterUser.currentSessionId) {
    return ctx.editMessageText("Could not process report: You are no longer in an active chat.", { reply_markup: null });
  }

  const session = getSessionById(reporterUser.currentSessionId);
  if (!session) {
    // This case should ideally not happen if currentSessionId is properly managed
    reporterUser.update({ chatState: 'idle', currentSessionId: null });
    return ctx.editMessageText("Could not process report: Chat session not found. Your chat state has been reset.", { reply_markup: null });
  }

  const reportedId = (session.user1Id === reporterId) ? session.user2Id : session.user1Id;
  const reportedUser = User.findById(reportedId);

  if (!reportedUser) {
    // Partner account might have been deleted or some other issue
    return ctx.editMessageText("Could not process report: Partner not found.", { reply_markup: null });
  }

  // Increment counters and update reputation/warnings
  reporterUser.update({ reportsMade: (reporterUser.reportsMade || 0) + 1 });

  const newWarnings = reportedUser.warnings || [];
  newWarnings.push({
    timestamp: new Date().toISOString(),
    reason: "Reported by chat partner.",
    reportedBy: reporterId,
    sessionId: session.sessionId,
  });
  reportedUser.update({
    reportsReceived: (reportedUser.reportsReceived || 0) + 1,
    reputation: (reportedUser.reputation || REPUTATION_DEFAULT) - REPUTATION_DECREMENT_ON_REPORT,
    warnings: newWarnings,
  });

  // Log the report
  appendLog(MODERATION_LOG_FILE, {
    type: 'user_report',
    timestamp: new Date().toISOString(),
    reporterId: reporterId,
    reportedId: reportedId,
    sessionId: session.sessionId,
  });

  await ctx.editMessageText("Your report has been submitted. The chat has ended.", { reply_markup: null });

  // Inform the reported user (optional and carefully worded)
  try {
    await ctx.telegram.sendMessage(reportedId, "This chat has been ended by the system following a report.");
  } catch (error) {
    console.error(`Failed to send 'chat ended by system' message to reported user ${reportedId}:`, error);
  }

  // End the chat session - This needs to be done carefully.
  // We need a context object for handleEndChatCommand.
  // We can either construct a minimal one or adapt handleEndChatCommand.
  // For now, let's assume handleEndChatCommand primarily uses ctx.from.id and can be called with a modified ctx.
  // Or, more cleanly, extract the core session cleanup logic from handleEndChatCommand. (This has been done with _endChatSessionInternal)

  const { _endChatSessionInternal } = require('./matchingHandler');
  await _endChatSessionInternal(ctx.telegram, reporterId, reportedId, session.sessionId, 'report_ended');
  // The _endChatSessionInternal will handle sending summaries, updating user states, and removing the session.
  // The ctx.editMessageText for the reporter is done above.
  // The notification to the reported user about chat ending due to report should be handled carefully.
  // _endChatSessionInternal sends a generic summary. We've added a specific "ended by system following report" message before calling it.

  // Inform the reported user (This is now done BEFORE calling _endChatSessionInternal for clarity, as summary is generic)
  // try {
  //   await ctx.telegram.sendMessage(reportedId, "This chat has been ended by the system following a report.");
  // } catch (error) {
  //   console.error(`Failed to send 'chat ended by system' message to reported user ${reportedId}:`, error);
  // }
  // The previous direct user state updates and session removal are now handled by _endChatSessionInternal.
  console.log(`Chat session ${session.sessionId} processing for end due to report by ${reporterId} against ${reportedId} delegated to _endChatSessionInternal.`);

  // Check for automatic warning message to reported user
  // Consider making the upper bound for this specific message also a constant if needed elsewhere
  if (reportedUser.warnings.length >= REPORT_WARNING_THRESHOLD && reportedUser.warnings.length < (REPORT_WARNING_THRESHOLD + 2)) {
      try {
          await ctx.telegram.sendMessage(reportedId, "You have received multiple warnings regarding your behavior. Please adhere to community guidelines to avoid further action.");
      } catch (error)          console.error(`Failed to send warning threshold message to ${reportedId}:`, error);
      }
  }
  // Further actions for bans (e.g., if warnings.length >= MAX_WARNINGS_BEFORE_BAN) can be added here or handled by an admin process
};

/**
 * Handles the 'No, Cancel' action from the report confirmation inline keyboard.
 * Cancels the report and informs the user.
 * @param {object} ctx - Telegraf context object.
 */
const handleReportNo = async (ctx) => {
  await ctx.answerCbQuery('Report cancelled.');
  await ctx.editMessageText("Report cancelled. You can continue chatting.", { reply_markup: null });
};

const { getSessionById: getSessionFromMatchingHandler } = require('./matchingHandler'); // Alias to avoid conflict if getSessionById is also defined here

/**
 * Handles the 'Yes, Share Username' action.
 * Shares the user's username with their chat partner.
 * @param {object} ctx - Telegraf context object.
 */
const handleShareUsernameYes = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);
  const username = ctx.from.username; // Username of the user who clicked the button

  if (!user || user.chatState !== 'chatting' || !user.currentSessionId) {
    await ctx.answerCbQuery("Error: Not in an active chat.");
    return ctx.editMessageText("Could not share username: You are no longer in an active chat.");
  }

  if (!username) {
    await ctx.answerCbQuery("No username set.");
    return ctx.editMessageText("You don't have a username set in your Telegram profile. Please set one in Telegram settings and try again.");
  }

  const session = getSessionFromMatchingHandler(user.currentSessionId);
  if (!session) {
    await ctx.answerCbQuery("Error: Session not found.");
    // It's possible the session ended right as they clicked.
    user.update({ chatState: 'idle', currentSessionId: null }); // Clean up user state
    return ctx.editMessageText("Could not share username: Active session not found. Your chat status has been reset.");
  }

  const partnerId = (session.user1Id === userId) ? session.user2Id : session.user1Id;
  const partnerUser = User.findById(partnerId); // Check if partner still exists

  if (!partnerUser) {
    await ctx.answerCbQuery("Error: Partner not found.");
    return ctx.editMessageText("Could not share username: Your chat partner could not be found.");
  }

  try {
    await ctx.telegram.sendMessage(partnerId, `Your chat partner (${user.firstName || 'User'}) has shared their username: @${username}`);
    await ctx.editMessageText(`Your username @${username} has been shared with your partner.`);
    await ctx.answerCbQuery("Username shared!");
  } catch (error) {
    console.error(`Failed to send username from ${userId} to partner ${partnerId}:`, error);
    let errorMessage = "Could not share username with partner. ";
    if (error.code === 403) { // Forbidden: bot was blocked by the user
        errorMessage += "They may have blocked the bot.";
         // Optionally, end the chat here if desired, as communication is one-way now.
         // const { _endChatSessionInternal } = require('./matchingHandler');
         // await _endChatSessionInternal(ctx.telegram, userId, partnerId, user.currentSessionId, 'partner_blocked_bot_on_share');
    } else {
        errorMessage += "An unexpected error occurred.";
    }
    await ctx.editMessageText(errorMessage);
    await ctx.answerCbQuery("Failed to send.");
  }
};

/**
 * Handles the 'No, Don't Share Username' action.
 * Cancels the username sharing process.
 * @param {object} ctx - Telegraf context object.
 */
const handleShareUsernameNo = async (ctx) => {
  await ctx.answerCbQuery("Username not shared.");
  await ctx.editMessageText("Okay, your username was not shared.");
};


module.exports = {
  handleReportYes,
  handleReportNo,
  handleShareUsernameYes,
  handleShareUsernameNo,
};
