// react hook: load data once, then reload whenever the rolls table changes (Supabase Realtime)
// Usage Syntax: const { data, status, pulse } = useLive(() => fetchCharacters(), [])
//--------------------------------------------------------------------------------------------------------------
// Outline
//   Types
//     LiveStatus
//   Hook
//     useLive
//--------------------------------------------------------------------------------------------------------------

"use client";

import { useEffect, useRef, useState, type DependencyList } from "react"; //react state + lifecycle
import { getClient, isDemo } from "./data"; //shared Supabase client

//--------------------------------------------------------------------------------------------------------------
//Types
//--------------------------------------------------------------------------------------------------------------

// loading -> first fetch; live -> realtime connected; polling -> realtime unavailable, timer fallback; demo; error
export type LiveStatus = "loading" | "live" | "polling" | "demo" | "error";

const DEBOUNCE_MS = 1500; //bulk import = hundreds of inserts -> one refetch after they settle
const POLL_MS = 60_000; //fallback refresh if realtime is off for the table

//--------------------------------------------------------------------------------------------------------------
//Hook
//--------------------------------------------------------------------------------------------------------------

// fetch + auto-refresh; pulse increments on each refresh after the first (drives the "updated" flash)
//params: load (() => Promise<T>) - query to run; deps (DependencyList) - re-run when these change
//output: { data: T | null, status: LiveStatus, error: string | null, pulse: number, loaded: boolean }
export function useLive<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [loaded, setLoaded] = useState(false); //true once the first query returned, even if it returned null
  const loadRef = useRef(load);
  loadRef.current = load; //always call the latest closure without resubscribing

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let first = true;
    let mode: LiveStatus = isDemo ? "demo" : "loading"; //last known connection state, restored after an error clears

    //run the query; flag pulse on refreshes, not the first load
    const run = async () => {
      try {
        const next = await loadRef.current();
        if (!alive) return;
        setData(next);
        setError(null);
        setStatus(mode);
        setLoaded(true);
        if (!first) setPulse((p) => p + 1);
        first = false;
      } catch (e) {
        if (!alive) return;
        //supabase-js errors are plain objects with .message, not Error instances
        setError((e as { message?: string })?.message ?? String(e));
        setStatus("error");
      }
    };

    //debounced refetch, collapses a burst of change events into one query
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    };

    run();
    if (isDemo) return () => void (alive = false);

    //subscribe to any insert/update/delete on rolls; RLS means only public characters' changes arrive
    const channel = getClient()
      .channel(`rolls-${Math.random().toString(36).slice(2)}`) //unique name per hook instance
      .on("postgres_changes", { event: "*", schema: "public", table: "rolls" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "characters" }, schedule)
      .subscribe((s) => {
        if (!alive) return;
        if (s === "SUBSCRIBED") {
          mode = "live";
          setStatus((p) => (p === "error" ? p : "live"));
        }
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          //realtime unreachable -> plain timer refresh instead
          mode = "polling";
          setStatus((p) => (p === "error" ? p : "polling"));
          clearInterval(poll);
          poll = setInterval(run, POLL_MS);
        }
      });

    //also refresh when the tab regains focus (covers laptops waking from sleep)
    const onFocus = () => document.visibilityState === "visible" && schedule();
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onFocus);
      getClient().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, status, error, pulse, loaded };
}
