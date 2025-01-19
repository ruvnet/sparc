import { useState, useEffect } from 'react';
import { LLMModel, LLMModelConfig } from '../../lib/models';

interface SettingsPanelProps {
  initialConfig?: LLMModelConfig;
  availableModels: LLMModel[];
  onSave: (config: LLMModelConfig) => void;
  className?: string;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  initialConfig,
  availableModels,
  onSave,
  className = '',
}) => {
  const [config, setConfig] = useState<LLMModelConfig>(initialConfig || {});
  const [loading, setLoading] = useState(false);
  const [customHeaders, setCustomHeaders] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
    }
  }, [initialConfig]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!config.apiKey?.trim()) {
      newErrors.apiKey = 'API Key is required';
    }
    if (!config.model) {
      newErrors.model = 'Please select a model';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await onSave({
        ...config,
        headers: customHeaders
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setConfig(initialConfig || {});
    setCustomHeaders({});
    setErrors({});
  };

  return (
    <div className={`p-4 rounded-lg bg-white dark:bg-gray-800 ${className}`}>
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
        Settings
      </h2>
      
      <div className="space-y-4">
        {/* API Key Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            API Key
          </label>
          <input
            type="password"
            value={config.apiKey || ''}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white
              ${errors.apiKey ? 'border-red-500' : ''}`}
          />
          {errors.apiKey && (
            <p className="mt-1 text-sm text-red-500">{errors.apiKey}</p>
          )}
        </div>

        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Model
          </label>
          <select
            value={config.model || ''}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white
              ${errors.model ? 'border-red-500' : ''}`}
          >
            <option value="">Select a model</option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          {errors.model && (
            <p className="mt-1 text-sm text-red-500">{errors.model}</p>
          )}
        </div>

        {/* Temperature Slider */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Temperature: {config.temperature || 0}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={config.temperature || 0}
            onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
            className="mt-1 block w-full"
          />
        </div>

        {/* Custom Headers */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Custom Headers
          </label>
          {Object.entries(customHeaders).map(([key, value], index) => (
            <div key={index} className="flex gap-2 mt-2">
              <input
                placeholder="Header name"
                value={key}
                onChange={(e) => {
                  const newHeaders = { ...customHeaders };
                  delete newHeaders[key];
                  newHeaders[e.target.value] = value;
                  setCustomHeaders(newHeaders);
                }}
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <input
                placeholder="Value"
                value={value}
                onChange={(e) => {
                  setCustomHeaders({
                    ...customHeaders,
                    [key]: e.target.value
                  });
                }}
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <button
                onClick={() => {
                  const newHeaders = { ...customHeaders };
                  delete newHeaders[key];
                  setCustomHeaders(newHeaders);
                }}
                className="px-2 py-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => setCustomHeaders({ ...customHeaders, '': '' })}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            + Add Header
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-2 mt-6">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
