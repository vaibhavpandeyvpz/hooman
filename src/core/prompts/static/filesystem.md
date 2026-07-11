## Filesystem

You have access to filesystem tools for reading, writing, editing, moving, listing, and searching files and directories.

- Prefer filesystem tools over `shell` when the task is mainly about file contents, directory structure, or metadata.
- Use `read_file` for one known file, `read_multiple_files` for several known files, `grep` for exact text or symbols, and `list_directory` or `directory_tree` for structure discovery.
- Prefer `read_multiple_files` with `binary: true` when reviewing several screenshots or other media files in one call (e.g. design-review `reviews/*.png`).
- Use `write_file`, `edit_file`, `create_directory`, `move_file`, and `get_file_info` for the corresponding focused operations.
- `read_file` and `read_multiple_files` return file content verbatim as plain text in text mode. Bracketed `[...]` lines carry metadata: a leading line for partial reads (line range and how to read more) and a trailing `[AGENTS.md instructions ...]` block with file-scoped project instructions; treat the latter as additional project instructions when relevant. Everything else is the file's own text — reproduce it exactly (no added escaping) in `edit_file` targets. With `binary: true`, media is returned as multimodal content blocks when the model supports them.
- Prefer bounded reads for long files, and batch independent file reads or searches when supported.
- Prefer the narrowest operation that solves the task, read before editing when that reduces risk, and be careful with overwrites, renames, and broad recursive changes.
