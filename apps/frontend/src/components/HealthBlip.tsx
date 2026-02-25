import { useEffect, useState } from "react";
import { getHealth, type HealthData } from "../api";

type HealthStatus = "ok" | "degraded" | "unreachable" | "loading";

function getServiceErrors(services: HealthData["services"]): string[] {
  if (!services) return [];
  const out: string[] = [];
  for (const [name, s] of Object.entries(services)) {
    if (s?.status === "error" && s.error) {
      out.push(`${name}: ${s.error}`);
    }
  }
  return out;
}

export function HealthBlip() {
  const [status, setStatus] = useState<HealthStatus>("loading");
  const [latency, setLatency] = useState<number | null>(null);
  const [serviceErrors, setServiceErrors] = useState<string[]>([]);

  const checkHealth = async () => {
    const start = Date.now();
    const data = await getHealth();
    setLatency(Date.now() - start);

    if (data === null) {
      setStatus("unreachable");
      setServiceErrors([]);
      return;
    }
    if (data.status === "ok") {
      setStatus("ok");
      setServiceErrors([]);
    } else {
      setStatus("degraded");
      setServiceErrors(getServiceErrors(data.services));
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case "ok":
        return "bg-emerald-500";
      case "degraded":
        return "bg-amber-500";
      case "unreachable":
        return "bg-rose-500";
      default:
        return "bg-zinc-500";
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "ok":
        return "API Healthy";
      case "degraded":
        return "API Degraded";
      case "unreachable":
        return "API Unreachable";
      default:
        return "Checking status...";
    }
  };

  const tooltipBody = (
    <>
      <div className="font-medium">{getStatusLabel()}</div>
      {status === "degraded" && serviceErrors.length > 0 && (
        <div className="mt-1 text-amber-300 text-left max-w-[220px]">
          {serviceErrors.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      {latency !== null && (
        <div className="text-zinc-400 mt-0.5">Latency: {latency}ms</div>
      )}
    </>
  );

  return (
    <div className="relative group flex items-center">
      <div
        className={`w-2 h-2 rounded-full ${getStatusColor()} transition-colors duration-500 relative`}
        aria-hidden="true"
      >
        {status === "ok" && (
          <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
        )}
      </div>

      <div className="invisible group-hover:visible absolute left-full ml-2 px-2 py-1.5 bg-hooman-surface border border-hooman-border rounded text-[10px] text-white z-50 shadow-xl min-w-[140px] max-w-[240px]">
        {tooltipBody}
      </div>
    </div>
  );
}
