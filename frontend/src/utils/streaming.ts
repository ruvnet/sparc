export const createEventSource = (url: string) => {
  const eventSource = new EventSource(url);
  
  return {
    subscribe: (onMessage: (data: any) => void, onError?: (error: any) => void) => {
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (error) {
          onMessage(event.data);
        }
      };

      if (onError) {
        eventSource.onerror = onError;
      }

      return () => {
        eventSource.close();
      };
    }
  };
};
