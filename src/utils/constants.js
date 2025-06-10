const { Markup } = require('telegraf');

// Rate limiting
const RATE_LIMIT_WINDOW = 5000; // 5 seconds
const MAX_MESSAGES_IN_WINDOW = 3;

// Username sharing restrictions
const USERNAME_SHARE_COOLDOWN = 60000; // 1 minute in milliseconds
const MAX_USERNAME_SHARES = 2; // Maximum shares per user per session

// Content filtering
const MAX_MESSAGE_LENGTH = 500;
const prohibitedKeywords = ['spam', 'scam', 'fake'];

// Reply keyboards
const chatActiveKeyboard = Markup.keyboard([
  ['🔗 Share Username'],
  ['🔄 End & Find New', '❌ End Chat']
]).resize(); // Removed .oneTime() to make it persistent during chat

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

module.exports = {
  RATE_LIMIT_WINDOW,
  MAX_MESSAGES_IN_WINDOW,
  USERNAME_SHARE_COOLDOWN,
  MAX_USERNAME_SHARES,
  MAX_MESSAGE_LENGTH,
  prohibitedKeywords,
  chatActiveKeyboard,
  searchingKeyboard,
  shareConfirmKeyboard,
  removeKeyboard,
  // Moderation specific constants
  REPORT_WARNING_THRESHOLD: 3, // Number of warnings to trigger a formal message
  REPUTATION_DEFAULT: 5,
  REPUTATION_DECREMENT_ON_REPORT: 1,
  // Onboarding specific constants
  MIN_AGE: 13,
  MAX_AGE: 99,
  GENDER_OPTIONS: ['Male', 'Female'],
  INTEREST_OPTIONS: ['Male', 'Female', 'Both'],
};
