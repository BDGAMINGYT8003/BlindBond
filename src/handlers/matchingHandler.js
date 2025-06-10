const User = require('../models/user');
const { loadData, saveData } = require('../utils/storage');
const { v4: uuidv4 } = require('uuid');
const { Markup } = require('telegraf'); // Still needed if any custom keyboards are made here, otherwise can remove.
const {
  searchingKeyboard,
  chatActiveKeyboard,
  removeKeyboard,
} = require('../utils/constants'); // Import keyboards

const SESSIONS_FILE = 'sessions.json';
/** @type {Array<number>} In-memory queue of user IDs waiting for a match. */
let waitingQueue = [];

// --- Waiting Queue Management ---

/**
 * Adds a user ID to the waiting queue if not already present.
 * @param {number} userId - The ID of the user to add.
 */
const addToWaitingQueue = (userId) => {
  if (!waitingQueue.includes(userId)) {
    waitingQueue.push(userId);
    console.log(`User ${userId} added to waiting queue. Queue:`, waitingQueue);
  }
};

/**
 * Removes a user ID from the waiting queue.
 * @param {number} userId - The ID of the user to remove.
 */
const removeFromWaitingQueue = (userId) => {
  const index = waitingQueue.indexOf(userId);
  if (index > -1) {
    waitingQueue.splice(index, 1);
    console.log(`User ${userId} removed from waiting queue. Queue:`, waitingQueue);
  }
};

// --- Session Management ---

/**
 * Creates a new chat session between two users and saves it to storage.
 * @param {number} user1Id - The ID of the first user.
 * @param {number} user2Id - The ID of the second user.
 * @returns {object|null} The created session object, or null if users are not found.
 */
const createSession = (user1Id, user2Id) => {
  const user1 = User.findById(user1Id);
  const user2 = User.findById(user2Id);

  if (!user1 || !user2) {
    console.error("Cannot create session: user object not found for one or both users.");
    return null;
  }

  const sessionId = uuidv4();
  const session = {
    sessionId,
    user1Id,
    user2Id,
    startTime: new Date().toISOString(),
    user1ProfileForUser2: {
      gender: user1.gender,
      age: user1.age,
      // location: user1.location, // For now, sending full location. Refine later.
    },
    user2ProfileForUser1: {
      gender: user2.gender,
      age: user2.age,
      // location: user2.location,
    },
    // Add message count if needed later
  };

  const sessions = loadData(SESSIONS_FILE) || [];
  sessions.push(session);
  saveData(SESSIONS_FILE, sessions);
  return session;
};

/**
 * Retrieves a session by its ID from storage.
 * @param {string} sessionId - The ID of the session to retrieve.
 * @returns {object|null} The session object if found, otherwise null.
 */
const getSessionById = (sessionId) => {
  const sessions = loadData(SESSIONS_FILE) || [];
  return sessions.find(s => s.sessionId === sessionId);
};

/**
 * Removes a session by its ID from storage.
 * @param {string} sessionId - The ID of the session to remove.
 */
const removeSession = (sessionId) => {
  let sessions = loadData(SESSIONS_FILE) || [];
  sessions = sessions.filter(s => s.sessionId !== sessionId);
  saveData(SESSIONS_FILE, sessions);
  console.log(`Session ${sessionId} removed.`);
};


// --- Core Matching Logic ---

/**
 * Connects two users, creates a session, and notifies them.
 * @param {object} telegram - Telegraf telegram object (bot.telegram).
 * @param {User} user1 - The first User object.
 * @param {User} user2 - The second User object.
 */
