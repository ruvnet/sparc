To effectively use the aider.chat markdown files for guidance, follow these steps:

## Adding Files to the Chat

The most crucial aspect of using aider effectively is adding the right files to the chat session[1]. Here's how to do it:

1. Add files when launching aider:
   ```
   aider <file1> <file2> ...
   ```

2. Use the in-chat `/add` command to add files during a session[2].

3. Only add files that need to be edited for your specific task[3]. Avoid adding too many irrelevant files, as this can confuse the AI and increase token costs.

## Using In-Chat Commands

Aider provides several useful in-chat commands to enhance your experience[2]:

- `/help`: Ask questions about using aider
- `/add`: Add files to the chat session
- `/drop`: Remove files from the chat session
- `/ls`: List all known files and indicate which are included in the chat session
- `/diff`: Display the diff of changes since the last message
- `/undo`: Undo the last git commit if it was done by aider

## Breaking Down Tasks

To get the best results:

1. Break your goal into smaller, manageable steps[1].
2. Adjust the files added to the chat as you progress through these steps.
3. Use the `/drop` command to remove files that are no longer needed for the current task.

## Utilizing Read-Only Files

For files that you want aider to reference but not edit:

1. Use the `/read-only` command to add files for reference purposes[2].
2. This is particularly useful for including coding conventions or documentation from other parts of your project[5].

## Incorporating Coding Conventions

To ensure aider follows your project's coding standards:

1. Create a `CONVENTIONS.md` file with your coding guidelines[5].
2. Add this file to the chat using `/read CONVENTIONS.md` or launch aider with `aider --read CONVENTIONS.md`[5].

## Leveraging Git History

To provide context about recent changes:

1. Use the `/run` command with `git diff` to show recent changes[4]:
   ```
   /run git diff HEAD~1
   ```
2. Adjust the number after the tilde to include more commits if needed.

By following these guidelines, you can effectively use the aider.chat markdown files to enhance your coding experience with aider, ensuring that the AI assistant understands your project structure, coding conventions, and recent changes while focusing on the specific tasks at hand.

```markdown
Specifying coding conventions
Sometimes you want GPT to be aware of certain coding guidelines, like whether to provide type hints, which libraries or packages to prefer, etc.

The easiest way to do that with aider is to simply create a small markdown file and include it in the chat.

For example, say we want our python code to:

- Prefer httpx over requests for making http requests.
- Use types everywhere possible.

We would simply create a file like CONVENTIONS.md with those lines and then we can add it to the aider chat, along with the file(s) that we want to edit.

It’s best to load the conventions file with /read CONVENTIONS.md or aider --read CONVENTIONS.md. This way it is marked as read-only, and cached if prompt caching is enabled.

Always load conventions
You can also configure aider to always load your conventions file in the .aider.conf.yml config file:

```yaml
# alone
read: CONVENTIONS.md

# multiple files
read: [CONVENTIONS.md, anotherfile.txt]
```

Example
See below for an example of how the conventions can affect the code that aider writes.

```bash
$ aider --read CONVENTIONS.md useragent.py

Aider v0.24.2-dev
Added CONVENTIONS.md to the chat.
Added useragent.py to the chat.

write a function that uses httpbin to check the user agent on the request. return the ua.
```

To fulfill your request, I will:

- Add an import for httpx.
- Write a function named `check_user_agent` that makes a GET request to `httpbin.org/user-agent` and returns the user agent string.

Here is the diff for the `useragent.py` file:

```diff
--- useragent.py
+++ useragent.py
@@ ... @@
+import httpx
+
+def check_user_agent() -> str:
+    response = httpx.get('https://httpbin.org/user-agent')
+    return response.json()['user-agent']
```

This function uses `httpx` to make a GET request to `httpbin.org/user-agent`, which returns a JSON response containing the user agent of the HTTP client. The function then extracts the user agent string from the JSON response and returns it.

Applied edit to `useragent.py`.

GPT correctly used `httpx` and provided type hints. See below for the transcript of this same coding task conducted without using `CONVENTIONS.md`. In this case, GPT used `requests` and skipped types, which is perhaps more typical in small python scripts.

```bash
$ aider useragent.py

Aider v0.24.2-dev
Added useragent.py to the chat.

write a function that uses httpbin to check the user agent on the request. return the ua.
```

```diff
--- /dev/null
+++ useragent.py
@@ ... @@
+import requests
+
+def check_user_agent():
+    response = requests.get('https://httpbin.org/user-agent')
+    user_agent = response.json().get('user-agent')
+    return user_agent
```

Applied edit to `useragent.py`.
```
 