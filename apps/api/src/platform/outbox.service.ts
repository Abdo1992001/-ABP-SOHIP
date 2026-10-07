import { Inject, Injectable } from "@nestjs/common";
import {
  OutboxRepository,
  type OutboxMessageInput,
  type TransactionClient,
} from "@abp/database";
import { databaseClientToken } from "./database.providers.js";
import type { DatabaseClient } from "@abp/database";

export type { OutboxMessageInput } from "@abp/database";

@Injectable()
export class OutboxService {
  private readonly repository: OutboxRepository;

  constructor(@Inject(databaseClientToken) database: DatabaseClient) {
    this.repository = new OutboxRepository(database);
  }

  enqueue(
    transaction: TransactionClient,
    message: OutboxMessageInput,
  ): Promise<{ eventId: string }> {
    return this.repository.enqueue(transaction, message);
  }
}