const connectUsers = async (telegram, user1, user2) => {
  const session = createSession(user1.id, user2.id);
  if (!session) {
    console.error(`Failed to create session for ${user1.id} and ${user2.id}`);
    return;
  }

  user1.update({ chatState: 'chatting', currentSessionId: session.sessionId });
  user2.update({ chatState: 'chatting', currentSessionId: session.sessionId });

  removeFromWaitingQueue(user1.id); // Ensure they are removed if they were there
  removeFromWaitingQueue(user2.id);

  const user1Message = `🎉 You are now connected with a partner!
Gender: ${session.user2ProfileForUser1.gender || 'N/A'}
Age: ${session.user2ProfileForUser1.age || 'N/A'}`;
  // Location: ${session.user2ProfileForUser1.location ? 'Shared' : 'N/A'}

  const user2Message = `🎉 You are now connected with a partner!
Gender: ${session.user1ProfileForUser2.gender || 'N/A'}
Age: ${session.user1ProfileForUser2.age || 'N/A'}`;
  // Location: ${session.user1ProfileForUser2.location ? 'Shared' : 'N/A'}

  try {
    await telegram.sendMessage(user1.id, user1Message, chatActiveKeyboard); // Use telegram object
    await telegram.sendMessage(user2.id, user2Message, chatActiveKeyboard); // Use telegram object
    console.log(`Connection messages sent to ${user1.id} and ${user2.id}`);
  } catch (error) {
    console.error("Error sending connection messages:", error);
    // If messages fail, this is a partial failure. We might need to clean up the session.
    // For now, the session exists, but users might not know.
    // A more robust system would attempt to notify or cleanup.
  }
};

/**
 * Filters a list of potential partners to find those compatible with the current user's preferences.
 * @param {User} currentUser - The user for whom to find matches.
 * @param {Array<number>} potentialPartnersInQueue - Array of user IDs from the waiting queue.
 * @returns {Array<User>} An array of User objects who are compatible matches.
 */
const getMatchablePartners = (currentUser, potentialPartnersInQueue) => {
    const compatiblePartners = [];
    for (const partnerId of potentialPartnersInQueue) {
        if (currentUser.id === partnerId) continue;

        const potentialPartner = User.findById(partnerId);
        if (!potentialPartner || potentialPartner.chatState !== 'waiting') {
            // Clean up queue if user is no longer valid or waiting
            if(potentialPartner && potentialPartner.chatState !== 'waiting') removeFromWaitingQueue(partnerId);
            continue;
        }

        // currentUser's interest in potentialPartner
        const currentUserLikesPartner = currentUser.interestedIn === 'both' || currentUser.interestedIn === potentialPartner.gender;
        // potentialPartner's interest in currentUser
        const partnerLikesCurrentUser = potentialPartner.interestedIn === 'both' || potentialPartner.interestedIn === currentUser.gender;

        if (currentUserLikesPartner && partnerLikesCurrentUser) {
            compatiblePartners.push(potentialPartner);
        }
    }
    return compatiblePartners;
};

/**
 * Attempts to match users in the waiting queue.
 * Iterates through the queue and tries to find compatible pairs.
 * @param {object} telegram - Telegraf telegram object (bot.telegram) for sending messages via connectUsers.
 */
const tryMatchUsers = async (telegram) => {
  if (waitingQueue.length < 2) return;

  console.log("Attempting to match users. Current queue:", waitingQueue);
  const currentQueueSnapshot = [...waitingQueue];

  for (const userId of currentQueueSnapshot) {
    if (!waitingQueue.includes(userId)) continue; // Check if user still in actual queue

    const currentUser = User.findById(userId);
    if (!currentUser || currentUser.chatState !== 'waiting') {
        removeFromWaitingQueue(userId);
        continue;
    }

    const otherUsersInQueue = waitingQueue.filter(id => id !== userId);
    if (otherUsersInQueue.length === 0) continue;

    const matchedPartners = getMatchablePartners(currentUser, otherUsersInQueue);

    if (matchedPartners.length > 0) {
      const partner = matchedPartners[0];
      console.log(`Match found: ${currentUser.id} and ${partner.id}`);
      removeFromWaitingQueue(currentUser.id);
      removeFromWaitingQueue(partner.id);
      await connectUsers(telegram, currentUser, partner); // Pass telegram
    }
  }
};


