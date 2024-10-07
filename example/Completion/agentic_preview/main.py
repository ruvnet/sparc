import os
import asyncio
import json
import shutil
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import RedirectResponse, StreamingResponse
import logging
import uuid

app = FastAPI()

# Configurable runtime limit in seconds
RUN_TIME_LIMIT = 200  # Adjust as needed

# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s %(name)s:%(lineno)d %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger(__name__)

deployments = {}  # key: app_name, value: deployment info
cloned_repos = {}  # key: repo_id, value: repo_path

class DeployRequest(BaseModel):
    repo: str
    branch: str
    args: Optional[List[str]] = []
    memory: Optional[int] = 2048  # Memory in MB, default to 2048 MB (2GB)

    class Config:
        json_schema_extra = {
            "example": {
                "repo": "your-username/your-repo",
                "branch": "main",
                "args": ["--build-arg", "ENV=production"],
                "memory": 2048
            }
        }

class CloneRequest(BaseModel):
    repo_url: str

class ExploreRequest(BaseModel):
    repo_id: str
    action: str
    path: Optional[str] = ""
    content: Optional[str] = ""

@app.get("/")
async def redirect_to_docs():
    return RedirectResponse(url="/docs")

async def execute_command(cmd: List[str], cwd: Optional[str] = None):
    """Asynchronously execute a shell command."""
    logger.debug(f"Executing command: {' '.join(cmd)} in directory: {cwd}")
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()

    logger.debug(f"Command stdout: {stdout.decode()}")
    logger.debug(f"Command stderr: {stderr.decode()}")

    if process.returncode != 0:
        error_message = f"Command {' '.join(cmd)} failed with error code {process.returncode}\nstdout:\n{stdout.decode()}\nstderr:\n{stderr.decode()}"
        logger.error(error_message)
        raise Exception(error_message)

    return stdout.decode()

async def stop_instance(app_name: str):
    """Stops the Fly.io instance after RUN_TIME_LIMIT seconds."""
    await asyncio.sleep(RUN_TIME_LIMIT)
    try:
        logger.info(f"Stopping app {app_name} after {RUN_TIME_LIMIT} seconds.")
        await execute_command(['flyctl', 'apps', 'destroy', app_name, '--yes'])
        logger.info(f"[{datetime.utcnow()}] App {app_name} has been stopped.")
    except Exception as e:
        logger.error(f"Error stopping app {app_name}: {e}")

