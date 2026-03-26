import type { RecentSighting } from '../../lib/api';

function parseLocName(locName: string): { name: string; coords: string | null } {
  const bracketed = locName.match(/^(.+?)\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)\s*$/);
  if (bracketed) return { name: bracketed[1].trim(), coords: `${bracketed[2]}, ${bracketed[3]}` };
  const appended = locName.match(/^(.+?)\s+(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  if (appended) return { name: appended[1].trim(), coords: `${appended[2]}, ${appended[3]}` };
  return { name: locName, coords: null };
}

function formatSightingDate(obsDt: string): string {
  const d = new Date(obsDt.replace(' ', 'T'));
  if (isNaN(d.getTime())) return obsDt;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Props {
  sightings: RecentSighting[];
  variant?:  'cards' | 'table';
}

export function RecentSightings({ sightings, variant = 'cards' }: Props) {
  if (sightings.length === 0) return null;

  if (variant === 'table') {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Recent sightings</p>
        <table className="w-full text-[11px] border-collapse rounded-lg overflow-hidden border border-sky-100">
          <thead>
            <tr className="bg-sky-100 border-b border-sky-200">
              <th className="text-left font-semibold text-sky-700 px-2 py-1.5 whitespace-nowrap w-px">Date</th>
              <th className="text-left font-semibold text-sky-700 px-2 py-1.5 w-full">Location</th>
              <th className="text-right font-semibold text-sky-700 px-2 py-1.5 whitespace-nowrap w-px">Lat / Long</th>
            </tr>
          </thead>
          <tbody>
            {sightings.map((s, i) => {
              const loc    = parseLocName(s.locName);
              const coords = s.lat != null && s.lng != null
                ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
                : loc.coords;
              return (
                <tr key={i} className={`border-b border-sky-100 ${i % 2 === 1 ? 'bg-sky-50' : 'bg-white'}`}>
                  <td className="px-2 py-1 text-slate-500 whitespace-nowrap align-top">
                    <span>{formatSightingDate(s.obsDt)}</span>
                    {s.howMany != null && (
                      <span className="ml-1.5 bg-sky-100 text-sky-700 px-1 rounded-full">×{s.howMany}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-slate-700 font-medium align-top max-w-0">
                    <p className="truncate">{loc.name}</p>
                  </td>
                  <td className="px-2 py-1 text-slate-400 text-right whitespace-nowrap align-top">
                    {coords ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center">Recent sightings</p>
      <div className="flex flex-wrap justify-center gap-2">
        {sightings.map((s, i) => {
          const loc    = parseLocName(s.locName);
          const coords = s.lat != null && s.lng != null
            ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
            : loc.coords;
          return (
            <div key={i} className="shrink-0 flex flex-col bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5">
              <p className="text-xs font-medium text-slate-700 leading-tight whitespace-nowrap">{loc.name}</p>
              <p className="text-[10px] text-slate-400 leading-tight whitespace-nowrap min-h-[1em]">{coords ?? ''}</p>
              <div className="flex items-center gap-1 mt-auto pt-0.5">
                <span className="text-[10px] text-slate-500 whitespace-nowrap">{formatSightingDate(s.obsDt)}</span>
                {s.howMany != null && (
                  <span className="text-[10px] bg-sky-100 text-sky-700 px-1 rounded-full shrink-0">×{s.howMany}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
