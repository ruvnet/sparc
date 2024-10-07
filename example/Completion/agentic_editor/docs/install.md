# Installation

## Prerequisites

- **Python 3.8+**: Ensure Python is installed on your system.
- **Poetry**: Used for dependency management and packaging.

## Steps

1. **Clone the Repository**

   ```bash
   git clone <repository-url>
   cd your_project_name
   ```

2. **Install Dependencies**

   Use Poetry to install the project dependencies:

   ```bash
   poetry install
   ```

3. **Set Environment Variables**

   Ensure the `OPENAI_API_KEY` is set in your environment:

   ```bash
   export OPENAI_API_KEY='your_openai_api_key'
   ```

4. **Run the Application**

   Start the FastAPI server using Uvicorn:

   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
