import { useState } from "react";
import {
  DownloadIcon,
  FolderOpenIcon,
  Loader2Icon,
  PlugIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { SkillSearchResult } from "../../global";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { StickyToolbar } from "./StickyToolbar.js";
import type { SkillSummary } from "./use-management-data.js";

/**
 * Search/install/remove backed by the same `skills` CLI (`npx skills`,
 * https://skills.sh) the `hooman configure` flow and the VS Code extension
 * already use — this is a friendlier front end for it, not a separate
 * mechanism.
 */
export function SkillsTab(props: {
  skills: SkillSummary[];
  reload: () => Promise<void>;
}) {
  const { skills, reload } = props;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [installingKey, setInstallingKey] = useState<string | null>(null);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    try {
      setResults(await window.hooman.searchSkills(trimmed));
      setSearched(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const install = async (source: string, key: string) => {
    setInstallingKey(key);
    const toastId = toast.loading(`Installing ${source}…`);
    try {
      await window.hooman.installSkill(source);
      await reload();
      toast.success(`Installed ${source}.`, { id: toastId });
      setSourceInput("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
    } finally {
      setInstallingKey(null);
    }
  };

  const remove = async (folder: string, name: string) => {
    if (!window.confirm(`Remove skill "${name}"?`)) return;
    try {
      await window.hooman.deleteSkill(folder);
      await reload();
      toast.success(`Removed ${name}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <StickyToolbar>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void window.hooman.openSkillsFolder()}
        >
          <FolderOpenIcon /> Open skills folder
        </Button>
      </StickyToolbar>
      <div className="p-4">
        <Tabs defaultValue="installed">
          <TabsList>
            <TabsTrigger value="installed">
              <PlugIcon /> Installed
              {skills.length > 0 && (
                <span className="text-[10px] opacity-80">
                  ({skills.length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="search">
              <SearchIcon /> Search
            </TabsTrigger>
          </TabsList>

          <TabsContent value="installed">
            <div className="space-y-2">
              {skills.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No skills installed.
                </p>
              ) : (
                skills.map((skill) => (
                  <Card key={skill.folder}>
                    <CardHeader>
                      <div>
                        <CardTitle>{skill.name}</CardTitle>
                        {skill.description && (
                          <CardDescription>{skill.description}</CardDescription>
                        )}
                      </div>
                      <CardAction>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void remove(skill.folder, skill.name)}
                        >
                          <TrashIcon />
                        </Button>
                      </CardAction>
                    </CardHeader>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="search">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Install from source</CardTitle>
                    <CardDescription>
                      owner/repo, a Git URL, or a local path.
                    </CardDescription>
                  </div>
                </CardHeader>
                <div className="flex gap-2">
                  <Input
                    value={sourceInput}
                    onChange={(e) => setSourceInput(e.target.value)}
                    placeholder="anthropics/skills"
                  />
                  <Button
                    disabled={!sourceInput.trim() || installingKey !== null}
                    onClick={() =>
                      void install(sourceInput.trim(), sourceInput.trim())
                    }
                  >
                    {installingKey === sourceInput.trim() ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <DownloadIcon />
                    )}
                    Install
                  </Button>
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Search catalog</CardTitle>
                    <CardDescription>
                      Search skills.sh for a skill.
                    </CardDescription>
                  </div>
                </CardHeader>
                <div className="flex gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void runSearch();
                    }}
                    placeholder="pdf, git, browser…"
                  />
                  <Button
                    variant="outline"
                    disabled={query.trim().length < 2 || searching}
                    onClick={() => void runSearch()}
                  >
                    {searching ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <SearchIcon />
                    )}
                    Search
                  </Button>
                </div>
                {searched && results.length === 0 && (
                  <p className="text-[13px] text-muted-foreground">
                    No results for “{query.trim()}”.
                  </p>
                )}
                {results.length > 0 && (
                  <div className="space-y-2">
                    {results.map((result) => (
                      <div
                        key={result.slug}
                        className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div>
                          <div className="text-[13px] font-medium text-foreground">
                            {result.name}
                          </div>
                          <div className="text-[12px] text-muted-foreground">
                            {result.slug}
                            {result.installs > 0 && (
                              <Badge variant="outline" className="ml-2">
                                {result.installs} installs
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          disabled={installingKey !== null}
                          onClick={() => void install(result.slug, result.slug)}
                        >
                          {installingKey === result.slug ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <DownloadIcon />
                          )}
                          Install
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
