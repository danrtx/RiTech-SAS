import { Controller, Get } from "@nestjs/common";
import { AtrService } from "./atr.service";

@Controller("atr")
export class AtrController {
  constructor(private readonly atr: AtrService) {}
  @Get() status() {
    return this.atr.snapshot();
  }
}
