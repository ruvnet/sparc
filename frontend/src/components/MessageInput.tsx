import React, { useState, KeyboardEvent } from 'react';

interface MessageInputProps {
  onSend: (message: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  loading = false,
  disabled = false
}) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim() && !loading && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 flex gap-4 items-end">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Type your message..."
        disabled={loading || disabled}
        className={`
          flex-1 min-h-[50px] max-h-[200px] p-3 
          rounded-lg border border-gray-300
          focus:outline-none focus:ring-2 focus:ring-blue-500
          resize-y
          disabled:bg-gray-100 disabled:cursor-not-allowed
          dark:bg-gray-800 dark:border-gray-700 dark:text-white
          dark:placeholder-gray-400
        `}
      />
      <button
        onClick={handleSend}
        disabled={!message.trim() || loading || disabled}
        className={`
          px-6 py-3 rounded-lg font-medium
          transition-colors duration-200
          ${loading ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'}
          text-white
          disabled:bg-gray-400 disabled:cursor-not-allowed
          dark:disabled:bg-gray-700
        `}
      >
        {loading ? (
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          'Send'
        )}
      </button>
    </div>
  );
};
