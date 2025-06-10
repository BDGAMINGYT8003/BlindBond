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
  // Or, more cleanly, extract the core session cleanup logic from handleEndChatCommand.

  // Simplified end chat logic directly here for now, ensure both users are reset
  const { User: MUser, removeSession: MRemoveSession } = require('./matchingHandler'); // Re-import to avoid circular if matchingHandler imports this file

  MUser.findById(reporterId)?.update({ chatState: 'idle', currentSessionId: null });
  MUser.findById(reportedId)?.update({ chatState: 'idle', currentSessionId: null });
  MRemoveSession(session.sessionId);

  console.log(`Chat session ${session.sessionId} ended due to report by ${reporterId} against ${reportedId}`);

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

module.exports = {
  handleReportYes,
  handleReportNo,
};
