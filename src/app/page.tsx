"use client"
import { useState, useEffect } from 'react';

export default function Home() {
    const [logs, setLogs] = useState([]);

    const fetchLogs = async () => {
        try {
            const res = await fetch('http://localhost:5193/api/PGTAIL/logs');
            const data = await res.json();
            setLogs(data);
        } catch (err) {
            console.error("Engine Connection Error:", err);
        }
    };

    // Helper: Check if this specific address/sender combo has an override anywhere in the list
    const isAlreadyOverridden = (address: string, sender: string) => {
        return logs.some((log: any) =>
            log.isManualOverride &&
            log.address.toLowerCase() === address.toLowerCase() &&
            log.sender.toLowerCase() === sender.toLowerCase()
        );
    };

    const handleWhitelist = async (targetAddress: string, userAddress: string) => {
        const response = await fetch('http://localhost:5193/api/PGTAIL/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: targetAddress, userAddress: userAddress })
        });

        if (response.ok) {
            await fetchLogs();
        }
    };

    useEffect(() => { fetchLogs(); }, []);

    return (
        <main className="p-8 bg-slate-900 min-h-screen text-white font-sans">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-red-500 tracking-tight">OCS Station Master</h1>
                <button onClick={fetchLogs} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95">
                    🔄 Refresh Logs
                </button>
            </div>

            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
                <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Live Traffic Monitor</h2>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-600 text-slate-400">
                            <th className="p-3 text-sm uppercase tracking-wider">Timestamp</th>
                            <th className="p-3 text-sm uppercase tracking-wider">Target Address / Alert</th>
                            <th className="p-3 text-sm uppercase tracking-wider">Risk Score</th>
                            <th className="p-3 text-sm uppercase tracking-wider">Status</th>
                            <th className="p-3 text-sm uppercase tracking-wider text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length === 0 ? (
                            <tr><td colSpan={5} className="p-8 text-center text-slate-500 italic">No traffic detected. Standby...</td></tr>
                        ) : (
                            logs.map((log: any, i) => {
                                const overridden = isAlreadyOverridden(log.address, log.sender);

                                return (
                                    <tr key={i} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${log.isManualOverride ? 'bg-blue-900/10' : ''}`}>
                                        <td className="p-3 text-xs text-slate-500 font-mono">{log.time}</td>
                                        <td className="p-3">
                                            <div className="font-mono text-xs text-slate-200">{log.address}</div>
                                            <div className={`text-[10px] italic mt-1 font-bold ${log.isManualOverride ? 'text-blue-400' : (log.score > 50 ? 'text-yellow-500' : 'text-slate-400')}`}>
                                                {log.isManualOverride ? '🔹 ' : (log.score > 50 ? '⚠️ ' : '✅ ')} {log.note}
                                            </div>
                                        </td>
                                        <td className="p-3 font-bold text-slate-300">{log.score}/100</td>
                                        <td className="p-3">
                                            <span className={`font-black px-2 py-0.5 rounded text-[11px] ${log.score > 50 ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
                                                {log.score > 50 ? 'BLOCKED' : 'APPROVED'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-right">
                                            {/* Smart Check: Hide button if a block row has an override row existing in the logs */}
                                            {log.score > 50 && !log.isManualOverride && !overridden && (
                                                <button
                                                    onClick={() => handleWhitelist(log.address, log.sender)}
                                                    className="text-[10px] bg-green-700 hover:bg-green-600 px-3 py-1 rounded font-black uppercase tracking-tighter transition-all"
                                                >
                                                    Whitelist
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </main>
    );
}