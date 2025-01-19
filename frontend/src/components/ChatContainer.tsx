import React, { useState, useEffect } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import SettingsPanel from './SettingsPanel';
import { api } from '@/utils/api';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, newMessage]);
    setLoading(true);

    try {
      const response = await api.post('/chat', { message: content });
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.data.message,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-none">
        <SettingsPanel />
      </div>
      <div className="flex-grow overflow-hidden">
        <MessageList messages={messages} loading={loading} />
      </div>
      <div className="flex-none p-4">
        <MessageInput onSend={sendMessage} disabled={loading} />
      </div>
    </div>
  );
}
