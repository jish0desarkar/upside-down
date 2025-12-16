export class Semaphore {
  private available: number;
  private readonly max: number;
  private waitQueue: (() => void)[] = [];

  constructor(max: number) {
    if (max <= 0) throw new Error("Semaphore max must be > 0");
    this.max = max;
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      console.log("SEMAPHORE AQUIRED, REMAINING: ", this.available);
      return;
    }

    // If slots are full, the next req waits here until the resolve is called
    // in the release function, backpressuring kafka polls
    console.log("SEMAPHORE OVER, PUSHING TO QUEUE REMAINING: ", this.available);
    await new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.available--;
        resolve();
      });
    });
  }

  release(): void {
    this.available++;
    console.log(
      "SEMAPHORE RELEASING. AVAIABLE: ",
      this.available,
      "QUEUE LENGTH: ",
      this.waitQueue.length
    );
    if (this.waitQueue.length > 0) {
      // REsume the waited request
      const next = this.waitQueue.shift()!;
      next();
      return;
    }

    if (this.available > this.max) {
      throw new Error("Semaphore released too many times");
    }
  }
}
