import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type Provider,
} from "@nestjs/common";
import {
  AuditRepository,
  createPrismaClient,
  DurableJobRepository,
  OutboxRepository,
  TransactionManager,
  type DatabaseClient,
} from "@abp/database";

export const databaseClientToken = Symbol("ABP_DATABASE_CLIENT");
export const transactionManagerToken = Symbol("ABP_TRANSACTION_MANAGER");
export const auditRepositoryToken = Symbol("ABP_AUDIT_REPOSITORY");
export const outboxRepositoryToken = Symbol("ABP_OUTBOX_REPOSITORY");
export const durableJobRepositoryToken = Symbol("ABP_DURABLE_JOB_REPOSITORY");

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.$disconnect();
  }
}

export const databaseProviders: Provider[] = [
  {
    provide: databaseClientToken,
    useFactory: (): DatabaseClient => {
      const connectionString = process.env.DATABASE_URL;
      if (connectionString === undefined || connectionString.length === 0) {
        throw new Error("DATABASE_URL_REQUIRED");
      }
      return createPrismaClient(connectionString);
    },
  },
  {
    provide: transactionManagerToken,
    inject: [databaseClientToken],
    useFactory: (database: DatabaseClient): TransactionManager =>
      new TransactionManager(database),
  },
  {
    provide: auditRepositoryToken,
    useFactory: (): AuditRepository => new AuditRepository(),
  },
  {
    provide: outboxRepositoryToken,
    inject: [databaseClientToken],
    useFactory: (database: DatabaseClient): OutboxRepository =>
      new OutboxRepository(database),
  },
  {
    provide: durableJobRepositoryToken,
    inject: [databaseClientToken],
    useFactory: (database: DatabaseClient): DurableJobRepository =>
      new DurableJobRepository(database),
  },
  DatabaseShutdown,
];
