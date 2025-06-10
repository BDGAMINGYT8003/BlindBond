// matching_service.js
// Handles the logic for matching users based on their preferences.

const UserDataService = require('./user_data_service');
const { chatActiveKeyboard } = require('./keyboards'); // Not used here anymore for sending message
const { formatPartnerInfo } = require('./utils'); // Using from utils

let botInstance; // Still needed for potential direct bot actions if any, though not for sending match messages
let userDataServiceInstance;
let chatServiceInstance; // Will be injected by initialize or a setter
let waitingQueue = [];

function initialize(bot, uds, cs) { // Accept ChatService instance at initialization
  botInstance = bot;
  userDataServiceInstance = uds;
  chatServiceInstance = cs;
}

// setChatService is no longer needed if passed in initialize
// function setChatService(cs) {
//   chatServiceInstance = cs;
// }

function isCompatible(userA, userB) {
  if (!userA || !userB) return false;
  if (!userA.gender || !userA.interestedIn || !userB.gender || !userB.interestedIn) {
      return false;
  }
  const aLikesB = userA.interestedIn === userB.gender || userA.interestedIn === 'both';
  const bLikesA = userB.interestedIn === userA.gender || userB.interestedIn === 'both';
  return aLikesB && bLikesA;
}

// formatPartnerInfo is now in utils.js and imported.

async function tryMatchUsers() {
  if (waitingQueue.length < 2) {
    return false;
  }

  console.log(`MatchingService: Attempting to match users. Current queue size: ${waitingQueue.length}`);
  let i = 0;
  let matchMadeThisCycle = false;

  while (i < waitingQueue.length) {
    let matchedInInnerLoop = false;
    for (let j = i + 1; j < waitingQueue.length; j++) {
      const userId1 = waitingQueue[i];
      const userId2 = waitingQueue[j];

      const user1Data = userDataServiceInstance.getUser(userId1);
      const user2Data = userDataServiceInstance.getUser(userId2);

      if (!user1Data || !user2Data) {
        console.error(`MatchingService: User data missing for ${userId1} or ${userId2}. Removing from queue.`);
        if (!user1Data && waitingQueue[i] === userId1) waitingQueue.splice(i, 1); else if (waitingQueue[j] === userId2) waitingQueue.splice(j, 1);
        // No i-- here as we want to process the current 'i' if it wasn't the one removed, or the new 'i' if it was.
        // The outer loop's structure (while i < waitingQueue.length) handles shrinking.
        // If i was removed, the next iteration of outer loop will check the new item at index i.
        // If j was removed, inner loop continues with new j.
        // This logic can be tricky; simpler might be to restart scan from i=0 if a modification happens.
        // For now, trying this adjustment:
        if(!user1Data) { i--; matchedInInnerLoop = true; break;} // if user1 removed, restart outer loop for this index
        else {matchedInInnerLoop = true; break;} // if user2 removed, restart inner loop for current user1
      }

      if (user1Data.onboardingState !== 'completed' || user2Data.onboardingState !== 'completed') {
        continue;
      }

      if (isCompatible(user1Data, user2Data)) {
        console.log(`MatchingService: Match found: ${userId1} and ${userId2}`);

        waitingQueue.splice(j, 1);
        waitingQueue.splice(i, 1);

        userDataServiceInstance.updateUser(userId1, { state: 'chatting' });
        userDataServiceInstance.updateUser(userId2, { state: 'chatting' });
        await userDataServiceInstance.saveData();

        if (chatServiceInstance) {
          await chatServiceInstance.createSessionAndNotify(userId1, userId2);
        } else {
            console.error("MatchingService: chatServiceInstance not initialized. Cannot create session.");
            // Fallback or error handling if chatService is absolutely critical for matching to be "complete"
        }

        matchMadeThisCycle = true;
        i--; // Adjust outer loop index as queue was modified
        break;
      }
    }
    if (!matchedInInnerLoop) { // only increment i if no match was made (and no break from inner loop)
      i++;
    } else if(matchedInInnerLoop && i < 0) { // Reset i if it became negative due to splice at 0
        i = 0;
    }
  }
  return matchMadeThisCycle; // Return if any match was made in this cycle
}

async function addUserToWaitingQueue(userId) {
  const userData = UserDataService.getUser(userId);
  if (!userData || userData.onboardingState !== 'completed') {
    console.log(`User ${userId} cannot be added to queue: onboarding not complete.`);
    return;
  }
  if (sessions.has(userId)) { // Check if user already in an active session
    console.log(`User ${userId} is already in a session, not adding to queue.`);
    return;
  }

  if (!waitingQueue.includes(userId)) {
    waitingQueue.push(userId);
    UserDataService.updateUser(userId, { state: 'waiting' });
    await UserDataService.saveData();
    console.log(`User ${userId} added to waiting queue. Queue size: ${waitingQueue.length}`);
  } else {
    console.log(`User ${userId} already in waiting queue.`);
    // If user is already in queue, ensure their state is 'waiting'
     if(userData.state !== 'waiting') {
        UserDataService.updateUser(userId, { state: 'waiting' });
        await UserDataService.saveData();
     }
  }
  await tryMatchUsers();
}

async function removeUserFromWaitingQueue(userId, newStatus = 'idle') {
  const index = waitingQueue.indexOf(userId);
  if (index > -1) {
    waitingQueue.splice(index, 1);
    console.log(`User ${userId} removed from waiting queue.`);
  }
  // Only update state if user is currently 'waiting' to avoid overriding other states like 'chatting'
  const currentUserData = UserDataService.getUser(userId);
  if (currentUserData && currentUserData.state === 'waiting') {
    UserDataService.updateUser(userId, { state: newStatus });
    await UserDataService.saveData();
  }
}

module.exports = {
  initialize,
  tryMatchUsers,
  addUserToWaitingQueue,
  removeUserFromWaitingQueue,
  isCompatible,
  // setChatService is removed
};
