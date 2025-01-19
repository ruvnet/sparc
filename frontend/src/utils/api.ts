import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const setApiKey = (apiKey: string) => {
  api.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
};
