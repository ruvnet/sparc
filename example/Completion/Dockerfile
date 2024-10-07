# Use an official Python runtime as a parent image
FROM python:3.8-slim

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install Poetry
RUN pip install poetry

# Install dependencies
RUN poetry install

# Expose port 5000 for the FastAPI application
EXPOSE 5000

# Run the FastAPI application using Uvicorn
CMD ["poetry", "run", "uvicorn", "agentic_preview.main:app", "--host", "0.0.0.0", "--port", "5000"]
