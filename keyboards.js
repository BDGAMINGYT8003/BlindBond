// keyboards.js
// Defines and exports all custom keyboards used by the bot.

const { Markup } = require('telegraf');

const genderReplyKeyboard = Markup.keyboard([['Male', 'Female']]).resize().oneTime();

const interestedInKeyboard = Markup.keyboard([
  ['Male', 'Female'],
  ['Both']
]).resize().oneTime();

const requestLocationKeyboard = Markup.keyboard([
  [Markup.button.locationRequest('Share My Location')]
]).resize().oneTime();

const updateProfileKeyboard = Markup.keyboard([
  ['Update Gender', 'Update Age'],
  ['Update Location', 'Update Interest'],
  ['Back to Main Menu']
]).resize().oneTime();

const chatActiveKeyboard = Markup.keyboard([
  ['🔗 Share Username', '🚩 Report User'],
  ['🔄 End & Find New', '❌ End Chat']
]).resize().oneTime();

const searchingKeyboard = Markup.keyboard([
  ['❌ Cancel Search']
]).resize().oneTime();

const shareConfirmKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Yes', 'share_yes'), // Callback data for sharing username
    Markup.button.callback('❌ No', 'share_no')
  ]
]);

const removeKeyboard = Markup.removeKeyboard();

module.exports = {
  genderReplyKeyboard,
  interestedInKeyboard,
  requestLocationKeyboard,
  updateProfileKeyboard,
  chatActiveKeyboard,
  searchingKeyboard,
  shareConfirmKeyboard,
  removeKeyboard,
};
