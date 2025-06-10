// moderation_service.js
// Handles user reporting and potentially other moderation tasks.

const fs = require('fs');
const path = require('path');

const reportsPath = path.join(__dirname, 'reports.json');

const prohibitedKeywords = ['spam', 'scam', 'fake', 'offensiveword1', 'offensiveword2']; // Added more examples

function logReport(reporterId, reportedUserId, sessionId, reason) {
  const report = {
    timestamp: new Date().toISOString(),
    reporterId: String(reporterId), // Ensure IDs are strings for consistency
    reportedUserId: String(reportedUserId),
    sessionId,
    reason: reason.substring(0, 1000) // Cap reason length
  };

  let reports = [];
  try {
    if (fs.existsSync(reportsPath)) {
      const jsonData = fs.readFileSync(reportsPath, 'utf-8');
      if (jsonData) {
        const parsed = JSON.parse(jsonData);
        if (Array.isArray(parsed)) {
            reports = parsed;
        } else {
            console.error('Reports file does not contain a valid JSON array. Initializing report list.');
            reports = []; // Initialize if not an array
        }
      }
    }
  } catch (error) {
    console.error('Error reading or parsing reports.json:', error);
    // If file is corrupted or not valid JSON array, decision could be to backup and start fresh.
    // For now, we'll just start with an empty list for this new report.
    reports = [];
  }

  reports.push(report);

  try {
    fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2), 'utf-8');
    console.log('Report logged successfully:', report.timestamp, report.reporterId, 'reported', report.reportedUserId);
  } catch (error) {
    console.error('Error writing reports.json:', error);
  }
}

function checkMessageContent(messageText) {
  if (typeof messageText !== 'string') return { isAllowed: true, blockedKeyword: null };
  const lowerMessage = messageText.toLowerCase();
  for (const keyword of prohibitedKeywords) {
    if (lowerMessage.includes(keyword)) {
      console.warn(`ModerationService: Blocked message content containing: ${keyword}`);
      return { isAllowed: false, blockedKeyword: keyword };
    }
  }
  return { isAllowed: true, blockedKeyword: null };
}

module.exports = {
  logReport,
  checkMessageContent,
  // Exporting keywords array might be useful for other services or for dynamic updates in future
  // prohibitedKeywords
};
