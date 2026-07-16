export type FileEdit =
  | { path: string; mode: "write"; content: string; expected_sha256?: string }
  | {
      path: string;
      mode: "replace";
      old_text: string;
      new_text: string;
      replace_all?: boolean;
      expected_sha256?: string;
    }
  | {
      path: string;
      mode: "edit";
      content: string;
      insert_at: number;
      replace_until?: number | null;
      expected_sha256?: string;
    }
  | { path: string; mode: "rename"; new_path: string; expected_sha256?: string }
  | { path: string; mode: "delete"; expected_sha256?: string };

export type EditResult = {
  path: string;
  mode: FileEdit["mode"];
  changed: boolean;
  replacements?: number;
  new_path?: string;
};
