import type { components, operations, paths } from "./generated/schema.js";

type Assert<T extends true> = T;
type IsRequired<T, Key extends keyof T> =
  object extends Pick<T, Key> ? false : true;
type Lacks<T, Key extends PropertyKey> = Key extends keyof T ? false : true;

type AccountDetail = components["schemas"]["AccountDetail"];
type AccountListItem = components["schemas"]["AccountListItem"];
type ArchiveRequest = components["schemas"]["ArchiveAccountRequest"];

export type AccountDetailRequiresRowVersion = Assert<
  IsRequired<AccountDetail, "rowVersion">
>;
export type AccountDetailOmitsRawName = Assert<Lacks<AccountDetail, "rawName">>;
export type AccountDetailOmitsSourceSystem = Assert<
  Lacks<AccountDetail, "sourceSystemId">
>;
export type AccountListOmitsRawName = Assert<Lacks<AccountListItem, "rawName">>;
export type AccountListOmitsSourceRecordKey = Assert<
  Lacks<AccountListItem, "sourceRecordKey">
>;
export type ArchiveUsesHeaderConcurrency = Assert<
  Lacks<ArchiveRequest, "expectedRowVersion">
>;

export type CustomerListOperation = operations["get_accounts"];
export type CustomerDetailOperation = operations["get_accounts_by_accountId"];
export type CountryReferenceOperation = operations["get_reference_countries"];
export type CountryReferencePath = paths["/reference/countries"];
