// user_data_service.js
// Manages user data storage, loading, and access.

const fs = require('fs');
const path = require('path');

const userDataPath = path.join(__dirname, 'users_data.json'); // Using the original name, as bot.js.old is not active
let users = new Map();

// Data structures that are part of the bot's state but not persisted with users.json directly.
// These are kept in memory and reset on bot restart.
// They could be moved to their respective services if those services manage their full lifecycle.
// waitingQueue is managed by MatchingService
// sessions, sessionDetails, usernameShareData are managed by ChatService


function loadData() {
  try {
    if (fs.existsSync(userDataPath)) {
      const jsonData = fs.readFileSync(userDataPath, 'utf-8');
      const usersArray = JSON.parse(jsonData); // Expects array of [key, value]
      users = new Map(usersArray.map(([id, data]) => [Number(id), data]));
      console.log('User data loaded successfully from users_data.json.');
    } else {
      console.log('No user data file found (users_data.json). Starting with an empty user set.');
      users = new Map();
    }
  } catch (error) {
    console.error('Failed to load user data (users_data.json):', error);
    users = new Map(); // Start fresh in case of error
  }
}

async function saveData() {
  try {
    const usersArray = Array.from(users.entries());
    // Using null, 2 for pretty printing JSON, remove for more compact storage in production
    const jsonData = JSON.stringify(usersArray, null, 2);
    await fs.promises.writeFile(userDataPath, jsonData, 'utf-8');
    console.log('User data saved successfully to users_data.json.');
  } catch (error) {
    console.error('Failed to save user data (users_data.json):', error);
  }
}

function getUser(userId) {
  return users.get(Number(userId));
}

function getAllUsers() {
  return users; // Consider returning a copy if direct modification is not desired: new Map(users)
}

function updateUser(userId, partialData) {
  const numericUserId = Number(userId);
  const existingData = users.get(numericUserId) || {};
  const updatedUserData = { ...existingData, ...partialData };
  users.set(numericUserId, updatedUserData);
  // Note: saveData() is not called here automatically.
  // It should be called by the orchestrating logic (e.g., in main.js or after a specific user action is completed).
  return updatedUserData; // Return the updated user data
}

function ensureUserInitialized(userId, userObjectFromCtx) {
  const numericUserId = Number(userId);
  if (!users.has(numericUserId)) {
    const newUser = {
      userObject: userObjectFromCtx,
      state: 'idle',
      onboardingState: 'pending_gender',
      gender: null,
      age: null,
      location: null,
      interestedIn: null,
      profileUpdateState: null,
      reputation: 5, // Default reputation
    };
    users.set(numericUserId, newUser);
    console.log(`User ${numericUserId} initialized by UserDataService with default reputation.`);
    return newUser;
  } else {
    const existingUser = users.get(numericUserId);
    // Always update userObject in case username, firstname etc. changed
    existingUser.userObject = userObjectFromCtx;

    // Ensure all fields are present for existing users (backward compatibility during development)
    if (existingUser.state === undefined) existingUser.state = 'idle';
    if (existingUser.onboardingState === undefined) existingUser.onboardingState = 'pending_gender';
    if (existingUser.gender === undefined) existingUser.gender = null;
    if (existingUser.age === undefined) existingUser.age = null;
    if (existingUser.location === undefined) existingUser.location = null;
    if (existingUser.interestedIn === undefined) existingUser.interestedIn = null;
    if (existingUser.profileUpdateState === undefined) existingUser.profileUpdateState = null;
    if (typeof existingUser.reputation === 'undefined') {
      existingUser.reputation = 5; // Add reputation if missing
    }

    users.set(numericUserId, existingUser);
    return existingUser;
  }
}

// Functions to manage other in-memory data structures
// These are simple direct manipulations for now.
// If more complex logic arises, they could be expanded or moved.

function addUserToWaitingQueue(userId) {
    if (!waitingQueue.includes(userId)) {
        waitingQueue.push(userId);
    }
}

function removeUserFromWaitingQueue(userId) {
    const index = waitingQueue.indexOf(userId);
    if (index > -1) {
        waitingQueue.splice(index, 1);
    }
}

function getWaitingQueue() {
    return waitingQueue; // Or a copy: [...waitingQueue]
}


module.exports = {
  // User specific
  loadData,
  saveData,
  getUser,
  getAllUsers, // Provides access to the users Map
  updateUser,
  ensureUserInitialized,

  // Other data structures - exported for use by other services
  // These are directly exported for now. Could be behind functions if needed.
  users, // Exporting the map itself for direct use by services that need to iterate/modify
  // waitingQueue, sessions, sessionDetails, usernameShareData are no longer exported from here
  // They are managed by their respective services.
};
