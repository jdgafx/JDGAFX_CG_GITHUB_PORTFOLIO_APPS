
import React, { useState, useEffect, useRef } from 'react';
import { fetchTalleyrandInsights } from './geminiService';
import { TalleyrandData } from './types';
import { LawCard } from './components/LawCard';
import * as htmlToImage from 'html-to-image';

const App: React.FC = () => {
  const [data, setData] = useState<TalleyrandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const dossierRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const insights = await fetchTalleyrandInsights();
        setData(insights);
      } catch (err) {
        setError("The archive of the Limping Devil is under lock and key.");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleShare = async () => {
    if (!dossierRef.current) return;
    
    setIsDownloading(true);
    try {
      // Small delay to ensure layout is stable
      await new Promise(r => setTimeout(r, 100));

      // ULTRA-HIGH RESOLUTION CONFIGURATION
      // User Requirement: "Zero degradation" and "zoom in a shitload".
      // We use a pixelRatio of 4 (approx 8K resolution on desktop) to allow extreme zooming.
      // Going higher (e.g., 8-10) risks browser memory crashes on mobile devices.
      const blob = await htmlToImage.toBlob(dossierRef.current, {
        backgroundColor: '#000000',
        quality: 1.0,
        pixelRatio: 4, 
        type: 'image/png',
      });

      if (!blob) throw new Error("Failed to generate image blob");

      const file = new File([blob], `Talleyrand_Dossier.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'The Talleyrand Decalogue',
          text: 'Top Secret Dossier: The 10 Commandments of Power.',
          files: [file],
        });
      } else {
        // Fallback to download if sharing not supported
        const link = document.createElement('a');
        link.download = `Talleyrand_Dossier_${new Date().getTime()}.png`;
        link.href = URL.createObjectURL(blob);
        link.click();
      }
    } catch (err) {
      console.error('Failed to share/download', err);
      // Fallback to native print
      window.print();
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownload = async () => {
    // Legacy download handler (kept for specific desktop use or reference)
    // We will redirect to handleShare for the main button as it handles both
    await handleShare();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-10">
        <div className="relative w-24 h-24 mb-10">
          <div className="absolute inset-0 border-8 border-zinc-900 rounded-full"></div>
          <div className="absolute inset-0 border-8 border-red-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <h2 className="text-3xl font-cinzel font-bold tracking-[0.2em] mb-4 text-center">DECRYPTING PROTOCOLS</h2>
        <p className="font-serif-classic italic text-zinc-500 animate-pulse">"Wait. Never be eager. Time is the only ally that never betrays."</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-red-600 p-6 text-center">
        <div className="text-9xl mb-8">!</div>
        <h1 className="text-4xl font-cinzel font-bold mb-4">DIPLOMATIC COLLAPSE</h1>
        <p className="text-zinc-500 mb-10 font-serif-classic">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-12 py-4 bg-red-600 text-white font-black uppercase tracking-widest hover:bg-red-700 transition-all"
        >
          Re-establish Connection
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-red-600 selection:text-white font-sans overflow-x-hidden">
      {/* Floating Action Button */}
      <div className="fixed bottom-8 right-8 z-50 flex gap-4 print:hidden">
        <button 
          onClick={handleShare}
          disabled={isDownloading}
          className={`font-black px-6 py-3 border-4 border-black transition-all shadow-[8px_8px_0px_0px_rgba(220,38,38,1)] 
            ${isDownloading ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-white text-black hover:bg-red-600 hover:text-white'}`}
        >
          {isDownloading ? 'RENDERING HIGH-RES...' : 'SHARE DOSSIER'}
        </button>
      </div>

      {/* Main Container - Capturable as a seamless document */}
      <div id="dossier-container" ref={dossierRef} className="bg-black">
        {/* Massive Hero Header */}
        <header className="relative pt-32 pb-24 px-6 border-b-4 border-white">
          <div className="max-w-6xl mx-auto relative z-10">
            <div className="inline-block px-4 py-2 bg-red-600 text-white font-black text-xs tracking-[0.5em] mb-8 uppercase">
              Official Dossier: Top Secret
            </div>
            <h1 className="text-clamp-title font-cinzel font-bold mb-8 leading-none tracking-tighter">
              {data.identity.name}
            </h1>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-end">
               <div className="space-y-6">
                  <p className="text-clamp-subtitle font-serif-classic italic text-yellow-400 leading-tight">
                    "{data.identity.bio}"
                  </p>
                  <div className="flex flex-wrap gap-2 pt-4">
                    {data.identity.titles.map((t, i) => (
                      <span key={i} className="px-3 py-1 border border-zinc-700 text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                        {t}
                      </span>
                    ))}
                  </div>
               </div>
               <div className="text-right hidden lg:block print:hidden">
                  <div className="text-zinc-800 font-black text-[200px] leading-none select-none opacity-50">1754</div>
               </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="bg-zinc-900/10 py-20">
          <div className="max-w-5xl mx-auto px-6 mb-20">
            <div className="flex items-center space-x-6">
               <span className="text-red-600 font-black text-4xl">X</span>
               <h3 className="text-2xl font-cinzel font-bold tracking-[0.4em] text-white">THE RANKED COMMANDMENTS</h3>
            </div>
          </div>
          
          <main className="max-w-5xl mx-auto px-6">
            {data.commandments.map((cmd, idx) => (
              <LawCard key={cmd.id} commandment={cmd} index={idx} />
            ))}
          </main>
        </div>

        {/* Footer */}
        <footer className="py-32 px-6 bg-black text-white border-t-4 border-white">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-clamp-subtitle font-cinzel font-bold mb-12 tracking-tighter uppercase underline decoration-red-600 decoration-8 underline-offset-8">
              The Ultimate Survivalist
            </h2>
            <p className="text-clamp-law font-serif-classic italic mb-16 leading-tight">
              "I have never been a man of one party... I have served France, through every mask."
            </p>
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.6em] border-t border-zinc-800 pt-8">
              <span>Congress of Vienna Dossier</span>
              <span>Ref: 1754-1838-LE-DIABLE</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
