import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MarketChartArchive1791345600000 } from "./migrations/1791345600000-MarketChartArchive";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get<string>("DB_HOST"),
        port: configService.get<number>("DB_PORT"),
        username: configService.get<string>("DB_USER"),
        password: configService.get<string>("DB_PASS"),
        database: configService.get<string>("DB_NAME"),
        autoLoadEntities: true,
        synchronize: false,
        migrations: [MarketChartArchive1791345600000],
        migrationsRun: true,
        logging: configService.get<string>("NODE_ENV") === "development",
      }),
    }),
  ],
})
export class DatabaseModule {}