async def deploy_app(repo: str, branch: str, args: List[str], app_name: str, repo_dir: str, memory: int):
    try:
        # Check if Dockerfile exists; if not, return an error
        dockerfile_path = os.path.join(repo_dir, 'Dockerfile')
        if not os.path.exists(dockerfile_path):
            error_msg = f"Dockerfile not found in {repo_dir}. A Dockerfile is required for deployment."
            logger.error(error_msg)
            raise Exception(error_msg)
        else:
            logger.info("Using existing Dockerfile.")

        # Check if fly.toml exists, generate one if not
        fly_toml_path = os.path.join(repo_dir, 'fly.toml')
        if not os.path.exists(fly_toml_path):
            logger.info("Creating fly.toml configuration.")
            fly_toml_content = f"""
app = "{app_name}"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"

[vm]
  memory_mb = {memory}

[[services]]
  http_checks = []
  internal_port = 8080
  processes = ["app"]
  protocol = "tcp"

  [services.concurrency]
    hard_limit = 25
    soft_limit = 20

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.tcp_checks]]
    grace_period = "1s"
    interval = "15s"
    restart_limit = 0
    timeout = "2s"
"""
            with open(fly_toml_path, 'w') as fly_toml_file:
                fly_toml_file.write(fly_toml_content)
        else:
            logger.info("Using existing fly.toml.")

        # Create the app on Fly.io
        await execute_command(['flyctl', 'apps', 'create', app_name], cwd=repo_dir)

        # Deploy the app using flyctl deploy
        deploy_cmd = ['flyctl', 'deploy', '--remote-only', '--config', 'fly.toml', '--app', app_name]
        deploy_cmd.extend(args)
        await execute_command(deploy_cmd, cwd=repo_dir)

        # Get the app URL using 'flyctl status'
        app_status_json = await execute_command(['flyctl', 'status', '--json', '--app', app_name])
        app_status = json.loads(app_status_json)

        # Extract the hostname
        hostname = app_status.get('Hostname', f"{app_name}.fly.dev")
        logger.info(f"Preview URL: {hostname}")

        # Schedule the instance to stop after RUN_TIME_LIMIT seconds
        asyncio.create_task(stop_instance(app_name))

        # Update deployment status
        deployments[app_name] = {
            "status": "Deployed",
            "preview_url": f"https://{hostname}",
            "message": "Deployment successful.",
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"Error during deployment: {e}")
        # Update deployment status
        deployments[app_name] = {
            "status": "Failed",
            "preview_url": None,
            "message": f"Deployment failed: {str(e)}",
            "timestamp": datetime.utcnow().isoformat()
        }
        # Capture the traceback for debugging
        import traceback
        traceback_str = ''.join(traceback.format_exception(None, e, e.__traceback__))
        logger.error(f"Stack trace: {traceback_str}")
        # Clean up the app on Fly.io
        try:
            await execute_command(['flyctl', 'apps', 'destroy', app_name, '--yes'])
        except Exception as destroy_exc:
            logger.error(f"Error destroying app after failed deployment: {destroy_exc}")
        raise e
    finally:
        # Ensure cleanup happens regardless of success or failure
        if repo_dir and os.path.exists(repo_dir):
            shutil.rmtree(repo_dir, ignore_errors=True)
            logger.info(f"Cleaned up repository directory: {repo_dir}")

@app.post("/deploy")
async def deploy(deploy_request: DeployRequest):
    app_name: Optional[str] = None
    repo_dir: Optional[str] = None  # Initialize repo_dir
    try:
        repo = deploy_request.repo
        branch = deploy_request.branch
        args = deploy_request.args or []
        memory = deploy_request.memory or 2048  # Default to 2048 MB if not specified

        logger.info(f"Deploying repository: {repo}, branch: {branch}, args: {args}, memory: {memory}MB")

        # Clone the repository
        repo_name = repo.split('/')[-1]
        timestamp = int(datetime.utcnow().timestamp())
        unique_id = uuid.uuid4().hex  # Generate a unique identifier
        repo_dir = f"/tmp/{repo_name}-{unique_id}"
        clone_url = f"https://github.com/{repo}.git"

        # Fetch branch information to verify branch existence
        branches_output = await execute_command(['git', 'ls-remote', '--heads', clone_url])
        logger.debug(f"Branches output: {branches_output}")
        if f'refs/heads/{branch}' not in branches_output:
            if 'refs/heads/main' in branches_output:
                logger.warning(f"Branch '{branch}' not found. Defaulting to 'main'.")
                branch = 'main'  # Default to 'main' if specified branch not found and 'main' exists
            elif 'refs/heads/master' in branches_output:
                logger.warning(f"Branch '{branch}' not found. Defaulting to 'master'.")
                branch = 'master'  # Default to 'master' if 'main' is not found but 'master' exists
            else:
                logger.error(f"Branch '{branch}' not found in repository '{repo}'.")
                raise HTTPException(status_code=400, detail=f"Branch '{branch}' not found in repository '{repo}'.")

        # Clone the repository
        await execute_command(['git', 'clone', '-b', branch, clone_url, repo_dir])

        # Check if Dockerfile exists; if not, return an error
        dockerfile_path = os.path.join(repo_dir, 'Dockerfile')
        if not os.path.exists(dockerfile_path):
            error_msg = f"Dockerfile not found in repository '{repo}'. A Dockerfile is required for deployment."
            logger.error(error_msg)
            # Clean up the cloned repository
            shutil.rmtree(repo_dir, ignore_errors=True)
            logger.info(f"Cleaned up repository directory: {repo_dir}")
            raise HTTPException(status_code=400, detail=error_msg)

        # Generate a unique app name
        app_name = f"preview-{repo_name.lower()}-{branch.lower() if branch else 'default'}-{timestamp}"
        logger.info(f"Generated app name: {app_name}")

        # Start the deployment in the background
        asyncio.create_task(deploy_app(repo, branch, args, app_name, repo_dir, memory))

        # Store the deployment status
        deployments[app_name] = {
            "status": "Deploying",
            "preview_url": None,
            "message": "Deployment started.",
            "timestamp": datetime.utcnow().isoformat()
        }

        return {
            "app_name": app_name,
            "message": "Deployment started.",
            "status_url": f"/status/{app_name}"
        }

    except HTTPException as http_exc:
        logger.error(f"HTTP exception occurred: {http_exc.detail}")
        # Clean up in case of HTTPException
        if repo_dir and os.path.exists(repo_dir):
            shutil.rmtree(repo_dir, ignore_errors=True)
            logger.info(f"Cleaned up repository directory: {repo_dir}")
        raise http_exc
    except Exception as e:
        logger.error(f"Unexpected error occurred: {e}")
        # Clean up in case of general Exception
        if repo_dir and os.path.exists(repo_dir):
            shutil.rmtree(repo_dir, ignore_errors=True)
            logger.info(f"Cleaned up repository directory: {repo_dir}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status/{app_name}")