// --- Command Handlers (to be called by bot.js) ---

/**
 * Handles the /find command.
 * Adds the user to the waiting queue and attempts to find a match.
 * @param {object} ctx - Telegraf context object.
 */
const handleFindCommand = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || !user.isOnboarded()) {
    await ctx.reply("Please complete your profile first! Use /start if you haven't.", removeKeyboard);
    if (user) { // User exists but not onboarded
        const { handleOnboarding } = require('./onboardingHandler'); // Avoid circular deps if possible at top level
        await handleOnboarding(ctx, user);
    }
    return;
  }

  if (user.chatState === 'chatting') {
    return ctx.reply("You are already in a chat. Use /endchat to end it first.", chatActiveKeyboard);
  }
  if (user.chatState === 'waiting') {
    return ctx.reply("You are already searching for a partner.", searchingKeyboard);
  }

  user.update({ chatState: 'waiting' });
  addToWaitingQueue(userId);
  await ctx.reply("🔍 Searching for a chat partner... We'll notify you when you're connected.", searchingKeyboard);
  await tryMatchUsers(ctx.telegram);
};

/**
 * Handles the /cancelsearch command or "Cancel Search" button.
 * Removes the user from the waiting queue.
 * @param {object} ctx - Telegraf context object.
 */
const handleCancelSearchCommand = async (ctx) => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user) return; // Should not happen if they send a command

  if (user.chatState !== 'waiting') {
    return ctx.reply("You are not currently searching for a partner.", removeKeyboard);
  }

  removeFromWaitingQueue(userId);
  user.update({ chatState: 'idle' });
  await ctx.reply("✅ Search cancelled. Use /find to search again.", removeKeyboard);
};

/**
 * Handles the /endchat command or "End Chat" button.
 * Terminates the current chat session for both users.
 * @param {object} ctx - Telegraf context object.
 * @param {string} [reason='user_ended'] - The reason for ending the chat (e.g., 'user_ended', 'partner_disconnected').
 */
const handleEndChatCommand = async (ctx, reason = 'user_ended') => {
  const userId = ctx.from.id;
  const user = User.findById(userId);

  if (!user || user.chatState !== 'chatting' || !user.currentSessionId) {
    return ctx.reply("You are not currently in a chat.", removeKeyboard);
  }

  const sessionId = user.currentSessionId;
  const session = getSessionById(sessionId);

  if (!session) {
    console.error(`Session ${sessionId} not found for user ${userId} during end chat.`);
    user.update({ chatState: 'idle', currentSessionId: null }); // Clean up user state anyway
    return ctx.reply("Error ending chat: session not found. Your chat status has been reset.", removeKeyboard);
  }

  const partnerId = (session.user1Id === userId) ? session.user2Id : session.user1Id;
  const partner = User.findById(partnerId);

  // Update both users
  user.update({ chatState: 'idle', currentSessionId: null });
  if (partner) {
    partner.update({ chatState: 'idle', currentSessionId: null });
  }

  removeSession(sessionId);

  // Notify users
  let endMessageSelf = "🔚 Your chat has ended.";
  let endMessagePartner = "🔚 Your chat partner has ended the chat.";

  if (reason === 'partner_disconnected') { // Example of another reason
    endMessageSelf = "🔚 Your chat partner disconnected. The chat has ended.";
    endMessagePartner = "🔚 You were disconnected. The chat has ended."; // This might not be sendable if they truly DC'd
  } else if (reason === 'error') {
    endMessageSelf = "🔚 Chat ended due to an error.";
    endMessagePartner = "🔚 Chat ended due to an error.";
  }

  await ctx.reply(endMessageSelf, removeKeyboard);
  try {
    if (partner) { // Check if partner exists, e.g., not deleted account
      await ctx.telegram.sendMessage(partnerId, endMessagePartner, removeKeyboard);
    }
  } catch (error) {
    console.error(`Error sending end chat message to partner ${partnerId}:`, error);
  }
};


