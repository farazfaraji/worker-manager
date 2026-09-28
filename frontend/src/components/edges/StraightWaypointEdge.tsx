'use client';

import React, { useCallback, useState } from 'react';
import { EdgeProps, useReactFlow, EdgeLabelRenderer, getSmoothStepPath, Position } from '@xyflow/react';

export interface WaypointEdgeData extends Record<string, unknown> {
  waypoints?: { x: number; y: number }[];
}

interface Toolbox {
  x: number; // flow-space x
  y: number; // flow-space y
  sx: number; // screen x (for positioning the HTML overlay)
  sy: number; // screen y
  segIdx: number; // segment index for waypoint insertion
}

/**
 * Orthogonal 90° step edge with inline waypoints toolbox.
 * Automatically goes straight and then turns 90° down into target,
 * while allowing user to drag or insert custom waypoints.
 */
export const StraightWaypointEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Top,
  style,
  markerEnd,
  data,
  selected,
}) => {
  const { setEdges, deleteElements, getEdge } = useReactFlow();
  const waypoints: { x: number; y: number }[] = (data as WaypointEdgeData)?.waypoints ?? [];

  const [toolbox, setToolbox] = useState<Toolbox | null>(null);

  // Build polyline (if waypoints exist) or orthogonal 90° step path
  const buildPath = (wps: { x: number; y: number }[]): string => {
    if (wps.length > 0) {
      const pts = [{ x: sourceX, y: sourceY }, ...wps, { x: targetX, y: targetY }];
      return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    }
    const [path] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 12,
      offset: 24,
    });
    return path;
  };

  const d = buildPath(waypoints);

  // ── Click hit-area: select + show toolbox ─────────────────────────────────
  const handleHitAreaClick = useCallback(
    (evt: React.MouseEvent<SVGPathElement>) => {
      // Don't stop propagation — let RF select the edge normally
      const svgEl = (evt.currentTarget as SVGPathElement).ownerSVGElement!;
      const pt = svgEl.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const flow = pt.matrixTransform(svgEl.getScreenCTM()!.inverse());

      const clickX = flow.x;
      const clickY = flow.y;

      // Find which segment the click is nearest to (for future waypoint insert)
      const allPts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }];
      let bestSeg = 0;
      let bestDist = Infinity;
      for (let i = 0; i < allPts.length - 1; i++) {
        const dist = pointToSegmentDistance(clickX, clickY, allPts[i], allPts[i + 1]);
        if (dist < bestDist) {
          bestDist = dist;
          bestSeg = i;
        }
      }

      setToolbox({ x: clickX, y: clickY, sx: evt.clientX, sy: evt.clientY, segIdx: bestSeg });
    },
    [sourceX, sourceY, targetX, targetY, waypoints],
  );

  // Dismiss toolbox when clicking elsewhere
  const dismissToolbox = useCallback(() => setToolbox(null), []);

  // ── Toolbox: Add waypoint ─────────────────────────────────────────────────
  const handleAddWaypoint = useCallback(
    (evt: React.MouseEvent) => {
      evt.stopPropagation();
      if (!toolbox) return;
      const newWps = [...waypoints];
      newWps.splice(toolbox.segIdx, 0, { x: toolbox.x, y: toolbox.y });
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...(e.data ?? {}), waypoints: newWps } } : e,
        ),
      );
      setToolbox(null);
    },
    [id, toolbox, waypoints, setEdges],
  );

  // ── Toolbox: Delete edge ──────────────────────────────────────────────────
  const handleDeleteEdge = useCallback(
    (evt: React.MouseEvent) => {
      evt.stopPropagation();
      deleteElements({ edges: [{ id }] });
      setToolbox(null);
    },
    [id, deleteElements],
  );

  // ── Drag a waypoint handle ────────────────────────────────────────────────
  const handleWaypointPointerDown = useCallback(
    (evt: React.PointerEvent<HTMLDivElement>, idx: number) => {
      evt.stopPropagation();
      evt.preventDefault();
      evt.currentTarget.setPointerCapture(evt.pointerId);
      setToolbox(null);

      const svgEl = document.querySelector('.react-flow__renderer svg') as SVGSVGElement | null;

      const onMove = (moveEvt: PointerEvent) => {
        let fx = moveEvt.clientX;
        let fy = moveEvt.clientY;
        if (svgEl) {
          const pt = svgEl.createSVGPoint();
          pt.x = moveEvt.clientX;
          pt.y = moveEvt.clientY;
          const flow = pt.matrixTransform(svgEl.getScreenCTM()!.inverse());
          fx = flow.x;
          fy = flow.y;
        }
        setEdges((eds) =>
          eds.map((e) => {
            if (e.id !== id) return e;
            const wps = [...((e.data as WaypointEdgeData)?.waypoints ?? [])];
            wps[idx] = { x: fx, y: fy };
            return { ...e, data: { ...(e.data ?? {}), waypoints: wps } };
          }),
        );
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [id, setEdges],
  );

  // ── Double-click waypoint: remove it ─────────────────────────────────────
  const handleWaypointDoubleClick = useCallback(
    (evt: React.MouseEvent, idx: number) => {
      evt.stopPropagation();
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== id) return e;
          const wps = [...((e.data as WaypointEdgeData)?.waypoints ?? [])];
          wps.splice(idx, 1);
          return { ...e, data: { ...(e.data ?? {}), waypoints: wps } };
        }),
      );
    },
    [id, setEdges],
  );

  // Dismiss toolbox when edge gets deselected
  React.useEffect(() => {
    if (!selected) setToolbox(null);
  }, [selected]);

  const strokeColor = (style as React.CSSProperties)?.stroke ?? 'var(--accent-primary)';
  const strokeWidth = Number((style as React.CSSProperties)?.strokeWidth ?? 2);

  // Midpoint of the path (for toolbox anchor when no click position available)
  const midPt = {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };

  return (
    <>
      {/* Visible polyline */}
      <path
        d={d}
        fill="none"
        stroke={String(strokeColor)}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={markerEnd}
        style={{ ...style, pointerEvents: 'none' }}
        className="react-flow__edge-path"
      />

      {/* Wide invisible hit-area */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ cursor: 'pointer' }}
        onClick={handleHitAreaClick}
        className="edge-hit-area"
      />

      <EdgeLabelRenderer>
        {/* ── Floating toolbox ── */}
        {selected && toolbox && (
          <>
            {/* Click-outside dismiss layer */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              onClick={dismissToolbox}
            />
            <div
              className="edge-toolbox nodrag nopan"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -100%) translate(${toolbox.x}px, ${toolbox.y - 8}px)`,
                zIndex: 50,
                pointerEvents: 'all',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="edge-toolbox-btn"
                title="Add waypoint here"
                onClick={handleAddWaypoint}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="7" />
                  <line x1="12" y1="17" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="7" y2="12" />
                  <line x1="17" y1="12" x2="22" y2="12" />
                </svg>
                Add point
              </button>
              <div className="edge-toolbox-divider" />
              <button
                className="edge-toolbox-btn edge-toolbox-btn--danger"
                title="Delete edge (or press Delete)"
                onClick={handleDeleteEdge}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
                Delete
              </button>
            </div>
          </>
        )}

        {/* ── Waypoint drag handles ── */}
        {waypoints.map((wp, idx) => (
          <div
            key={idx}
            className="waypoint-handle nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${wp.x}px, ${wp.y}px)`,
              pointerEvents: 'all',
            }}
            onPointerDown={(e) => handleWaypointPointerDown(e, idx)}
            onDoubleClick={(e) => handleWaypointDoubleClick(e, idx)}
            title="Drag to move · Double-click to remove"
          />
        ))}
      </EdgeLabelRenderer>
    </>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pointToSegmentDistance(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
