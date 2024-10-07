# Architecture

## Objective
Define the system architecture and technical design for the Sample FastAPI Application.

## Architectural Style
- **Monolithic Architecture:** Provides a straightforward structure suitable for small to medium-sized applications.

## System Architecture Diagram
![Architecture Diagram](architecture_diagram.png)

## Technology Stack
- **Backend:** FastAPI
- **Database:** In-memory (for simplicity; can be replaced with PostgreSQL or another database as needed)
- **Authentication:** JWT tokens
- **Containerization:** Docker

## Data Models and Schemas

### User Model
- **id**: UUID
- **email**: string
- **hashed_password**: string
- **is_active**: boolean

### Task Model
- **id**: UUID
- **title**: string
- **description**: string
- **is_completed**: boolean
- **user_id**: UUID

## Key Components
- **API Endpoints:** Handling HTTP requests related to users and tasks.
- **Data Storage:** Managing in-memory data persistence for users and tasks.
- **Authentication Module:** Managing user authentication and authorization via JWT.

## Scalability, Security, and Performance
- **Scalability:** Designed for simplicity; can be scaled by integrating a persistent database and deploying with Docker.
- **Security:** Implements JWT-based authentication and secure password storage with hashing.
- **Performance:** Utilizes FastAPI's asynchronous capabilities for efficient request handling.

## Reflection
- **Choice of FastAPI:** Selected for its speed, ease of use, and asynchronous support, making it ideal for building scalable APIs.
- **In-Memory Database:** Chosen for simplicity in the sample project; recommended to use a persistent database for production.
- **Possible Enhancements:** Integrate a database like PostgreSQL, implement more robust authentication mechanisms, and add more comprehensive error handling.
