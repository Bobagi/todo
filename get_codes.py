import os
from pathlib import Path

def collect_source_file_paths(root_directory: Path, allowed_extensions: set[str], ignored_directory_names: set[str]) -> list[Path]:
    collected_paths: list[Path] = []
    for current_root, directory_names, file_names in os.walk(root_directory):
        directory_names[:] = [d for d in directory_names if d not in ignored_directory_names]
        for file_name in file_names:
            file_path = Path(current_root) / file_name
            if file_path.suffix.lower() in allowed_extensions:
                collected_paths.append(file_path)
    collected_paths.sort(key=lambda p: p.as_posix())
    return collected_paths

def write_files_into_single_text(output_file_path: Path, source_file_paths: list[Path], root_directory: Path) -> None:
    with output_file_path.open("w", encoding="utf-8") as output_stream:
        for source_path in source_file_paths:
            relative_path = source_path.relative_to(root_directory).as_posix()
            output_stream.write(f"\n\n===== FILE BEGIN: {relative_path} =====\n")
            try:
                file_text = source_path.read_text(encoding="utf-8", errors="replace")
            except Exception as read_error:
                file_text = f"[READ_ERROR] {read_error}"
            output_stream.write(file_text)
            output_stream.write("\n===== FILE END =====\n")

def main() -> None:
    root_directory: Path = Path.cwd()
    output_file_path: Path = root_directory / "project_js_css_dump.txt"
    allowed_extensions: set[str] = {".js", ".css"}
    ignored_directory_names: set[str] = {"node_modules", ".git", "dist", "build", ".next", ".svelte-kit", ".cache", ".venv", "venv", "__pycache__", "coverage", ".idea", ".vscode"}
    source_file_paths: list[Path] = collect_source_file_paths(root_directory, allowed_extensions, ignored_directory_names)
    write_files_into_single_text(output_file_path, source_file_paths, root_directory)
    print(f"Wrote {len(source_file_paths)} files into {output_file_path.name}")

if __name__ == "__main__":
    main()