async def check_status(app_name: str):
    try:
        logger.info(f"Checking status for app: {app_name}")
        if app_name in deployments:
            return deployments[app_name]
        else:
            logger.warning(f"No deployment found for app: {app_name}")
            raise HTTPException(status_code=404, detail=f"No deployment found for app: {app_name}")
    except Exception as e:
        logger.error(f"Error checking app status: {e}")
        raise HTTPException(status_code=500, detail=f"Error checking app status: {str(e)}")

@app.get("/logs/{app_name}")
async def stream_logs(app_name: str):
    if app_name not in deployments:
        logger.warning(f"No deployment found for app: {app_name}")
        raise HTTPException(status_code=404, detail=f"No deployment found for app: {app_name}")

    async def log_streamer():
        try:
            process = await asyncio.create_subprocess_exec(
                'flyctl', 'logs', '--app', app_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                log_entry = line.decode('utf-8').strip()

                # Format the log entry to match the GitHub Copilot LLM API response
                formatted_response = {
                    "choices": [
                        {
                            "delta": {
                                "content": log_entry + "\n"
                            },
                            "finish_reason": None,
                            "index": 0
                        }
                    ]
                }

                # Yield the formatted response as a JSON string
                yield f"data: {json.dumps(formatted_response)}\n\n"
        except Exception as e:
            logger.error(f"Error streaming logs for app {app_name}: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(log_streamer(), media_type="text/event-stream")

@app.get("/apps")
async def list_apps():
    try:
        logger.info("Listing all apps")
        apps_output = await execute_command(['flyctl', 'apps', 'list'])
        return {"apps": apps_output}
    except Exception as e:
        logger.error(f"Error listing apps: {e}")
        raise HTTPException(status_code=500, detail=f"Error listing apps: {str(e)}")

# New endpoints for cloning and exploring repositories
@app.post("/clone")
async def clone_repo(request: CloneRequest):
    repo_id = str(uuid.uuid4())
    temp_dir = f"/tmp/{repo_id}"

    try:
        # Construct the full GitHub repository URL
        clone_url = f"https://github.com/{request.repo_url}.git"

        process = await asyncio.create_subprocess_exec(
            "git", "clone", clone_url, temp_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_message = f"Clone failed: {stderr.decode()}"
            logger.error(error_message)
            raise HTTPException(status_code=400, detail=error_message)

        cloned_repos[repo_id] = temp_dir
        logger.info(f"Repository cloned successfully with ID: {repo_id}")
        return {"repo_id": repo_id, "message": "Repository cloned successfully"}
    except Exception as e:
        logger.error(f"Error cloning repository: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/repos")
async def list_repo_ids():
    return {"repo_ids": list(cloned_repos.keys())}


@app.post("/explore")
async def explore_repo(request: ExploreRequest):
    if request.repo_id not in cloned_repos:
        logger.warning(f"Repository not found for ID: {request.repo_id}")
        raise HTTPException(status_code=404, detail="Repository not found")

    repo_path = cloned_repos[request.repo_id]
    full_path = os.path.join(repo_path, request.path or "")

    if request.action == "explore":
        return await explore_directory(full_path)
    elif request.action == "modify":
        return await modify_file(full_path, request.content)
    elif request.action == "create":
        return await create_file(full_path, request.content)
    elif request.action == "remove":
        return await remove_file(full_path)
    elif request.action == "create_dockerfile":
        return await create_dockerfile(repo_path)
    else:
        logger.error(f"Invalid action: {request.action}")
        raise HTTPException(status_code=400, detail="Invalid action")

async def explore_directory(path):
    try:
        if not os.path.exists(path):
            logger.error(f"Path does not exist: {path}")
            raise HTTPException(status_code=404, detail="Path does not exist")
        if os.path.isfile(path):
            with open(path, 'r') as f:
                content = f.read()
            return {"type": "file", "content": content}
        elif os.path.isdir(path):
            items = os.listdir(path)
            return {"type": "directory", "items": items}
        else:
            logger.error(f"Unknown path type: {path}")
            raise HTTPException(status_code=400, detail="Unknown path type")
    except Exception as e:
        logger.error(f"Error exploring directory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def modify_file(path, content):
    try:
        if not os.path.exists(os.path.dirname(path)):
            os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(content)
        logger.info(f"File modified successfully: {path}")
        return {"message": "File modified successfully"}
    except Exception as e:
        logger.error(f"Error modifying file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def create_file(path, content):
    try:
        if not os.path.exists(os.path.dirname(path)):
            os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(content)
        logger.info(f"File created successfully: {path}")
        return {"message": "File created successfully"}
    except Exception as e:
        logger.error(f"Error creating file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def remove_file(path):
    try:
        if os.path.isfile(path):
            os.remove(path)
            logger.info(f"File removed successfully: {path}")
            return {"message": "File removed successfully"}
        elif os.path.isdir(path):
            shutil.rmtree(path)
            logger.info(f"Directory removed successfully: {path}")
            return {"message": "Directory removed successfully"}
        else:
            logger.error(f"Path does not exist: {path}")
            raise HTTPException(status_code=404, detail="Path does not exist")
    except Exception as e:
        logger.error(f"Error removing file or directory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def create_dockerfile(repo_path):
    try:
        logger.info(f"Generating Dockerfile for repository at: {repo_path}")
        process = await asyncio.create_subprocess_exec(
            "gh", "copilot", "suggest", "-t", "shell",
            "--input", "Create a Dockerfile for the project",
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_message = f"Dockerfile creation failed: {stderr.decode()}"
            logger.error(error_message)
            raise HTTPException(status_code=500, detail=error_message)

        dockerfile_content = stdout.decode()

        dockerfile_path = os.path.join(repo_path, 'Dockerfile')
        with open(dockerfile_path, 'w') as f:
            f.write(dockerfile_content)

        logger.info(f"Dockerfile created successfully at: {dockerfile_path}")
        return {"message": "Dockerfile created successfully", "content": dockerfile_content}
    except Exception as e:
        logger.error(f"Error creating Dockerfile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.on_event("shutdown")
async def cleanup():
    # Clean up cloned repositories
    for repo_id, repo_path in cloned_repos.items():
        shutil.rmtree(repo_path, ignore_errors=True)
        logger.info(f"Cleaned up repository: {repo_id}")

    # Clean up deployments (optional)
    for app_name in deployments.keys():
        try:
            await execute_command(['flyctl', 'apps', 'destroy', app_name, '--yes'])
            logger.info(f"Destroyed app: {app_name}")
        except Exception as e:
            logger.error(f"Error destroying app during cleanup: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
