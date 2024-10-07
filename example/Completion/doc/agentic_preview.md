# Agentic Preview

The Agentic Preview is another main component of this repository, located in the `agentic_preview/` directory. It is responsible for deploying and previewing projects.

## Key Components

1. **Main Application File**: `main.py`
   - Contains the core functionality of the Agentic Preview

## Key Functions

1. **Command Execution**:
   - `execute_command(cmd: List[str], cwd: Optional[str] = None)`: Execute a command

2. **App Deployment and Management**:
   - `deploy_app(repo: str, branch: str, args: List[str], app_name: str, repo_dir: str, memory: int)`: Deploy an application
   - `stop_instance(app_name: str)`: Stop an instance of an application

3. **File Operations**:
   - `explore_directory(path)`: Explore a directory
   - `modify_file(path, content)`: Modify a file
   - `create_file(path, content)`: Create a new file
   - `remove_file(path)`: Remove a file

4. **Dockerfile Creation**:
   - `create_dockerfile(repo_path)`: Create a Dockerfile

5. **Logging Functionality**:
   - `stream_logs(app_name: str)`: Stream logs for an application

For more detailed information on the implementation of these functions, please refer to the `main.py` file in the `agentic_preview/` directory.
