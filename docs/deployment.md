# Deployment Guide

## Local Development

1. Install prerequisites:
   - Docker and Docker Compose
   - Node.js 18+
   - Python 3.9+
   - Poetry

2. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. Start the development environment:
   ```bash
   docker-compose up -d
   ```

4. Access the services:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

## Production Deployment (fly.io)

1. Install flyctl:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. Login to fly.io:
   ```bash
   flyctl auth login
   ```

3. Create the application:
   ```bash
   flyctl launch
   ```

4. Set up secrets:
   ```bash
   flyctl secrets set LLM_API_KEY=your_api_key
   # Add other required secrets
   ```

5. Deploy the application:
   ```bash
   flyctl deploy
   ```

## Configuration Reference

### Environment Variables

- `LLM_API_KEY`: API key for the LLM provider
- `LLM_PROVIDER`: LLM provider to use (default: "gemini")
- `NODE_ENV`: Environment mode (development/production)
- `PORT`: Port for the frontend service
- `API_URL`: Backend API URL

### Docker Services

- Frontend: React/Next.js application
- Backend: FastAPI service
- Redis: Session store and caching

### Deployment Regions

The application is configured to deploy to fly.io's automatically selected region. You can modify the region in fly.toml:

```toml
[env]
  PRIMARY_REGION = "iad"
```
