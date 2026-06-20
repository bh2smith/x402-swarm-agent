// Class for fetching token prices from various sources.
import { IconFeed, S3Archive } from "../icons";
import { TokenQuery } from "../schema";
import {
  AlchemyFeed,
  CoingeckoFeed,
  DefilamaFeed,
  DexScreenerFeed,
  ZerionFeed,
  PriceFeed,
} from ".";

export class FeedRevolver implements PriceFeed {
  private sources: PriceFeed[];
  private iconFeed: IconFeed | null;
  public get name(): string {
    return `FeedRevolver: ${this.sources.length} sources`;
  }
  constructor(sources: PriceFeed[]) {
    this.sources = sources;
    // Icon archiving (S3) is optional — never let it block price lookups.
    try {
      this.iconFeed = S3Archive.withAllSources();
    } catch {
      this.iconFeed = null;
    }
  }

  static withAllSources(): FeedRevolver {
    const sources: PriceFeed[] = [
      new CoingeckoFeed(),
      new DefilamaFeed(),
      new DexScreenerFeed(),
    ];
    // Keyed sources are optional — fall back to the keyless ones when unset.
    if (process.env.ALCHEMY_KEY) {
      sources.push(new AlchemyFeed(process.env.ALCHEMY_KEY));
    }
    if (process.env.ZERION_KEY) {
      sources.push(new ZerionFeed(process.env.ZERION_KEY));
    }
    return new FeedRevolver(sources);
  }

  async getPrice(
    token: TokenQuery,
  ): Promise<{ price: number; source: string } | null> {
    // Create a copy of sources and shuffle them using timestamp as seed
    const timestamp = Date.now();
    const shuffledSources = this.shuffleWithSeed([...this.sources], timestamp);

    // Try each source in random order until we get a valid price
    for (const source of shuffledSources) {
      console.log(
        `Trying ${source.name} to fetch price for ${token.chainId}:${token.address}`,
      );
      try {
        const resp = await source.getPrice(token);
        if (resp) {
          console.log(`${source.name} found price ${resp.price}`);
          return resp;
        }
        console.log(`${source.name} returned null price`);
      } catch (error) {
        console.log(`Error fetching price from ${source.name}:`, error);
      }
    }

    console.log(
      `All sources failed to return a valid price for ${JSON.stringify(token, null, 2)}`,
    );
    return null;
  }

  async getIcon(token: TokenQuery): Promise<string | null> {
    return this.iconFeed ? this.iconFeed.getIcon(token) : null;
  }

  private shuffleWithSeed<T>(array: T[], seed: number): T[] {
    const shuffled = [...array];
    let currentSeed = seed;

    // Simple seeded random number generator
    const seededRandom = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };

    // Fisher-Yates shuffle with seeded random
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }
}
