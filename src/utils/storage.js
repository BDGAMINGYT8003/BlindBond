const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');

/**
 * Loads data from a JSON file in the data directory.
 * @param {string} fileName - The name of the file to load (e.g., 'users.json').
 * @returns {object|Array|null} The parsed JSON data, or null if an error occurs or file doesn't exist.
 */
function loadData(fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) { // Added check for file existence
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading data from ${fileName}:`, error);
    return null;
  }
}

/**
 * Saves data to a JSON file in the data directory.
 * @param {string} fileName - The name of the file to save to (e.g., 'users.json').
 * @param {object|Array} data - The data to save.
 */
function saveData(fileName, data) {
  const filePath = path.join(dataDir, fileName);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing data to ${fileName}:`, error);
    // Consider re-throwing or returning a status for critical saves if needed elsewhere
  }
}

/**
 * Appends a log entry to a JSON array in a file.
 * If the file doesn't exist or isn't a valid JSON array, it will try to create/overwrite it with the new entry.
 * @param {string} fileName - The name of the log file (e.g., 'moderation_log.json').
 * @param {object} logEntry - The log entry to append.
 */
const appendLog = (fileName, logEntry) => {
  const filePath = path.join(dataDir, fileName);
  try {
    let logData = [];
    if (fs.existsSync(filePath)) {
      const currentData = fs.readFileSync(filePath, 'utf8');
      try {
        logData = JSON.parse(currentData);
        if (!Array.isArray(logData)) {
          console.warn(`Log file ${fileName} does not contain a JSON array. Initializing with new log entry.`);
          logData = [];
        }
      } catch (parseError) {
        console.warn(`Error parsing log file ${fileName}, initializing with new log entry. Error: ${parseError}`);
        logData = []; // Initialize if parsing fails
      }
    }
    logData.push(logEntry);
    fs.writeFileSync(filePath, JSON.stringify(logData, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error appending to log ${fileName}:`, error);
  }
};

module.exports = {
  loadData,
  saveData,
  appendLog,
};
