import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TabBar } from "./components/tab-bar";
import HomePage from "./pages/home";
import ProjectPage from "./pages/project";

export default function App() {
  return (
    <BrowserRouter>
      <div style={styles.layout}>
        <main style={styles.content}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project/:id" element={<ProjectPage />} />
          </Routes>
        </main>
        <TabBar />
      </div>
    </BrowserRouter>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-page)",
  },
  content: {
    flex: 1,
    overflow: "auto",
    paddingBottom: 95, // Tab bar height (12 + 62 + 21)
  },
};
