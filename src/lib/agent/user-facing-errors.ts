export function formatUserFacingError(message: string, currentDate: string): string | null {
  if (/is in the past/i.test(message)) {
    return `That requested delivery date is in the past relative to ${currentDate}. Please enter today, tomorrow, a weekday name, a date like 10 May, or a future date in YYYY-MM-DD format.`;
  }

  if (/cannot parse date phrase/i.test(message) || /invalid date/i.test(message)) {
    return `I couldn't understand that delivery date. Please enter today, tomorrow, a weekday name, a date like 10 May, or a future date in YYYY-MM-DD format.`;
  }

  if (/date phrase is empty/i.test(message)) {
    return "Please enter a delivery date before I stage the request.";
  }

  return null;
}
