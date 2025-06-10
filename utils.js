// utils.js
// Contains utility functions used across different modules.

function escapeMarkdown(text) {
  if (typeof text !== 'string') return String(text); // Ensure it's a string, even if null/undefined briefly
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatDuration(milliseconds) {
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
}

function formatPartnerInfo(partnerData, escaper = escapeMarkdown) {
  if (!partnerData) {
    return "Unfortunately, there was an issue retrieving your match's details.";
  }

  const displayGender = partnerData.gender
    ? escaper(partnerData.gender.charAt(0).toUpperCase() + partnerData.gender.slice(1))
    : 'Not specified';
  const displayAge = partnerData.age ? escaper(String(partnerData.age)) : 'Not specified';
  const displayLocation = partnerData.location ? 'Shared' : 'Not shared'; // Location itself is not displayed for privacy

  return `\n*Partner's Profile:*
\\- Gender: ${displayGender}
\\- Age: ${displayAge}
\\- Location: ${displayLocation}`;
}


module.exports = {
  escapeMarkdown,
  formatDuration,
  formatPartnerInfo,
};
