import { Injectable } from "@nestjs/common";

/** Provider adapters pause minute sealing until their replay is fully committed. */
@Injectable()
export class IngestionState {
  recovering = false;
  version = 0;
  beginRecovery() {
    this.recovering = true;
    this.version++;
  }
  recovered() {
    this.recovering = false;
    this.version++;
  }
  snapshot() {
    return { recovering: this.recovering };
  }
}
