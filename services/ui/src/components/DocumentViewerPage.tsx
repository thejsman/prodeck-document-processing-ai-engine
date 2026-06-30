"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  getGeneratedDocumentContent,
  generatedDocumentExportUrl,
  type GeneratedDocument,
} from "@/lib/api";

const EXPORT_FORMATS = [
  { value: "md", label: "Markdown (.md)" },
  { value: "txt", label: "Plain Text (.txt)" },
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "docx", label: "Word (.docx)" },
  { value: "pptx", label: "PowerPoint (.pptx)" },
  { value: "notion", label: "Notion Markdown" },
];

export function DocumentViewerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { apiKey } = useAuth();

  const artifactId = searchParams.get("artifact") ?? "";
  const clientName = searchParams.get("client") ?? "";

  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFormatMenu, setShowFormatMenu] = useState(false);

  const isHtml = content !== null && (/^\s*<!DOCTYPE\s+html/i.test(content) || /^\s*<html[\s>]/i.test(content));

  const docTitle = content
    ? (isHtml
        ? (content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "Presentation")
        : (content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Document"))
    : "Loading…";

  useEffect(() => {
    if (!artifactId || !clientName) {
      setError("Missing artifact ID or client name.");
      setLoading(false);
      return;
    }
    setLoading(true);
    getGeneratedDocumentContent(apiKey, clientName, artifactId)
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError((err as Error).message ?? "Failed to load document.");
        setLoading(false);
      });
  }, [artifactId, clientName, apiKey]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          gap: 12,
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => router.back()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              padding: 0,
            }}
          >
            <ArrowLeft size={16} strokeWidth={1.5} />
            Back
          </button>
          {clientName && (
            <span
              style={{
                fontSize: 13,
                color: "var(--muted)",
                borderLeft: "1px solid var(--border)",
                paddingLeft: 10,
              }}
            >
              {decodeURIComponent(clientName)}
            </span>
          )}
        </div>

        <h1
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "" : docTitle}
        </h1>

        {/* Export dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowFormatMenu((v) => !v)}
            disabled={!content}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              opacity: content ? 1 : 0.4,
            }}
          >
            <Download size={14} strokeWidth={2} />
            Export
          </button>
          {showFormatMenu && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 99 }}
                onClick={() => setShowFormatMenu(false)}
              />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  minWidth: 180,
                  zIndex: 100,
                  overflow: "hidden",
                }}
              >
                {EXPORT_FORMATS.map((fmt) => (
                  <a
                    key={fmt.value}
                    href={generatedDocumentExportUrl(
                      clientName,
                      artifactId,
                      fmt.value,
                    )}
                    download
                    onClick={() => setShowFormatMenu(false)}
                    style={{
                      display: "block",
                      padding: "9px 14px",
                      fontSize: 13,
                      color: "var(--text)",
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--panel-soft)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }}
                  >
                    {fmt.label}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          maxWidth: isHtml ? "100%" : 780,
          margin: isHtml ? 0 : "0 auto",
          padding: isHtml ? 0 : "40px 24px 80px",
          width: "100%",
        }}
      >
        {loading && (
          <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", paddingTop: 80 }}>
            Loading document…
          </div>
        )}
        {error && (
          <div style={{ color: "var(--danger)", fontSize: 14, textAlign: "center", paddingTop: 80 }}>
            {error}
          </div>
        )}
        {content && (isHtml ? (
          <iframe
            srcDoc={content}
            style={{ width: '100%', height: 'calc(100vh - 57px)', border: 'none', display: 'block' }}
            title={docTitle}
            sandbox="allow-scripts"
          />
        ) : (
          <div className="proposal-markdown">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ))}
      </div>
    </div>
  );
}
