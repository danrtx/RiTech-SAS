import {
  ArgumentsHost,
  Body,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import {
  CreateRecommendation,
  HumanDecision,
  Question,
} from "./investment.types";
import { InvestmentService } from "./investment.service";
import { InvestmentStore, digest } from "./investment.store";
const uuid = z.string().uuid();
const SCOPE = "general";
@Catch()
export class InvestmentErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : 503;
    const correlationId = randomUUID();
    new Logger("InvestmentAPI").warn({
      event: "investment_request_failed",
      code,
      correlationId,
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(code).json({
      status: code === 503 ? "NO_DISPONIBLE" : "ERROR",
      code,
      message:
        {
          400: "ENTRADA_INVALIDA",
          404: "NO_ENCONTRADO",
          409: "CONFLICTO_DE_SOLICITUD",
          429: "LIMITE_DE_SOLICITUDES",
        }[code] || "SERVICIO_NO_DISPONIBLE",
      correlationId,
    });
  }
}
@Injectable()
export class InvestmentGuard implements CanActivate {
  constructor(private readonly store: InvestmentStore) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    await this.store.consume([
      { key: "http:general", limit: 600, seconds: 60 },
      { key: `http:${digest(req.ip || "unknown")}`, limit: 60, seconds: 60 },
    ]);
    return true;
  }
}
@Controller("api/investment/recommendations")
@UseFilters(InvestmentErrors)
@UseGuards(InvestmentGuard)
export class InvestmentController {
  constructor(
    private readonly service: InvestmentService,
    private readonly store: InvestmentStore,
  ) {}
  private async cancelable<T>(
    res: Response,
    work: (signal: AbortSignal) => Promise<T>,
  ) {
    res.setHeader("Cache-Control", "no-store");
    const abort = new AbortController();
    const close = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.on("close", close);
    try {
      return await work(abort.signal);
    } finally {
      res.off("close", close);
    }
  }
  @Post()
  create(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = uuid.parse(req.headers["idempotency-key"]);
    const input = CreateRecommendation.parse(body);
    return this.cancelable(res, (signal) =>
      this.service.create(SCOPE, key, input, signal),
    );
  }
  @Get(":id")
  get(@Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    return this.service.get(SCOPE, uuid.parse(id));
  }
  @Post(":id/questions")
  question(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = Question.parse(body);
    const key = uuid.parse(req.headers["idempotency-key"]);
    uuid.parse(id);
    return this.cancelable(res, (signal) =>
      this.service.question(SCOPE, id, key, input.question, signal),
    );
  }
  @Post(":id/decision")
  decision(
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.store.decision(
      SCOPE,
      uuid.parse(id),
      HumanDecision.parse(body).decision,
    );
  }
}
