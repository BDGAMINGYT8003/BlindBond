/**
 * Escapes MarkdownV2 special characters in a given text.
 * @param {string} text - The text to escape.
 * @returns {string} The escaped text.
 */
const escapeMarkdown = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
};

/**
 * Formats a duration given in milliseconds into a human-readable string.
 * e.g., "1 minute and 30 seconds", "2 hours", "45 seconds".
 * @param {number} milliseconds - The duration in milliseconds.
 * @returns {string} A human-readable string representation of the duration.
 */
const formatDuration = (milliseconds) => {
  if (typeof milliseconds !== 'number' || isNaN(milliseconds) || milliseconds < 0) {
    return 'Invalid duration';
  }
  const totalSeconds = Math.floor(milliseconds / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    if (seconds === 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
};

module.exports = {
  escapeMarkdown,
  formatDuration,
};
