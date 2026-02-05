
export interface Commandment {
  id: number;
  title: string;
  law: string;
  description: string;
  historicalContext: string;
  rankingReason: string; // Explains why this rank was chosen
}

export interface TalleyrandData {
  identity: {
    name: string;
    titles: string[];
    bio: string;
  };
  commandments: Commandment[];
}
