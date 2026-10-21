import { Global, Module } from "@nestjs/common";
import { DbPoolService } from "./db-pool.service.js";

@Global()
@Module({
    providers: [DbPoolService],
    exports: [DbPoolService],
})
export class DbPoolModule { } 