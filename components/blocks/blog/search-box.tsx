"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import moment from "moment";

/**
 * 博客搜索（6.15）：调 /api/search 按标题/内容模糊匹配
 */
export default function BlogSearchBox({ locale }: { locale: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&locale=${locale}`
      );
      const { code, data } = await resp.json();
      if (code === 0) {
        setResults(data.posts || []);
      }
    } catch (e) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mb-8 max-w-xl">
      <div className="flex gap-2">
        <Input
          placeholder="Search posts..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              search();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={search} disabled={loading}>
          {loading ? "..." : "Search"}
        </Button>
      </div>

      {results !== null && (
        <div className="mt-4 space-y-2 rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            {results.length} result(s) for &quot;{q}&quot;
          </p>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts found</p>
          ) : (
            results.map((post) => (
              <a
                key={post.uuid}
                href={`/posts/${post.slug}`}
                className="block rounded-md p-2 hover:bg-muted"
              >
                <span className="text-sm font-medium">{post.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {moment(post.created_at).format("YYYY-MM-DD")}
                </span>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
