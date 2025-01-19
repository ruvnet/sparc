export const formatTimestamp = (timestamp: number | string): string => {
  return new Date(timestamp).toLocaleTimeString();
};

export const formatCode = (code: string, language: string = 'plaintext'): string => {
  return code.trim();
};

export const truncateText = (text: string, maxLength: number = 100): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
};
