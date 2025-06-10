const { loadData, saveData } = require('../utils/storage');
const USERS_FILE = 'users.json';

/**
 * Represents a user of the bot.
 * @class User
 * @property {number} id - Telegram User ID (unique).
 * @property {string|null} username - Telegram username.
 * @property {string} firstName - Telegram first name.
 * @property {string} onboardingState - Current state in the onboarding process (e.g., 'pending_gender', 'completed').
 * @property {string|null} updateState - Current state in the profile update process (e.g., 'pending_gender_update').
 * @property {string} chatState - Current chat state ('idle', 'waiting', 'chatting').
 * @property {string|null} currentSessionId - ID of the active chat session, if any.
 * @property {number} reportsMade - Count of reports made by this user.
 * @property {number} reportsReceived - Count of reports received by this user.
 * @property {string|null} gender - User's gender ('male', 'female').
 * @property {number|null} age - User's age.
 * @property {object|null} location - User's location { latitude: number, longitude: number }.
 * @property {string|null} interestedIn - Gender interest for matching ('male', 'female', 'both').
 * @property {number} reputation - User's reputation score.
 * @property {Array<object>} warnings - Array of warning objects received.
 * @property {boolean} isBanned - Whether the user is currently banned.
 * @property {string|null} banUntil - ISO timestamp until which the user is banned.
 * @property {string} createdAt - ISO timestamp of user creation.
 * @property {string} updatedAt - ISO timestamp of last user update.
 */
class User {
  /**
   * Creates an instance of User.
   * @param {object} params - User data parameters.
   * @param {number} params.id - Telegram User ID.
   * @param {string|null} [params.username=null] - Telegram username.
   * @param {string} params.firstName - Telegram first name.
   * @param {string} [params.onboardingState='pending_gender'] - Initial onboarding state.
   * @param {string|null} [params.updateState=null] - Initial update state.
   * @param {string} [params.chatState='idle'] - Initial chat state.
   * @param {string|null} [params.currentSessionId=null] - Initial session ID.
   * @param {number} [params.reportsMade=0] - Initial reports made count.
   * @param {number} [params.reportsReceived=0] - Initial reports received count.
   * @param {string|null} [params.gender=null] - Initial gender.
   * @param {number|null} [params.age=null] - Initial age.
   * @param {object|null} [params.location=null] - Initial location.
   * @param {string|null} [params.interestedIn=null] - Initial interest.
   * @param {number} [params.reputation=5] - Initial reputation.
   * @param {Array<object>} [params.warnings=[]] - Initial warnings array.
   * @param {boolean} [params.isBanned=false] - Initial banned status.
   * @param {string|null} [params.banUntil=null] - Initial ban until timestamp.
   * @param {string} [params.createdAt] - Creation timestamp (defaults to now).
   * @param {string} [params.updatedAt] - Update timestamp (defaults to now).
   */
  constructor({
    id,
    username = null,
    firstName,
    onboardingState = 'pending_gender',
    updateState = null, // New field for tracking updates
    chatState = 'idle', // 'idle', 'waiting', 'chatting'
    currentSessionId = null,
    reportsMade = 0,
    reportsReceived = 0,
    gender = null,
    age = null,
    location = null,
    interestedIn = null,
    reputation = 5,
    warnings = [],
    isBanned = false,
    banUntil = null,
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
  }) {
    this.id = id;
    this.username = username;
    this.firstName = firstName;
    this.onboardingState = onboardingState;
    this.updateState = updateState;
    this.chatState = chatState;
    this.currentSessionId = currentSessionId;
    this.reportsMade = reportsMade;
    this.reportsReceived = reportsReceived;
    this.gender = gender;
    this.age = age;
    this.location = location;
    this.interestedIn = interestedIn;
    this.reputation = reputation;
    this.warnings = warnings;
    this.isBanned = isBanned;
    this.banUntil = banUntil;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /**
   * Creates a new user, saves them to storage, and returns the instance.
   * @param {object} userData - Data for the new user. Must include id and firstName.
   * @returns {User} The created User instance.
   * @throws {Error} If id or firstName is missing from userData.
   */
  static create(userData) {
    if (!userData.id || !userData.firstName) {
      throw new Error('User ID and firstName are required to create a user.');
    }
    const newUser = new User(userData);
    newUser.save();
    return newUser;
  }

  /**
   * Saves the current user instance to storage (users.json).
   * Updates the user if they exist, otherwise adds them.
   */
  save() {
    const users = User.getAllUsers();
    const userIndex = users.findIndex(u => u.id === this.id);
    this.updatedAt = new Date().toISOString();

    // Create a plain object for saving, to avoid saving methods or class instance details
    const userToSave = { ...this };

    if (userIndex > -1) {
      users[userIndex] = userToSave;
    } else {
      users.push(userToSave);
    }
    saveData(USERS_FILE, users);
  }

  /**
   * Finds a user by their ID from storage.
   * @param {number} userId - The Telegram User ID.
   * @returns {User|null} The User instance if found, otherwise null.
   */
  static findById(userId) {
    const users = User.getAllUsers(); // This already returns plain objects from JSON
    const userData = users.find(u => u.id === userId);
    if (userData) {
      return new User(userData); // Re-instantiate to get methods and ensure consistent object shape
    }
    return null;
  }

  /**
   * Retrieves all users from storage.
   * @returns {Array<object>} An array of plain user objects from users.json.
   */
  static getAllUsers() {
    const usersData = loadData(USERS_FILE);
    return usersData || []; // Returns array of plain objects
  }

  /**
   * Updates properties of the user instance and saves it.
   * Only updates properties that are part of the User class and are not 'id' or 'createdAt'.
   * @param {object} data - An object containing user properties to update.
   */
  update(data) {
    Object.keys(data).forEach(key => {
      if (key !== 'id' && key !== 'createdAt' && this.hasOwnProperty(key)) {
        this[key] = data[key];
      }
    });
    this.save(); // Save after updates
  }

  /**
   * Checks if the user has completed the onboarding process.
   * @returns {boolean} True if onboardingState is 'completed', otherwise false.
   */
  isOnboarded() {
    return this.onboardingState === 'completed';
  }
}

module.exports = User;
