
import { GoogleGenAI, Type } from "@google/genai";
import { TalleyrandData } from "./types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const fetchTalleyrandInsights = async (): Promise<TalleyrandData> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Synthesize "The 10 Commandments of Talleyrand" (Charles-Maurice de Talleyrand-Périgord).
    IMPORTANT: You must STACK RANK these from #1 (The Most Critical Pillar of his survival/power) to #10 (Tactical nuances).
    
    For each commandment, provide:
    1. A bold Title.
    2. The "Law" (a cynical, brilliant aphorism).
    3. A Description of how to apply it.
    4. Historical Context (how he used it in French history).
    5. "Ranking Reason": A 1-2 sentence explanation of why this specific law is ranked at this level of importance in his hierarchy of power.
    
    The tone must be cold, calculating, and masterful. Use the 48 Laws of Power as a reference for his style.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          identity: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              titles: { type: Type.ARRAY, items: { type: Type.STRING } },
              bio: { type: Type.STRING },
            },
            required: ["name", "titles", "bio"],
          },
          commandments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.NUMBER },
                title: { type: Type.STRING },
                law: { type: Type.STRING },
                description: { type: Type.STRING },
                historicalContext: { type: Type.STRING },
                rankingReason: { type: Type.STRING },
              },
              required: ["id", "title", "law", "description", "historicalContext", "rankingReason"],
            },
          },
        },
        required: ["identity", "commandments"],
      },
    },
  });

  try {
    const data = JSON.parse(response.text.trim());
    // Ensure they are sorted by ID (which represents the rank)
    data.commandments.sort((a: any, b: any) => a.id - b.id);
    return data;
  } catch (error) {
    console.error("Failed to parse Gemini response", error);
    throw new Error("The diplomat's internal logic is currently classified.");
  }
};
