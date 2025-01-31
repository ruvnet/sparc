from ollama import Ollama
class OllamaProvider:
    def __init__(self):
        self.ollama = ollama.Ollama()

    def get_response(self, prompt):
        return self.ollama.get_response(prompt)

    def default_host(self):
        return "localhost:11434"
