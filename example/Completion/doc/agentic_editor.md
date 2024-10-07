# Agentic Editor

The Agentic Editor is a main component of this repository, located in the `agentic_editor/` directory. It is responsible for editing and managing projects.

## Key Components

1. **Main Application File**: `main.py`
   - Contains the core functionality of the Agentic Editor

2. **Database Files**:
   - `projects.db`
   - `aider_projects.db`

3. **Models**:
   - `User`
   - `Project`

4. **Configuration**:
   - `AiderConfig`

## Key Functions

1. **Database Operations**:
   - `init_db()`: Initialize the database
   - `get_db()`: Get a database session

2. **Project Management**:
   - `update_project_user_data(project_name: str, user_id: str, db: Session)`: Update project user data
   - `remove_old_projects(db: Session, age: Optional[timedelta] = None, user_id: Optional[str] = None)`: Remove old projects
   - `cleanup_projects(db: Session)`: Clean up projects

3. **Output Processing**:
   - `stream_aider_output(process)`: Stream output from Aider
   - `process_aider_output(output_lines)`: Process Aider output

4. **Cost Tracking**:
   - `update_project_cost(db: Session, project_name: str, user_id: str, cost: float)`: Update project cost

For more detailed information on the implementation of these components and functions, please refer to the `main.py` file in the `agentic_editor/` directory.
