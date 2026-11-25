import fs from 'fs';
import os from 'os';

export interface HostWorkstationMetrics {
  cpuPct: number;
  ramPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  tempC: number;
  tempSource: 'sensor' | 'derived';
  gpuPct: number;
  gpuSource: 'sysfs' | 'compute-derived';
  diskPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  hostname: string;
  platform: string;
  arch: string;
  cpuCores: number;
  uptimeSeconds: number;
  processRssMb: number;
  measuredAt: number;
}

export interface CpuSnapshot {
  idle: number;
  total: number;
}

let prevCpuSnapshot: CpuSnapshot | null = null;

export function captureCpuSnapshot(cpus: os.CpuInfo[] = os.cpus()): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

export function computeCpuPercentFromSnapshots(
  prev: CpuSnapshot | null,
  curr: CpuSnapshot,
  loadAvg1m: number,
  cpuCount: number,
): number {
  if (prev && curr.total > prev.total) {
    const idleDelta = curr.idle - prev.idle;
    const totalDelta = curr.total - prev.total;
    const pct = ((totalDelta - idleDelta) / totalDelta) * 100;
    return Number(Math.max(0, Math.min(100, pct)).toFixed(1));
  }
  const normalized = (loadAvg1m / Math.max(1, cpuCount)) * 100;
  return Number(Math.max(0, Math.min(100, normalized)).toFixed(1));
}

export function computeDiskStats(targetPath = process.cwd()): {
  diskPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
} {
  try {
    const stat = fs.statfsSync(targetPath);
    const blockSize = Number(stat.bsize || 4096);
    const totalBytes = Number(stat.blocks) * blockSize;
    const availBytes = Number(stat.bavail) * blockSize;
    if (totalBytes > 0) {
      const usedBytes = Math.max(0, totalBytes - availBytes);
      const pct = (usedBytes / totalBytes) * 100;
      const gb = 1024 * 1024 * 1024;
      return {
        diskPct: Number(Math.max(0, Math.min(100, pct)).toFixed(1)),
        diskUsedGb: Number((usedBytes / gb).toFixed(1)),
        diskTotalGb: Number((totalBytes / gb).toFixed(1)),
      };
    }
  } catch {
    // Fallback if statfs unavailable
  }
  return { diskPct: 0, diskUsedGb: 0, diskTotalGb: 0 };
}

function readHostTemperatureC(cpuPct: number, activeAgents: number): {
  tempC: number;
  tempSource: 'sensor' | 'derived';
} {
  try {
    const thermalRoot = '/sys/class/thermal';
    if (fs.existsSync(thermalRoot)) {
      const entries = fs.readdirSync(thermalRoot).filter((n) => n.startsWith('thermal_zone'));
      let maxTemp = 0;
      for (const entry of entries) {
        const raw = fs.readFileSync(`${thermalRoot}/${entry}/temp`, 'utf8').trim();
        const milli = Number(raw);
        if (Number.isFinite(milli) && milli > 0) {
          const c = milli > 1000 ? milli / 1000 : milli;
          if (c > 0 && c < 140) maxTemp = Math.max(maxTemp, c);
        }
      }
      if (maxTemp > 0) {
        return { tempC: Number(maxTemp.toFixed(1)), tempSource: 'sensor' };
      }
    }
  } catch {
    // Thermal sensors not exposed in sandboxed container
  }
  // Honest thermal curve derived from measured CPU + agent workload
  const derived = 34 + cpuPct * 0.36 + activeAgents * 1.4;
  return { tempC: Number(Math.min(95, derived).toFixed(1)), tempSource: 'derived' };
}

function readGpuUtilization(activeComputeLoad: number): {
  gpuPct: number;
  gpuSource: 'sysfs' | 'compute-derived';
} {
  try {
    const drmRoot = '/sys/class/drm';
    if (fs.existsSync(drmRoot)) {
      const cards = fs.readdirSync(drmRoot).filter((n) => /^card\d+$/.test(n));
      for (const card of cards) {
        const busyFile = `${drmRoot}/${card}/device/gpu_busy_percent`;
        if (fs.existsSync(busyFile)) {
          const raw = Number(fs.readFileSync(busyFile, 'utf8').trim());
          if (Number.isFinite(raw)) {
            return { gpuPct: Number(Math.max(0, Math.min(100, raw)).toFixed(1)), gpuSource: 'sysfs' };
          }
        }
      }
    }
  } catch {
    // No DRM GPU sysfs exposed
  }
  return {
    gpuPct: Number(Math.max(2, Math.min(100, activeComputeLoad)).toFixed(1)),
    gpuSource: 'compute-derived',
  };
}

export function collectHostWorkstationMetrics(activeAgents = 0, neuralAvgLoad = 0): HostWorkstationMetrics {
  const cpus = os.cpus();
  const curr = captureCpuSnapshot(cpus);
  const load1m = os.loadavg()[0] ?? 0;
  const cpuPct = computeCpuPercentFromSnapshots(prevCpuSnapshot, curr, load1m, cpus.length);
  prevCpuSnapshot = curr;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const ramPct = totalMem > 0 ? Number(((usedMem / totalMem) * 100).toFixed(1)) : 0;
  const gb = 1024 * 1024 * 1024;

  const disk = computeDiskStats();
  const temp = readHostTemperatureC(cpuPct, activeAgents);
  const gpu = readGpuUtilization(neuralAvgLoad * 0.7 + activeAgents * 7.5);
  const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

  return {
    cpuPct,
    ramPct,
    ramUsedGb: Number((usedMem / gb).toFixed(1)),
    ramTotalGb: Number((totalMem / gb).toFixed(1)),
    tempC: temp.tempC,
    tempSource: temp.tempSource,
    gpuPct: gpu.gpuPct,
    gpuSource: gpu.gpuSource,
    diskPct: disk.diskPct,
    diskUsedGb: disk.diskUsedGb,
    diskTotalGb: disk.diskTotalGb,
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpuCores: cpus.length,
    uptimeSeconds: Math.round(process.uptime()),
    processRssMb: rssMb,
    measuredAt: Date.now(),
  };
}
