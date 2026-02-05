
import React from 'react';
import { Commandment } from '../types';

interface LawCardProps {
  commandment: Commandment;
  index: number;
}

export const LawCard: React.FC<LawCardProps> = ({ commandment, index }) => {
  const isTopTier = commandment.id <= 3;

  return (
    <div 
      className={`relative border-l-8 ${isTopTier ? 'border-red-600' : 'border-zinc-800'} bg-black p-8 md:p-12 mb-16 animate-fade-in group break-inside-avoid`}
      style={{ animationDelay: `${index * 150}ms` }}
    >
      {/* Background Rank Number */}
      <div className="absolute top-0 right-0 p-4 text-9xl font-cinzel font-black opacity-10 text-white select-none pointer-events-none group-hover:opacity-20 transition-opacity">
        {commandment.id}
      </div>

      <div className="relative z-10 space-y-8">
        {/* Header Section */}
        <div className="space-y-2">
          <div className="flex items-center space-x-4">
            {isTopTier && (
              <span className="px-3 py-1 text-xs font-black uppercase tracking-widest bg-red-600 text-white animate-pulse">
                CRITICAL PILLAR
              </span>
            )}
          </div>
          <h2 className="text-5xl md:text-7xl font-cinzel font-bold text-white uppercase tracking-tighter leading-none">
            {commandment.title}
          </h2>
        </div>

        {/* The Law (High Contrast Yellow) */}
        <div className="py-6 border-y border-zinc-900">
          <p className="text-2xl md:text-4xl italic font-serif-classic text-yellow-400 font-bold leading-tight">
            "{commandment.law}"
          </p>
        </div>

        {/* Description & Historical Context */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-4">
          <div className="space-y-4">
            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500">The Doctrine</h4>
            <p className="text-zinc-300 text-lg leading-relaxed">
              {commandment.description}
            </p>
          </div>
          <div className="space-y-4 p-6 bg-zinc-900/30 border border-zinc-800">
            <h4 className="text-xs font-black uppercase tracking-widest text-red-500">Strategic Reasoning</h4>
            <p className="text-red-100 text-sm italic font-serif-classic leading-relaxed">
              {commandment.rankingReason}
            </p>
          </div>
        </div>

        {/* Footer Context */}
        <div className="pt-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
           <div className="flex items-center space-x-3">
              <div className="h-px w-8 bg-zinc-800"></div>
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">Historical Record</span>
           </div>
           <p className="text-xs text-zinc-500 font-serif-classic italic max-w-xl text-right">
             Evidence: {commandment.historicalContext}
           </p>
        </div>
      </div>
    </div>
  );
};
