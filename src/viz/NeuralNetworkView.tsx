import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { NeuralNetworkViz } from './NeuralNetworkViz';
import type {
  ActivityEvent,
  ConnectSource,
  GraphTopology,
  NeuralNetworkVizHandle,
  NodeClickPayload,
  NodeHoverPayload,
  ParsedActivity,
  VizAggregateState,
  VizOptions,
} from './types';

export interface NeuralNetworkViewProps {
  options?: VizOptions;
  topology?: GraphTopology;
  activity?: string | string[] | ActivityEvent | ActivityEvent[];
  source?: ConnectSource;
  className?: string;
  style?: CSSProperties;
  showTooltip?: boolean;
  onNodeHover?: (payload: NodeHoverPayload) => void;
  onNodeClick?: (payload: NodeClickPayload) => void;
  onActivity?: (activity: ParsedActivity) => void;
  onStateChange?: (state: VizAggregateState) => void;
}

export const NeuralNetworkView = forwardRef<NeuralNetworkVizHandle, NeuralNetworkViewProps>(
  function NeuralNetworkView(
    {
      options,
      topology,
      activity,
      source,
      className = '',
      style,
      showTooltip = true,
      onNodeHover,
      onNodeClick,
      onActivity,
      onStateChange,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const vizRef = useRef<NeuralNetworkViz | null>(null);
    const [hoverInfo, setHoverInfo] = useState<NodeHoverPayload | null>(null);

    const callbacksRef = useRef({ onNodeHover, onNodeClick, onActivity, onStateChange });
    callbacksRef.current = { onNodeHover, onNodeClick, onActivity, onStateChange };

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const viz = new NeuralNetworkViz(el, options);
      vizRef.current = viz;

      const unsubHover = viz.on('nodeHover', (payload) => {
        setHoverInfo(payload.node ? payload : null);
        callbacksRef.current.onNodeHover?.(payload);
      });
      const unsubClick = viz.on('nodeClick', (payload) => {
        callbacksRef.current.onNodeClick?.(payload);
      });
      const unsubActivity = viz.on('activity', (payload) => {
        callbacksRef.current.onActivity?.(payload);
      });
      const unsubState = viz.on('stateChange', (payload) => {
        callbacksRef.current.onStateChange?.(payload);
      });

      return () => {
        unsubHover();
        unsubClick();
        unsubActivity();
        unsubState();
        viz.dispose();
        vizRef.current = null;
      };
      // Mount once per container lifecycle; dynamic topology/activity/options updates use imperative methods below
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (topology && vizRef.current) {
        vizRef.current.setGraph(topology);
      }
    }, [topology]);

    useEffect(() => {
      if (activity && vizRef.current) {
        vizRef.current.updateActivity(activity);
      }
    }, [activity]);

    useEffect(() => {
      if (!source || !vizRef.current) return;
      const conn = vizRef.current.connect(source);
      return () => conn.close();
    }, [source]);

    useImperativeHandle(
      ref,
      () => ({
        getNode: (id) => vizRef.current?.getNode(id),
        getEdge: (id) => vizRef.current?.getEdge(id),
        getNeighbors: (id, hops) => vizRef.current?.getNeighbors(id, hops) ?? [],
        getLayer: (n) => vizRef.current?.getLayer(n) ?? [],
        setGraph: (t) => vizRef.current?.setGraph(t),
        updateActivity: (input) => vizRef.current?.updateActivity(input),
        registerActivity: (name, handler) => vizRef.current?.registerActivity(name, handler),
        connect: (s) => vizRef.current?.connect(s) ?? { close: () => {} },
        on: (event, cb) => vizRef.current?.on(event, cb) ?? (() => {}),
        off: (event, cb) => vizRef.current?.off(event, cb),
        getState: () =>
          vizRef.current?.getState() ?? {
            dominantActivity: 'idle',
            perLayerActivation: [],
            activeEventCount: 0,
            selectedNodeId: null,
            hoveredNodeId: null,
            qualityTier: 'high',
            avgFrameMs: 16.6,
          },
        setNodeState: (id, patch) => vizRef.current?.setNodeState(id, patch),
        setEdgeState: (id, patch) => vizRef.current?.setEdgeState(id, patch),
        pulseEdge: (id, intensity) => vizRef.current?.pulseEdge(id, intensity),
        focusNode: (id, durationMs) => vizRef.current?.focusNode(id, durationMs),
        focusLayer: (layerIndex, durationMs) => vizRef.current?.focusLayer(layerIndex, durationMs),
        setBloomStrength: (strength) => vizRef.current?.setBloomStrength(strength),
        reset: () => vizRef.current?.reset(),
        dispose: () => vizRef.current?.dispose(),
      }),
      [],
    );

    return (
      <div
        className={`relative w-full h-full overflow-hidden select-none bg-[#05060f] ${className}`}
        style={style}
      >
        <div ref={containerRef} className="w-full h-full" />
        {showTooltip && hoverInfo?.node && (
          <div
            className="pointer-events-none absolute z-10 px-2.5 py-1.5 rounded-md bg-[#090d1a]/95 border border-cyan-500/40 text-[11px] text-slate-100 shadow-lg font-mono"
            style={{
              left: Math.min(Math.max(8, hoverInfo.screenX + 12), 260),
              top: Math.max(8, hoverInfo.screenY - 28),
            }}
          >
            <div className="font-semibold text-cyan-300">
              Node #{hoverInfo.node.id} · Layer {hoverInfo.node.layer}
            </div>
            <div className="text-slate-300">
              act {(hoverInfo.node.activation * 100).toFixed(0)}% · state {hoverInfo.node.state}
            </div>
          </div>
        )}
      </div>
    );
  },
);
