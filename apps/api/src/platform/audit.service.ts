import { Injectable } from "@nestjs/common";
import {
  AuditRepository,
  type AuditRecordInput,
  type TransactionClient,
} from "@abp/database";

export type { AuditRecordInput } from "@abp/database";

@Injectable()
export class AuditService {
  private readonly repository = new AuditRepository();

  async record(
    transaction: TransactionClient,
    input: AuditRecordInput,
  ): Promise<{ auditEventId: string }> {
    return this.repository.append(transaction, input);
  }
}
