
import { useEffect } from "react";
import "./SplashScreen.css";

export type RecentProject = {
  id: string;
  name: string;
  updatedAt: string;
  snapshot: {
    name: string;
    objects: unknown[];
    keyframes: Record<string, unknown[]>;
    device: string;
    designSettings?: unknown;
  };
};

type SplashScreenProps = {
  version: string;
  recentProjects: RecentProject[];
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecent: (project: RecentProject) => void;
  onDismiss: () => void;
};

export default function SplashScreen({
  recentProjects,
  onNewProject,
  onOpenProject,
  onOpenRecent,
  onDismiss,
}: SplashScreenProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () =>
      window.removeEventListener("keydown", onKeyDown, true);
  }, [onDismiss]);

  return (
    <div className="clover-splash-screen">
      <section
        className="clover-splash-artboard"
        role="dialog"
        aria-modal="true"
        aria-label="Design Clover start screen"
      >
        {/* Display the exact SVG artwork supplied by you. */}
        <img
          className="clover-splash-svg"
          src={`${import.meta.env.BASE_URL}design-clover-splash-art.svg`}
          alt="Design Clover splash screen"
          draggable={false}
        />

        {/* Transparent buttons overlay the original SVG. */}
        <button
          className="clover-splash-hotspot clover-splash-new"
          onClick={onNewProject}
          aria-label="New file"
          title="New file"
        />

        {recentProjects.slice(0, 3).map((project, index) => (
          <button
            key={project.id}
            className={`clover-splash-hotspot clover-splash-recent clover-splash-recent-${index + 1}`}
            onClick={() => onOpenRecent(project)}
            aria-label={`Open recent project ${project.name}`}
            title={`Open ${project.name}`}
          />
        ))}

        <button
          className="clover-splash-hotspot clover-splash-open"
          onClick={onOpenProject}
          aria-label="Open project"
          title="Open project"
        />

        <button
          className="clover-splash-hotspot clover-splash-recover"
          onClick={() =>
            recentProjects.length > 0
              ? onOpenRecent(recentProjects[0])
              : onDismiss()
          }
          aria-label="Recover last session"
          title="Recover last session"
        />
      </section>
    </div>
  );
}
