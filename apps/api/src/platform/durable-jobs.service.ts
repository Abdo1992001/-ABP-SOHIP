import { Inject, Injectable } from "@nestjs/common";
import {
  DurableJobRepository,
  type DatabaseClient,
  type EnqueueDurableJobInput,
  type TransactionClient,
} from "@abp/database";
import { databaseClientToken } from "./database.providers.js";

export type EnqueueJobInput = EnqueueDurableJobInput;

@Injectable()
export class DurableJobsService {
  private readonly repository: DurableJobRepository;

  constructor(@Inject(databaseClientToken) database: DatabaseClient) {
    this.repository = new DurableJobRepository(database);
  }

  enqueue(
    transaction: TransactionClient,
    input: EnqueueJobInput,
  ): Promise<{ jobId: string }> {
    return this.repository.enqueue(transaction, input);
  }
}
