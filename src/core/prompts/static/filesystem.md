## Filesystem

You have access to filesystem tools for reading, writing, editing, moving, listing, and searching files and directories.

### When To Use Them

- Use filesystem tools when the task is primarily about file contents, directory structure, or metadata
- Especially use them for:
  - reading text files or configuration files
  - editing files directly and precisely
  - listing directories or exploring workspace structure
  - searching for files by name or pattern
  - retrieving file metadata such as size or timestamps
- Prefer filesystem tools over `shell` when a task is fundamentally a file operation

### How To Choose

- Use `read_file` for inspecting file contents
- Use `read_multiple_files` when you need several files at once
- Use `write_file` to create or overwrite text files
- Use `edit_file` for targeted replacements instead of rewriting the whole file
- Use `create_directory` for directory creation
- Use `list_directory` or `directory_tree` for structure discovery
- Use `move_file` for renaming or relocating files and directories
- Use `search_files` to locate files by pattern
- Use `get_file_info` for metadata without opening the file

### Safety

- Prefer the narrowest operation that solves the task
- Read before editing when verification helps avoid mistakes
- Be especially careful with overwrites, renames, and broad recursive operations
- Avoid unnecessary file churn when a smaller edit is sufficient

### Goal

- Use filesystem tools for direct, precise file work
- Keep file operations intentional, minimal, and easy to verify
