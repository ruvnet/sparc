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

Sources
[1] Tips - Aider https://aider.chat/docs/usage/tips.html
[2] In-chat commands - Aider https://aider.chat/docs/usage/commands.html
[3] Usage | aider https://aider.chat/docs/usage.html
[4] FAQ | aider https://aider.chat/docs/faq.html
[5] Specifying coding conventions | aider https://aider.chat/docs/usage/conventions.html