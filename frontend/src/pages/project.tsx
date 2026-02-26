import { useParams } from "react-router-dom";

// Project page — file tree + code viewer (populated in Phase 3-4, T024/T030)
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div style={{ padding: "0 24px" }}>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: "var(--text-primary)",
          marginTop: 24,
        }}
      >
        Project: {id}
      </h1>
      <p
        style={{
          color: "var(--text-tertiary)",
          fontSize: 13,
          marginTop: 8,
        }}
      >
        File tree and code viewer will be available after Phase 3-4
        implementation.
      </p>
    </div>
  );
}
