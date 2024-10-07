import React from 'react';
import { Button } from "@/components/ui/button";
import Header from '@/components/Header';

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-r from-blue-500 to-purple-600">
      <Header />
      <main className="flex-grow flex flex-col items-center justify-center">
        <h1 className="text-4xl font-bold text-white mb-4">Agentic Preview</h1>
        <p className="text-xl text-white mb-8">Welcome to your Agentic Preview app!</p>
        <Button variant="secondary">Click me!</Button>
      </main>
    </div>
  );
};

export default Index;