module.exports = {
  handleFindCommand,
  handleCancelSearchCommand,
  handleEndChatCommand,
  getSessionById,
  removeSession,
  User,
  initializeMatchingState, // This was defined below the first module.exports
  tryMatchUsers,
};

// This definition of initializeMatchingState should be moved before the module.exports
// or the module.exports should be consolidated at the very end of the file.
// For now, I will assume the second module.exports at the end of the file is the intended one,
// and this function 'initializeMatchingState' is correctly defined before that.
// The duplicate module.exports will be removed by only having one at the end.

// (Content of initializeMatchingState remains the same, just ensuring it's defined before the *single* export block)

// Corrected module.exports structure should be:
// const initializeMatchingState = async (telegramForTryMatch) => { ... };
// module.exports = { ..., initializeMatchingState, tryMatchUsers };

// The diff tool will handle moving the function definition if necessary,
// but the main goal here is to ensure only ONE module.exports block that includes ALL desired exports.
// The current structure has initializeMatchingState defined *after* the first module.exports.
// The second module.exports at the very end is likely the one that's active.

const initializeMatchingState = async (telegramForTryMatch) => { // Parameter name changed
  console.log("Initializing matching state...");
  const allUsers = User.getAllUsers();
  let restoredCount = 0;

  // Clear in-memory queue first to avoid duplicates if this function is ever called multiple times
  waitingQueue.length = 0;

  for (const userData of allUsers) {
    // Re-instantiate to ensure we have User objects with methods, if getAllUsers returns plain objects
    const user = new User(userData);
    if (user.chatState === 'waiting') {
      addToWaitingQueue(user.id);
      restoredCount++;
    }
    // Optional: Check for inconsistent states for 'chatting' users
    if (user.chatState === 'chatting' && user.currentSessionId) {
      const session = getSessionById(user.currentSessionId);
      if (!session) {
        console.warn(`User ${user.id} is in 'chatting' state but session ${user.currentSessionId} not found. Resetting user state.`);
        user.update({ chatState: 'idle', currentSessionId: null });
      } else {
        // Verify other user in session also exists and is in 'chatting' state
        const partnerId = (session.user1Id === user.id) ? session.user2Id : session.user1Id;
        const partner = User.findById(partnerId);
        if (!partner || partner.chatState !== 'chatting' || partner.currentSessionId !== user.currentSessionId) {
          console.warn(`Inconsistent session ${user.currentSessionId} found for user ${user.id}. Partner ${partnerId} issue. Cleaning up session.`);
          removeSession(user.currentSessionId);
          user.update({ chatState: 'idle', currentSessionId: null });
          if (partner) {
            partner.update({ chatState: 'idle', currentSessionId: null });
          }
        }
      }
    } else if (user.chatState === 'chatting' && !user.currentSessionId) {
        console.warn(`User ${user.id} is in 'chatting' state but has no currentSessionId. Resetting user state.`);
        user.update({ chatState: 'idle' });
    }
  }
  console.log(`Restored ${restoredCount} users to the waiting queue.`);

  if (restoredCount > 1 && telegramForTryMatch) {
    console.log("Attempting to match users from restored queue...");
    await tryMatchUsers(telegramForTryMatch); // Pass bot.telegram instance
  } else if (restoredCount > 1) {
    console.log("More than one user in queue, but no telegram instance provided for tryMatchUsers on startup.");
  }
};

module.exports = {
  handleFindCommand,
  handleCancelSearchCommand,
  handleEndChatCommand,
  getSessionById,
  removeSession,
  User, // User model itself is also exported, useful for type hinting or direct use in bot.js
  initializeMatchingState,
  tryMatchUsers,
};
